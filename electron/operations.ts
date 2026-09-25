import { loadNames, setName } from "./agent-names.js"
import type { Router } from "./router.js"
import { TASKS, type Task } from "./priorities.js"
import { parseRef, refOf } from "./model-ref.js"
import { TABS, type Bridge } from "./opencode-bridge.js"
import { isArchived, listArchived, setArchived } from "./archive.js"
import { clearFreebuffHistory, getFreebuffMessages } from "./freebuff-history.js"
import { FREEBUFF_MODEL_LABEL, interruptFreebuff, runFreebuff } from "./freebuff.js"

export type ChatMsg = {
  id: string
  role: "user" | "assistant"
  text: string
  agent?: string
  model?: string
  child?: boolean // fait partie du transcript d'un sous-agent (voir subagentTranscripts ci-dessous)
  tools?: { id: string; name: string; status: string; output?: string }[]
  error?: string
  created?: number
}

const isTab = (id: string) => (TABS as readonly string[]).includes(id)

// Longueur d'un titre de conversation généré depuis le premier message.
const TITLE_MAX = 60
function titleFrom(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ")
  return clean.length > TITLE_MAX ? clean.slice(0, TITLE_MAX - 1) + "…" : clean
}

// Convertit les messages bruts d'une session OpenCode en ChatMsg. `tool.state`
// contient déjà `.status` (utilisé plus haut dans le projet) ; les champs
// `output`/`metadata` éventuels ne sont pas documentés dans la doc publique
// d'OpenCode à ce jour, donc on les lit de façon défensive (best effort) sans
// jamais faire planter l'affichage s'ils sont absents ou différents.
function toolOutputOf(c: { state?: Record<string, unknown> }): string | undefined {
  const s = c.state as Record<string, unknown> | undefined
  if (!s) return undefined
  const cand = (s as { output?: unknown; result?: unknown; text?: unknown }).output ?? (s as any).result ?? (s as any).text
  if (typeof cand === "string") return cand
  if (Array.isArray(cand)) {
    const joined = cand
      .map((x) => (typeof x === "string" ? x : typeof x?.text === "string" ? x.text : ""))
      .filter(Boolean)
      .join("\n")
    return joined || undefined
  }
  return undefined
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      out[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return out
}

async function messagesOf(b: Bridge, sessionID: string, child = false): Promise<ChatMsg[]> {
  const page = await b.client.message.list({ sessionID, order: "asc", limit: 200 })
  const out: ChatMsg[] = []
  for (const m of page.data as any[]) {
    if (m.type === "user") out.push({ id: m.id, role: "user", text: m.text, child, created: Number((m as any).time?.created ?? 0) || undefined })
    if (m.type === "assistant")
      out.push({
        id: m.id,
        role: "assistant",
        agent: m.agent,
        model: refOf(m.model),
        child,
        text: m.content.flatMap((c: any) => (c.type === "text" ? [c.text] : [])).join(""),
        tools: m.content.flatMap((c: any) =>
          c.type === "tool" ? [{ id: c.id, name: c.name, status: c.state.status, output: toolOutputOf(c) }] : [],
        ),
        error: m.error?.message,
        created: Number((m as any).time?.created ?? 0) || undefined,
      })
  }
  return out
}

async function listAgents(b: Bridge) {
  const { data } = await b.client.agent.list({ location: { directory: b.workspace } })
  const names = loadNames(b.workspace)
  return data
    .filter((a) => a.mode !== "subagent" && !a.hidden && isTab(a.id))
    .map((a) => ({ id: a.id, name: names[a.id] ?? a.name, defaultName: a.name, description: a.description ?? "" }))
}

export const DEFAULT_TITLE = "Nouvelle conversation"
export const MAX_TITLE = 120

/** Toutes les opérations exposées à l'interface. Sans Electron : testable avec Node seul. */
export function makeOps(current: () => Bridge, router: () => Router | null = () => null, notify?: (sessionID: string, text: string) => void) {
  return {
    async agents() {
      return listAgents(current())
    },

    /** Renomme l'AFFICHAGE d'un agent (nom vide = nom d'origine). L'identifiant ne change pas. */
    async renameAgent(id: string, name: string) {
      if (!isTab(id)) throw new Error(`Agent inconnu : ${id}`)
      const b = current()
      setName(b.workspace, id, String(name ?? ""))
      return listAgents(b)
    },

    /** Renomme une conversation. */
    async renameChat(id: string, title: string) {
      const clean = String(title ?? "").trim().slice(0, MAX_TITLE)
      if (!clean) throw new Error("Le titre ne peut pas être vide.")
      await current().client.session.update({ sessionID: id, title: clean })
      return { id, title: clean }
    },

    async chats(agent?: string, includeArchived = false) {
      const b = current()
      const page = await b.client.session.list({ directory: b.workspace, order: "desc", limit: 100 })
      const archived = listArchived(b.workspace)
      return page.data
        .filter((s) => !s.parentID && (!agent || s.agent === agent) && (includeArchived || !archived.has(s.id)))
        .map((s) => ({
          id: s.id,
          title: s.title ?? "Sans titre",
          agent: s.agent,
          model: refOf(s.model),
          updated: s.time.updated,
          archived: archived.has(s.id),
        }))
    },

    async createChat(agent: string) {
      const b = current()
      if (!isTab(agent)) throw new Error(`Agent inconnu : ${agent}`)
      const model = router()?.pick(agent as Task)
      if (!model) {
        throw new Error(`Aucun modèle disponible pour l’agent « ${agent} ». Vérifie les fournisseurs actifs et la table de priorités.`)
      }
      const s = await b.client.session.create({
        title: DEFAULT_TITLE,
        agent,
        location: { directory: b.workspace },
        model: parseRef(model),
      })
      // Certaines versions du serveur ne renvoient pas le modèle dans session.create().
      // On relit la session afin que l'UI affiche immédiatement le modèle effectivement sélectionné.
      const fresh = await b.client.session.get({ sessionID: s.id })
      const resolved = refOf(fresh.model ?? s.model)
      if (!resolved) {
        // Une session sans modèle signifie que le serveur a ignoré notre sélection : on évite
        // de laisser l'application basculer silencieusement vers une attribution automatique.
        await b.client.session.remove({ sessionID: s.id }).catch(() => undefined)
        throw new Error(`L’agent « ${agent} » n’a pas pu recevoir le modèle « ${model} ». OpenCode a créé une session sans modèle explicite.`)
      }
      return { id: s.id, title: s.title, agent: fresh.agent ?? s.agent, model: resolved }
    },

    async deleteChat(id: string) {
      const b = current()
      router()?.forget(id)
      interruptFreebuff(id)
      await b.client.session.interrupt({ sessionID: id }).catch(() => undefined)
      await b.client.session.remove({ sessionID: id })
      clearFreebuffHistory(id)
      setArchived(b.workspace, id, false) // nettoie l'entrée d'archive si elle existait
    },

    async archiveChat(id: string, archived: boolean) {
      setArchived(current().workspace, id, archived)
    },

    isArchived(id: string) {
      return isArchived(current().workspace, id)
    },

    async messages(id: string): Promise<ChatMsg[]> {
      const b = current()
      // Les deux requêtes sont indépendantes : lancer la lecture du transcript principal et la
      // liste des enfants en parallèle réduit nettement le temps d'ouverture des longs chats.
      const [main, page] = await Promise.all([
        messagesOf(b, id, false),
        b.client.session.list({ directory: b.workspace, order: "asc", limit: 200 }),
      ])

      // Transcript des sous-agents (ex. code-reviewer) : ce sont des SESSIONS À PART, dont les
      // messages n'apparaissent jamais dans l'historique du chat principal une fois la conversation
      // rechargée. On les rattache ici, marqués `child: true`, pour ne plus les perdre après un tour.
      const children = page.data.filter((s) => s.parentID === id)
      const transcripts = await mapConcurrent(children, 4, async (c) => ({ c, messages: await messagesOf(b, c.id, true) }))
      for (const { c, messages } of transcripts) {
        if (messages.length) main.push(...messages.map((m) => ({ ...m, agent: m.agent ?? c.agent })))
      }

      // Les tours envoyés au backend Freebuff ne passent volontairement pas dans OpenCode.
      // Leur transcript local est donc fusionné ici afin de survivre aux rechargements.
      const freebuff = getFreebuffMessages(id).map((m) => ({
        id: m.id, role: m.role, text: m.text, agent: m.agent, model: m.model, error: m.error, created: m.timestamp,
      }))
      return [...main, ...freebuff].sort((a, b) => (a.created ?? 0) - (b.created ?? 0))
    },

    async send(id: string, text: string, backend: "opencode" | "freebuff" = "opencode") {
      const clean = text.trim()
      if (!clean) throw new Error("Message vide")
      const b = current()

      if (backend === "freebuff") {
        const info = await b.client.session.get({ sessionID: id })
        const rawAgent = String(info.agent ?? "code")
        const task: Task = (TASKS as readonly string[]).includes(rawAgent) ? (rawAgent as Task) : "code"
        const result = await runFreebuff({
          chatId: id,
          task,
          prompt: clean,
          cwd: b.workspace,
          notify: (text) => notify?.(id, text),
        })
        try {
          if ((info.title ?? DEFAULT_TITLE) === DEFAULT_TITLE) await b.client.session.update({ sessionID: id, title: titleFrom(clean) })
        } catch (err) {
          console.error("[titre freebuff]", err)
        }
        return { backend: "freebuff" as const, response: result.response, model: result.model }
      }

      // Titre automatique au 1er message, SEULEMENT si le titre est encore celui par défaut (un renommage manuel n'est jamais écrasé).
      try {
        const info = await b.client.session.get({ sessionID: id })
        if ((info.title ?? DEFAULT_TITLE) === DEFAULT_TITLE) {
          const existing = await b.client.message.list({ sessionID: id, order: "asc", limit: 1 })
          if (existing.data.length === 0) await b.client.session.update({ sessionID: id, title: titleFrom(clean) })
        }
      } catch (err) {
        console.error("[titre auto]", err) // jamais bloquant pour l’envoi du message
      }
      await router()?.beforeSend(id, clean) // bascule éventuelle vers le meilleur modèle non saturé
      await b.client.session.prompt({ sessionID: id, text: clean })
      return { backend: "opencode" as const }
    },

    async interrupt(id: string) {
      interruptFreebuff(id)
      await current().client.session.interrupt({ sessionID: id }).catch(() => undefined)
    },

    // Réponse à une question de l'agent (outil `question`) : answer = { [clé du champ]: valeur }
    async formReply(sessionID: string, formID: string, answer: Record<string, string | number | boolean | string[]>) {
      await current().client.session.form.reply({ sessionID, formID, answer })
    },

    async formCancel(sessionID: string, formID: string) {
      await current().client.session.form.cancel({ sessionID, formID })
    },

    // sessionID = celui de la DEMANDE (peut être une session de sous-agent)
    async reply(sessionID: string, requestID: string, decision: "once" | "always" | "reject") {
      await current().client.permission.reply({ sessionID, requestID, decision })
    },

    /** Transcript Markdown d'une conversation (pour export). */
    async exportMarkdown(id: string): Promise<{ title: string; markdown: string }> {
      const b = current()
      const sessions = await b.client.session.list({ directory: b.workspace, order: "desc", limit: 100 })
      const session = sessions.data.find((s) => s.id === id)
      const title = session?.title ?? "Conversation"
      const msgs = await this.messages(id)
      const lines = [`# ${title}`, ""]
      for (const m of msgs) {
        const who = m.role === "user" ? "**Toi**" : `**${m.agent ?? "Agent"}${m.child ? " (sous-agent)" : ""}**`
        lines.push(who + (m.model ? ` _(${m.model})_` : "") + " :", "", m.text || "_(pas de texte)_", "")
        if (m.tools?.length) lines.push("Outils utilisés : " + m.tools.map((t) => t.name).join(", "), "")
      }
      return { title, markdown: lines.join("\n") }
    },
  }
}
export type Ops = ReturnType<typeof makeOps>

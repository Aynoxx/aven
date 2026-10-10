import type { Task } from "./priorities.js"
import { parseRef, refOf } from "./model-ref.js"
// v9.8.0 (phase 1 du protocole MIGRATION-WINUI.md) : le client OpenCode est un proxy
// du host (aven-engine-host.mjs, JSON-RPC stdio) — formes et retours inchangés. Les
// noms personnalisés d'agents restent lus (loadNames via le bridge) ; le renommage
// est sorti de l'UI depuis v9.6.0.
import { TABS, type OpenCodeClient } from "./opencode-bridge.js"
import { isArchived, setArchived } from "./archive.js"
import { loadTaskMode, saveTaskMode, taskModeInstruction, TASK_MODE_INSTRUCTION_KEY, type TaskMode } from "./task-mode.js"

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

async function messagesOf(b: BridgeHost, sessionID: string, child = false): Promise<ChatMsg[]> {
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

async function listAgents(b: BridgeHost) {
  const { data } = await b.client.agent.list({ location: { directory: b.workspace } })
  const names = b.loadNames(b.workspace)
  return data
    .filter((a) => a.mode !== "subagent" && !a.hidden && isTab(a.id))
    .map((a) => ({ id: a.id, name: names[a.id] ?? a.name, defaultName: a.name, description: a.description ?? "" }))
}

export const DEFAULT_TITLE = "Nouvelle conversation"
export const MAX_TITLE = 120

// v9.1.6 : le 3ᵉ paramètre `notify` (avis du repli Freebuff→OpenCode) a disparu avec
// le chemin SDK ; les avis de routage passent par le Router (sonde notify déjà branchée).
/** Toutes les opérations exposées à l'interface. Sans Electron : testable avec Node seul. */
export type BridgeHost = {
  client: OpenCodeClient
  workspace: string
  loadNames: (workspace: string) => Record<string, string>
  archived: (workspace: string) => Iterable<string>
  chains: Record<Task, { ref: string; label: string }[]>
  router: {
    pick: (agent: Task) => string | undefined
    beforeSend: (sessionID: string, text: string) => Promise<void>
    forget: (sessionID: string) => void
  }
}

/** Pose le mode de tâche en instruction de session (false = API refusée → fallback). */
async function applyTaskModeInstruction(b: BridgeHost, sessionID: string, mode: TaskMode): Promise<boolean> {
  try {
    await b.client.session.instructions.entry.put({ sessionID, key: TASK_MODE_INSTRUCTION_KEY, value: taskModeInstruction(mode) })
    return true
  } catch {
    return false
  }
}

/** Toutes les opérations exposées à l'interface. Sans Electron : testable avec Node seul. */
export function makeOps(current: () => BridgeHost) {
  const b = current()
  return {
    async agents() {
      return listAgents(b)
    },

    /** Renomme une conversation. */
    async renameChat(id: string, title: string) {
      const clean = String(title ?? "").trim().slice(0, MAX_TITLE)
      if (!clean) throw new Error("Le titre ne peut pas être vide.")
      await b.client.session.update({ sessionID: id, title: clean })
      return { id, title: clean }
    },

    async chats(agent?: string, includeArchived = false) {
      const page = await b.client.session.list({ directory: b.workspace, order: "desc", limit: 100 })
      const archived = new Set(b.archived(b.workspace))
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
      if (!isTab(agent)) throw new Error(`Agent inconnu : ${agent}`)
      const model = b.router.pick(agent as Task)
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

    // v10.1.0 : mode de tâche de l'orchestrateur (Auto / Code / Analyse / Recherche).
    async taskMode(): Promise<TaskMode> {
      return loadTaskMode(b.workspace)
    },

    /** Change le mode et le pose (best-effort) sur toutes les sessions « projet » ouvertes. */
    async setTaskMode(mode: unknown): Promise<TaskMode> {
      const saved = saveTaskMode(b.workspace, mode)
      try {
        const page = await b.client.session.list({ directory: b.workspace, order: "desc", limit: 100 })
        for (const s of page.data.filter((x) => x.agent === "projet" && !x.parentID)) {
          await applyTaskModeInstruction(b, s.id, saved).catch(() => undefined)
        }
      } catch {
        /* best effort : le mode est appliqué au prochain envoi */
      }
      return saved
    },

    /**
     * (v9.4.0) Change le modèle d'une conversation existante via session.switchModel.
     * C'est le versant « manuel » du routeur : « Auto » reste le défaut (le Router
     * attribue et bascule tout seul), un choix explicite épingle le modèle jusqu'à
     * ce que l'utilisateur revienne sur « Auto » (nouveau switchModel).
     */
    async setChatModel(id: string, ref?: string) {
      if (ref) {
        await b.client.session.switchModel({ sessionID: id, model: parseRef(ref) })
      } else {
        // « Auto » : on réaligne la session sur le meilleur modèle disponible selon
        // le Router (sa logique : chaîne de priorité + cooldowns + quotas).
        const auto = b.router.pick("projet")
        if (!auto) throw new Error("Aucun modèle disponible : impossible de revenir en « Auto ».")
        await b.client.session.switchModel({ sessionID: id, model: parseRef(auto) })
      }
      const fresh = await b.client.session.get({ sessionID: id })
      return { id, agent: fresh.agent, model: refOf(fresh.model) }
    },

    /** (v9.4.0) Chaîne de priorité d'un agent, pour le sélecteur de modèles de l'interface. */
    chainFor(agent: string): { ref: string; label: string }[] {
      const chains = b.chains
      return (chains[agent as Task] ?? []).map((c) => ({ ref: c.ref, label: c.label }))
    },

    async deleteChat(id: string) {
      b.router.forget(id)
      await b.client.session.interrupt({ sessionID: id }).catch(() => undefined)
      await b.client.session.remove({ sessionID: id })
      setArchived(b.workspace, id, false) // nettoie l'entrée d'archive si elle existait
    },

    async archiveChat(id: string, archived: boolean) {
      setArchived(b.workspace, id, archived)
    },

    isArchived(id: string) {
      return isArchived(b.workspace, id)
    },

    async messages(id: string): Promise<ChatMsg[]> {
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

      // Les sous-agents ont été rattachés ci-dessus ; tri chronologique unique.
      return main.sort((a, b) => (a.created ?? 0) - (b.created ?? 0))
    },

    // v9.1.6 : le paramètre backend disparaît — l'envoi passe UNIQUEMENT par OpenCode.
    // (Le free tier Freebuff vit dans son CLI/terminal intégré ; l'ancien chemin SDK
    // Codebuff payant a été retiré. Contrat simplifié côté IPC et côté interface.)
    async send(id: string, text: string): Promise<{ backend: "opencode" }> {
      const clean = text.trim()
      if (!clean) throw new Error("Message vide")

      // Titre automatique au 1er message, SEULEMENT si le titre est encore celui par défaut (un renommage manuel n'est jamais écrasé).
      let agent: string | undefined
      try {
        const info = await b.client.session.get({ sessionID: id })
        agent = info.agent
        if ((info.title ?? DEFAULT_TITLE) === DEFAULT_TITLE) {
          const existing = await b.client.message.list({ sessionID: id, order: "asc", limit: 1 })
          if (existing.data.length === 0) await b.client.session.update({ sessionID: id, title: titleFrom(clean) })
        }
      } catch (err) {
        console.error("[titre auto]", err) // jamais bloquant pour l’envoi du message
      }
      await b.router.beforeSend(id, clean) // bascule éventuelle vers le meilleur modèle non saturé
      // v10.1.0 : mode de tâche de l'orchestrateur — l'instruction accompagne CHAQUE
      // tour de la session « projet » ; si l'API d'instruction refuse, fallback en
      // tête de message (jamais de navigation/prompt perdu).
      let body = clean
      if (agent === "projet") {
        const mode = loadTaskMode(b.workspace)
        const applied = await applyTaskModeInstruction(b, id, mode)
        if (!applied && mode !== "auto") body = `${taskModeInstruction(mode)}\n\n${clean}`
      }
      await b.client.session.prompt({ sessionID: id, text: body })
      return { backend: "opencode" as const }
    },

    async interrupt(id: string) {
      await b.client.session.interrupt({ sessionID: id }).catch(() => undefined)
    },

    // Réponse à une question de l'agent (outil `question`) : answer = { [clé du champ]: valeur }
    async formReply(sessionID: string, formID: string, answer: Record<string, string | number | boolean | string[]>) {
      await b.client.session.form.reply({ sessionID, formID, answer })
    },

    async formCancel(sessionID: string, formID: string) {
      await b.client.session.form.cancel({ sessionID, formID })
    },

    // sessionID = celui de la DEMANDE (peut être une session de sous-agent)
    async reply(sessionID: string, requestID: string, decision: "once" | "always" | "reject") {
      await b.client.permission.reply({ sessionID, requestID, decision })
    },

    /** Transcript Markdown d'une conversation (pour export). */
    async exportMarkdown(id: string): Promise<{ title: string; markdown: string }> {
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

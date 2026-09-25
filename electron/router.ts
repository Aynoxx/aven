import type { AppEvent, OpenCodeClient } from "./opencode-bridge.js"
import { buildChains, TASKS, type Chain, type Table, type Task } from "./priorities.js"
import { parseRef, refOf } from "./model-ref.js"

// Sans dépendance à Electron : testable avec Node seul.
export type Classified = { cooldownMs: number; why: string; scope?: "model" | "provider" }

/** Une erreur de modèle justifie-t-elle de passer au suivant ? (null = non : erreur qui n'est pas la faute du modèle) */
export function classifyError(err?: { status?: number; message?: string }): Classified | null {
  const msg = err?.message ?? ""
  const st = err?.status
  if (st === 429 || /rate.?limit|too many|quota|exhaust|resource.?exhausted/i.test(msg)) {
    return /per day|daily|\bday\b|RPD/i.test(msg) ? { cooldownMs: 6 * 3600_000, why: "quota journalier atteint" } : { cooldownMs: 90_000, why: "limite de débit" }
  }
  if (st === 402 || st === 403 || /payment|billing|credit|not available for free|insufficient|forbidden|permission/i.test(msg))
    return { cooldownMs: 6 * 3600_000, why: "modèle non disponible avec cette clé", scope: "provider" }
  if (st === 401 || /user not found|invalid.*(api)?.?key|unauthori|authentication|credential/i.test(msg)) return { cooldownMs: 3600_000, why: "clé refusée", scope: "provider" }
  if ((st !== undefined && st >= 500) || st === 404 || /overloaded|unavailable|timeout|timed out|not found/i.test(msg))
    return { cooldownMs: 10 * 60_000, why: "modèle indisponible" }
  return null
}

type Known = { agent: Task; lastText: string; attempts: number; tried: Set<string>; ignore: boolean; ignoreUntil: number }

/**
 * Attribue à chaque agent le meilleur modèle disponible, et bascule sur le suivant quand un modèle est saturé :
 *  - de façon PRÉVENTIVE : compteur de requêtes (une « étape » = une requête) face aux plafonds de la table ;
 *  - de façon RÉACTIVE : erreur 429 / quota / modèle payant → le modèle est mis de côté un moment et le message est renvoyé.
 */
export class Router {
  readonly chains: Record<Task, Chain>
  private calls = new Map<string, number[]>() // groupe de limite → horodatages des requêtes
  private coolUntil = new Map<string, number>()
  private providerCoolUntil = new Map<string, number>()
  private known = new Map<string, Known>()

  constructor(
    private d: { client: OpenCodeClient; table: Table; notify: (sessionID: string, model: string, text: string) => void; now?: () => number },
    available: Set<string>,
  ) {
    this.chains = buildChains(d.table, available)
  }

  private now() {
    return this.d.now?.() ?? Date.now()
  }
  label(ref?: string) {
    return ref ? (this.d.table[ref]?.label ?? ref) : "?"
  }

  private cooling(ref: string) {
    const now = this.now()
    const provider = parseRef(ref).providerID
    const providerUntil = this.providerCoolUntil.get(provider) ?? 0
    if (providerUntil > now) return true
    if (providerUntil) this.providerCoolUntil.delete(provider)
    const explicitUntil = this.coolUntil.get(ref) ?? 0
    if (explicitUntil > now) return true
    if (explicitUntil) this.coolUntil.delete(ref)
    const lim = this.d.table[ref]?.limit
    if (!lim) return false
    const group = lim.shared ?? ref
    const ts = (this.calls.get(group) ?? []).filter((t) => t > now - 86_400_000)
    if (ts.length) this.calls.set(group, ts)
    else this.calls.delete(group)
    if (lim.perMinute && ts.filter((t) => t > now - 60_000).length >= Math.ceil(lim.perMinute * 0.9)) return true
    return !!lim.perDay && ts.length >= Math.ceil(lim.perDay * 0.9)
  }

  private cooldownUntil(ref: string) {
    const now = this.now()
    const provider = parseRef(ref).providerID
    const providerUntil = this.providerCoolUntil.get(provider) ?? 0
    if (providerUntil > now) return providerUntil
    if (providerUntil) this.providerCoolUntil.delete(provider)
    const explicit = this.coolUntil.get(ref) ?? 0
    if (explicit > now) return explicit
    return 0
  }

  /** Meilleur modèle actuellement disponible. Ne réessaie jamais volontairement un modèle refroidi. */
  pick(agent: Task, skip: Set<string> = new Set()): string | undefined {
    const chain = (this.chains[agent] ?? []).filter((m) => !skip.has(m.ref))
    return chain.find((m) => !this.cooling(m.ref))?.ref
  }

  /** Date de la prochaine disponibilité connue pour informer l'interface en cas de saturation globale. */
  nextAvailableAt(agent: Task, skip: Set<string> = new Set()): number | undefined {
    const candidates = (this.chains[agent] ?? []).filter((m) => !skip.has(m.ref))
    const times = candidates.map((m) => this.cooldownUntil(m.ref)).filter((t) => t > this.now())
    return times.length ? Math.min(...times) : undefined
  }

  /** Appelé avant chaque message de l'utilisateur : garantit que la session utilise le bon modèle. */
  async beforeSend(sessionID: string, text: string) {
    const info = await this.d.client.session.get({ sessionID })
    const rawAgent = String(info.agent ?? "")
    const agent: Task = (TASKS as readonly string[]).includes(rawAgent) ? (rawAgent as Task) : "code"
    this.known.set(sessionID, { agent, lastText: text, attempts: 0, tried: new Set(), ignore: false, ignoreUntil: 0 })
    const want = this.pick(agent)
    const cur = refOf(info.model)
    if (want && want !== cur) {
      await this.d.client.session.switchModel({ sessionID, model: parseRef(want) })
      if (cur) this.d.notify(sessionID, want, `Modèle : ${this.label(cur)} → ${this.label(want)} (priorité ${agent})`)
    }
  }

  onEvent(ev: AppEvent) {
    const d = ev.data as { sessionID?: string; model?: { providerID: string; id: string }; error?: { status?: number; message?: string } }
    if (ev.type === "session.step.started" && d.model) {
      const ref = refOf(d.model)!
      const group = this.d.table[ref]?.limit?.shared ?? ref
      this.calls.set(group, [...(this.calls.get(group) ?? []), this.now()])
    }
    if (ev.type === "session.execution.started" && d.sessionID) {
      const k = this.known.get(d.sessionID)
      if (k) k.ignore = false // la nouvelle exécution (après bascule) est surveillée à son tour
    }
    if (ev.type === "session.execution.succeeded" && d.sessionID) {
      this.known.delete(d.sessionID)
    }
    // L'INTERRUPTION ne termine plus le suivi : c'est le routeur lui-même qui interrompt la
    // session pour basculer (voir failover), et cet événement arrivait juste après — il
    // détruisait l'état du failover, qui ne pouvait donc jamais dépasser la première bascule.
    // La fin réelle du suivi reste : succeeded (ci-dessus), session supprimée (forget)
    // ou un beforeSend qui recrée l'entrée au message suivant.
    if (ev.type === "session.execution.interrupted" && d.sessionID) {
      const k = this.known.get(d.sessionID)
      if (k) k.ignore = false // prêt à surveiller la nouvelle exécution déclenchée par le failover
    }
    // OpenCode réessaie lui-même ~10 fois avec des délais (≈ 1 min 30) avant d'échouer : on n'attend pas, on bascule dès le 1er signal.
    if ((ev.type === "session.retry.scheduled" || ev.type === "session.execution.failed") && d.sessionID) {
      void this.failover(d.sessionID, d.error, ev.type === "session.retry.scheduled").catch((e) => console.error("router:", e))
    }
  }

  private async failover(sessionID: string, error: { status?: number; message?: string } | undefined, interrupt: boolean) {
    const k = this.known.get(sessionID)
    const cls = classifyError(error)
    if (!k || !cls) return // pas une session pilotée par nous, ou erreur qui n'est pas la faute du modèle
    if (k.ignore && this.now() < k.ignoreUntil) return // bascule déjà en cours pour cette saturation
    k.ignore = true
    k.ignoreUntil = this.now() + 10_000
    if (interrupt) await this.d.client.session.interrupt({ sessionID }).catch(() => undefined)
    const cur = refOf((await this.d.client.session.get({ sessionID })).model)
    if (cur) {
      this.coolUntil.set(cur, this.now() + cls.cooldownMs)
      if (cls.scope === "provider") this.providerCoolUntil.set(parseRef(cur).providerID, this.now() + cls.cooldownMs)
      k.tried.add(cur)
    }
    const next = ++k.attempts <= 4 ? this.pick(k.agent, k.tried) : undefined
    if (!next || next === cur) {
      const retryAt = this.nextAvailableAt(k.agent, k.tried)
      const wait = retryAt ? ` Prochaine disponibilité estimée dans ${Math.max(1, Math.ceil((retryAt - this.now()) / 1000))} s.` : ""
      this.d.notify(sessionID, cur ?? "", `${this.label(cur)} indisponible (${cls.why}) et aucun autre modèle disponible pour « ${k.agent} ». ${wait}`.trim())
      this.known.delete(sessionID)
      return
    }
    await this.d.client.session.switchModel({ sessionID, model: parseRef(next) })
    this.d.notify(sessionID, next, `${this.label(cur)} indisponible (${cls.why}) → bascule sur ${this.label(next)} et renvoi de ton message.`)
    // Renvoi du message SANS le dupliquer dans l'historique : `session.prompt()` persiste le
    // texte AVANT l'exécution, donc le re-prompter tel quel recopiait le message. On repère
    // le message utilisateur concerné, on le retire (stage + commit du revert, messages
    // seulement — jamais les fichiers), puis on le renvoie. Si une étape manque (session
    // déjà revenue, message introuvable…), on retombe sur l'ancien comportement : la
    // bascule passe avant la déduplication.
    let duplicateID: string | undefined
    try {
      const page = await this.d.client.message.list({ sessionID, order: "desc", limit: 10 })
      const lastUser = (page.data as { id?: unknown; type?: unknown; text?: unknown }[]).find((m) => m.type === "user")
      if (lastUser && typeof lastUser.id === "string" && String(lastUser.text ?? "").trim() === k.lastText) duplicateID = lastUser.id
    } catch {
      /* listing indisponible : fallback prompt ci-dessous */
    }
    if (duplicateID) {
      const staged = await this.d.client.session.revert
        .stage({ sessionID, messageID: duplicateID })
        .then(() => true)
        .catch(() => false)
      if (staged) await this.d.client.session.revert.commit({ sessionID }).catch(() => undefined)
    }
    await this.d.client.session.prompt({ sessionID, text: k.lastText })
  }

  /** Libère les données transitoires d'une session supprimée. */
  forget(sessionID: string) {
    this.known.delete(sessionID)
  }

  /** Attribution actuelle (pour l'affichage) : agent → liste ordonnée de modèles. */
  assignments() {
    return Object.fromEntries(Object.entries(this.chains).map(([t, c]) => [t, c.map(({ ref, label }) => ({ ref, label }))]))
  }
}

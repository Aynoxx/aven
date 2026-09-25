// Annonceur vocal Aven (v8.7.9) : les événements OpenCode deviennent de courtes phrases
// parlées via la voix Windows SAPI (gratuite, hors ligne, déjà installée).
//
// Règles d'or :
//   - COALESCENCE : si plusieurs événements arrivent pendant qu'une phrase est parlée,
//     on ne dit jamais une file d'attente — un seul état à jour est annoncé à la fin ;
//   - MUTE : une frappe de l'utilisateur (clic, touche) coupe la voix immédiatement et
//     vide la file — on ne parle jamais par-dessus quelqu'un qui tape ;
//   - GRAMMAIRE MINUSCULE : on résume l'état (« Terminé — 3 fichiers modifiés »), on ne
//     lit JAMAIS le contenu des réponses de l'agent.
// Sans dépendance à Electron : le runner SAPI est injectable (testable avec Node seul).

export type AnnounceEvent = {
  type: string
  data: Record<string, unknown>
}

export type AnnouncerDeps = {
  /** Exécute réellement la voix (PowerShell SAPI en production). Retourne quand la phrase est dite. */
  speak: (text: string) => Promise<void>
  /** Est-ce que l'utilisateur a tapé/cliqué depuis la dernière vérification ? */
  isMuted: () => boolean
  /** Horloge injectable (tests). */
  now?: () => number
  /** Fenêtre de stabilisation avant de parler (coalescence). 0 = immédiat. */
  settleMs?: number
}

type Phrase = { text: string; kind: "info" | "result" }

/**
 * Traduit un événement OpenCode en phrase (ou null si rien à dire).
 * Pure : testable sans exécuter de voix.
 */
export function phraseFor(ev: AnnounceEvent): Phrase | null {
  const d = ev.data ?? {}
  switch (ev.type) {
    case "session.execution.started":
      return { kind: "info", text: "C'est parti." }
    case "session.execution.succeeded": {
      const tools = Array.isArray(d.tools) ? (d.tools as { name?: string }[]) : []
      const edits = tools.filter((t) => t && ["edit", "write", "multiedit"].includes(String(t.name ?? ""))).length
      if (edits > 0) return { kind: "result", text: `Terminé — ${edits} fichier${edits > 1 ? "s" : ""} modifié${edits > 1 ? "s" : ""}.` }
      return { kind: "result", text: "Terminé." }
    }
    case "session.execution.failed": {
      const message = String((d.error as { message?: string } | undefined)?.message ?? "").trim()
      const short = message ? message.split(/[.\n]/)[0].slice(0, 90) : "raison inconnue"
      return { kind: "result", text: `Échec : ${short}.` }
    }
    case "session.execution.interrupted":
      return { kind: "result", text: "Interrompu." }
    case "permission.asked": {
      const action = String(d.action ?? "").trim() || "une action"
      return { kind: "info", text: `Aven demande la permission ${action === "write" ? "d’écrire un fichier" : action === "edit" ? "de modifier un fichier" : `« ${action} »`}. Réponds à l’écran.` }
    }
    case "router.notice": {
      const text = String(d.text ?? "")
      // On ne parle que des saturations (failover ou épuisement), pas du simple
      // changement de priorité (« Modèle : A → B (priorité code) ») qui est du bruit.
      if (/bascule sur/i.test(text)) return { kind: "info", text: "Modèle saturé, passage sur le suivant." }
      if (/indisponible/i.test(text)) return { kind: "info", text: "Tous les modèles de cet agent sont momentanément saturés." }
      return null
    }
    default:
      return null
  }
}

export class Announcer {
  private queue: Phrase[] = []
  private speaking = false
  private mutedUntil = 0
  private enabled = true
  private readonly deps: AnnouncerDeps

  constructor(deps: AnnouncerDeps) {
    this.deps = deps
  }

  setEnabled(on: boolean) {
    this.enabled = on
    if (!on) {
      this.queue = []
      this.mute(500) // évite qu'une phrase déjà lancée ne traîne
    } else {
      // Réactiver = vouloir les annonces tout de suite : on lève le mute résiduel.
      this.mutedUntil = 0
    }
  }

  isEnabled() {
    return this.enabled
  }

  /** L'utilisateur tape/clique : coupe tout, vide la file, verrouille la voix 3 s. */
  mute(ms = 3000) {
    this.queue = []
    this.mutedUntil = (this.deps.now?.() ?? Date.now()) + ms
  }

  /** Reçoit un événement OpenCode brut ; le traduit et met en file le cas échéant. */
  handle(ev: AnnounceEvent) {
    if (!this.enabled) return
    const phrase = phraseFor(ev)
    if (!phrase) return
    this.enqueue(phrase)
  }

  /** Met une phrase en file avec coalescence : les doublons du même type sont remplacés. */
  enqueue(phrase: Phrase) {
    if (!this.enabled) return
    if (this.deps.isMuted() || (this.deps.now?.() ?? Date.now()) < this.mutedUntil) return
    // Coalescence : ne jamais empiler deux phrases du même type — la plus récente gagne.
    this.queue = this.queue.filter((p) => p.kind !== phrase.kind)
    this.queue.push(phrase)
    void this.drain()
  }

  private settle(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private async drain() {
    if (this.speaking) return
    this.speaking = true
    try {
      while (this.queue.length) {
        const muted = () => this.deps.isMuted() || (this.deps.now?.() ?? Date.now()) < this.mutedUntil
        const next = this.queue.shift()!
        // Fenêtre de stabilisation : laisse passer les événements rapprochés pour que la
        // coalescence (du même type) s'applique même quand la première phrase est déjà
        // sortie de la file. Après la fenêtre, un mute annule tout.
        if (this.deps.settleMs) await this.settle(this.deps.settleMs)
        if (muted()) {
          this.queue = [] // coupé en plein discours : on abandonne la file
          return
        }
        // Une phrase plus récente du même type est arrivée pendant la fenêtre : c'est elle qu'on dit.
        const newer = [...this.queue].reverse().find((p) => p.kind === next.kind)
        const toSpeak = newer ? (this.queue = this.queue.filter((p) => p !== newer), newer) : next
        try {
          await this.deps.speak(toSpeak.text)
        } catch {
          return // la voix a échoué (SAPI indisponible) : on s'arrête proprement
        }
      }
    } finally {
      this.speaking = false
    }
  }
}

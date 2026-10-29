// v11.1.0 : machine à états de la session vocale. Le hook ne décide jamais seul :
// il émet des événements (le VAD a détecté une parole, une transcription est
// arrivée, la réponse est prête…) et lit la phase résultante. L'interruption et
// l'anti-mélange de demandes sont donc testables sans micro ni Tauri.
//
// Phases visibles :
//   muted       micro coupé (choix explicite, conservé dans prefs.json) ;
//   listening   écoute continue, mot d'activation requis ;
//   capturing   une parole est en cours ;
//   transcribing envoi du segment au STT distant ;
//   thinking    demande envoyée au LLM distant ;
//   speaking    réponse en cours de lecture (phrase par phrase) ;
//   error       erreur lisible (réseau, quota gratuit, micro refusé…).
//
// v11.12.0 : « Aven » n'est plus un sésame à répéter à chaque phrase. L'entendre
// met la session en VEILLE (mode éveillé) : la conversation continue sans le mot
// d'activation, chaque parole adressée prolonge la veille, et trois sorties
// seulement la terminent — un ordre de repos explicite (« Aven, dors »), le
// silence (AWAKE_IDLE_MS), ou la coupure du micro. La fenêtre de suivi de dix
// secondes de v11.1.0 était inutilisable : `speech-start` la remettait à zéro au
// moment même où la parole était capturée, donc la transcription qui suivait la
// trouvait TOUJOURS fermée — il fallait redire « Aven » à chaque phrase.
//
// Pur : testable avec Node seul, sans dépendance desktop ni réseau.

/** Silence qui rendort : la veille ne survit pas à une minute sans parole adressée. */
export const AWAKE_IDLE_MS = 60_000

export type VoicePhase =
  | "muted"
  | "listening"
  | "capturing"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error"

export type VoiceSessionState = {
  phase: VoicePhase
  micMuted: boolean
  /** Fin de la veille : avant cette échéance, « Aven » n'est plus nécessaire. */
  awakeUntil: number
  /** Identifiant de la demande en cours : une réponse d'un id périmé est ignorée. */
  requestId: number
  error?: string
  /** Dernière transcription utile (affichage seulement, jamais persistée). */
  heard?: string
  /** Dernière réponse (affichage seulement, jamais persistée). */
  reply?: string
}

export type VoiceSessionEvent =
  | { type: "mic"; muted: boolean }
  | { type: "speech-start" }
  | { type: "speech-end" }
  | { type: "transcribing" }
  | { type: "heard"; text: string }
  // v11.12.0 : le mot d'activation a été entendu (ou la conversation continue) —
  // la veille est ouverte et prolongée d'autant.
  | { type: "wake" }
  // v11.12.0 : ordre de repos explicite, ou échéance de veille atteinte.
  | { type: "sleep" }
  | { type: "thinking"; requestId: number }
  | { type: "speaking"; requestId: number; reply?: string }
  | { type: "done" }
  // v11.11.1 : parole entendue mais pas adressée à Aven (écho de sa propre voix)
  // — la lecture en cours garde la parole, la session ne perd rien.
  // v11.14.1 : même sort pour le bruit de la pièce en veille (hésitation, remarque
  // adressée à quelqu'un d'autre) : aucune réponse, et la veille n'est pas prolongée.
  | { type: "ignored"; reading: boolean }
  | { type: "interrupt" }
  | { type: "error"; message: string }
  | { type: "reset" }

export function initialVoiceSession(micMuted = false): VoiceSessionState {
  return {
    phase: micMuted ? "muted" : "listening",
    micMuted,
    awakeUntil: 0,
    requestId: 0,
  }
}

/**
 * Aven est-il en veille (mode éveillé) ? Une transcription est alors adressée à
 * lui sans mot d'activation. La veille ne dépend PAS de la phase : elle est lue
 * au moment de la transcription, quand la phase est forcément « capturing ».
 */
export function isAwake(state: VoiceSessionState, now = Date.now()): boolean {
  return !state.micMuted && state.awakeUntil > now
}

/**
 * Réduction pure. `now` est injecté pour que la veille soit testable sans
 * horloge réelle.
 */
export function reduceVoiceSession(
  state: VoiceSessionState,
  event: VoiceSessionEvent,
  now = Date.now(),
): VoiceSessionState {
  switch (event.type) {
    case "reset":
      return initialVoiceSession(state.micMuted)
    case "mic": {
      if (event.muted === state.micMuted) return state
      if (event.muted) {
        // Couper le micro arrête aussi toute lecture/attente en cours, et rendort
        // l'agent : le micro fermé n'écoute plus personne.
        return {
          ...state,
          micMuted: true,
          phase: "muted",
          awakeUntil: 0,
          requestId: state.requestId + 1,
          error: undefined,
        }
      }
      return { ...state, micMuted: false, phase: "listening", requestId: state.requestId + 1, error: undefined }
    }
    case "wake":
      if (state.micMuted) return state
      return { ...state, awakeUntil: now + AWAKE_IDLE_MS }
    case "sleep":
      return { ...state, awakeUntil: 0 }
    case "speech-start": {
      if (state.micMuted) return state
      if (state.phase === "capturing") return state
      // v11.11.1 : pendant une LECTURE, l'énergie détectée vient d'abord de la voix
      // de l'agent, reprise par les haut-parleurs. On capture la parole — c'est ce
      // qui permet une vraie reprise — mais SANS toucher à la requête : la changer
      // annulait le lecteur au retour de la synthèse, et la fin de la réponse
      // disparaissait même quand la lecture n'avait pas été arrêtée. La décision
      // tombe à la transcription (barge-in.ts, echo.ts).
      // v11.12.0 : et la VEILLE n'est plus remise à zéro ici — c'était le défaut :
      // capturer la parole fermait la veille, donc la transcription arrivait après
      // sa fermeture et le mot d'activation redevenait exigé.
      if (state.phase === "speaking") {
        return { ...state, phase: "capturing", error: undefined }
      }
      // Pendant la réflexion, il n'y a AUCUN son à reprendre : une parole détectée
      // est celle de l'utilisateur, et la demande en cours est bien abandonnée.
      if (state.phase === "thinking") {
        return { ...state, phase: "capturing", requestId: state.requestId + 1, error: undefined }
      }
      return { ...state, phase: "capturing", error: undefined }
    }
    case "speech-end":
      return state.phase === "capturing" ? { ...state, phase: "transcribing" } : state
    case "transcribing":
      return state.micMuted ? state : { ...state, phase: "transcribing" }
    case "heard": {
      if (state.micMuted) return state
      const text = String(event.text ?? "").trim()
      if (!text) return { ...state, phase: "listening", heard: undefined }
      return { ...state, heard: text }
    }
    case "thinking":
      return state.micMuted ? state : { ...state, phase: "thinking", requestId: event.requestId }
    case "speaking": {
      // Une réponse d'une demande périmée ne prend jamais la parole.
      if (state.micMuted || event.requestId !== state.requestId) return state
      return { ...state, phase: "speaking", reply: event.reply, error: undefined }
    }
    case "done":
      if (state.micMuted) return state
      // v11.15.2 : une capture (ou sa transcription) commencée pendant la lecture
      // n'appartient pas à la réponse qui se termine. L'écraser en « écoute »
      // laissait l'enregistreur ouvert sans phase pour l'arrêter : son speech-end
      // était ignoré et la parole suivante — la réponse à une question de l'agent —
      // n'était jamais transcrite. C'est ce défaut qui faisait croire que l'agent
      // avait oublié sa propre question.
      if (state.phase === "capturing" || state.phase === "transcribing") return state
      // La veille a été prolongée à l'acceptation de la parole ; la fin de lecture
      // ne la rouvre pas (sinon un écho suffirait à la prolonger).
      return { ...state, phase: "listening" }
    case "ignored": {
      if (state.micMuted) return state
      // La réponse se joue encore : on revient à « Lecture » sans rien perdre.
      // v11.14.1 : sans lecture, la parole non adressée rend la main à l'écoute —
      // la veille garde son échéance (une remarque de la pièce ne l'entretient pas).
      return { ...state, phase: event.reading ? "speaking" : "listening", error: undefined }
    }
    case "interrupt":
      // v11.12.0 : interrompre la lecture ne rendort PAS l'agent — on reprend la
      // parole pour parler, pas pour sortir de la conversation. Seuls le repos
      // explicite, le silence et la coupure du micro terminent la veille.
      return {
        ...state,
        phase: state.micMuted ? "muted" : "listening",
        requestId: state.requestId + 1,
        error: undefined,
      }
    case "error":
      return { ...state, phase: "error", error: String(event.message || "Erreur vocale inconnue."), awakeUntil: 0 }
    default:
      return state
  }
}

/** Libellé français de la phase, affiché dans le bandeau du Poste. */
export function voicePhaseLabel(phase: VoicePhase): string {
  switch (phase) {
    case "muted": return "Micro coupé"
    case "listening": return "Écoute"
    case "capturing": return "Parole détectée"
    case "transcribing": return "Transcription"
    case "thinking": return "Réflexion"
    case "speaking": return "Lecture"
    case "error": return "Erreur vocale"
  }
}

/**
 * Libellé du bandeau, veille comprise : « Éveillé » remplace « Écoute » tant que
 * « Aven » n'est plus nécessaire. L'état est un TEXTE, jamais une couleur seule.
 */
export function voiceStatusLabel(state: VoiceSessionState, now = Date.now()): string {
  if (state.phase === "listening" && isAwake(state, now)) return "Éveillé"
  return voicePhaseLabel(state.phase)
}

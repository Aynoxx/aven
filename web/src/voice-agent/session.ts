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
// Pur : testable avec Node seul, sans dépendance desktop ni réseau.

export const FOLLOW_UP_MS = 10_000

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
  /** Fin de la fenêtre (10 s) où « Aven » n'est plus nécessaire. */
  followUpUntil: number
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
  | { type: "thinking"; requestId: number }
  | { type: "speaking"; requestId: number; reply?: string }
  | { type: "done" }
  | { type: "interrupt" }
  | { type: "error"; message: string }
  | { type: "reset" }

export function initialVoiceSession(micMuted = false): VoiceSessionState {
  return {
    phase: micMuted ? "muted" : "listening",
    micMuted,
    followUpUntil: 0,
    requestId: 0,
  }
}

/** Une transcription sans mot d'activation est-elle acceptée à cet instant ? */
export function acceptsFollowUp(state: VoiceSessionState, now = Date.now()): boolean {
  return !state.micMuted && now < state.followUpUntil
}

/**
 * Réduction pure. `now` est injecté pour que la fenêtre de suivi soit testable
 * sans horloge réelle.
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
        // Couper le micro arrête aussi toute lecture/attente en cours.
        return {
          ...state,
          micMuted: true,
          phase: "muted",
          followUpUntil: 0,
          requestId: state.requestId + 1,
          error: undefined,
        }
      }
      return { ...state, micMuted: false, phase: "listening", requestId: state.requestId + 1, error: undefined }
    }
    case "speech-start": {
      if (state.micMuted) return state
      // Reprendre la parole interrompt la lecture ET invalide la réponse en attente.
      if (state.phase === "speaking" || state.phase === "thinking") {
        return { ...state, phase: "capturing", followUpUntil: 0, requestId: state.requestId + 1, error: undefined }
      }
      if (state.phase === "capturing") return state
      return { ...state, phase: "capturing", followUpUntil: 0, error: undefined }
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
      return { ...state, phase: "listening", followUpUntil: now + FOLLOW_UP_MS }
    case "interrupt":
      return {
        ...state,
        phase: state.micMuted ? "muted" : "listening",
        followUpUntil: 0,
        requestId: state.requestId + 1,
        error: undefined,
      }
    case "error":
      return { ...state, phase: "error", error: String(event.message || "Erreur vocale inconnue."), followUpUntil: 0 }
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

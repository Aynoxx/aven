// v11.1.0 : segmentation audio de l'agent vocal — détection d'activité vocale
// SANS IA locale. On mesure l'énergie (RMS) d'une trame d'analyse et on découpe
// la parole en segments : un début franc (N ms au-dessus du seuil), une fin après
// un silence court (M ms), et une durée maximale pour borner un envoi STT.
//
// Pourquoi pas un modèle local : le plan l'interdit. Le compromis est assumé et
// documenté dans les Réglages : tout segment jugé « parole » part chez le STT
// distant, y compris un bruit qui ressemble à de la voix. Le quota gratuit n'est
// donc pas illimité.
//
// Pur : testable avec Node seul, sans WebAudio ni DOM.
export type VadConfig = {
  /** Énergie RMS au-dessus de laquelle une trame est considérée comme de la voix. */
  threshold: number
  /** Durée minimale au-dessus du seuil avant d'ouvrir un segment. */
  startMs: number
  /** Silence minimal avant de fermer un segment. */
  endMs: number
  /** Durée maximale d'un segment (borne l'envoi STT et le quota). */
  maxMs: number
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  // Seuil mesuré sur un micro de bureau : le bruit de fond reste sous 0,01,
  // une voix proche monte au-dessus de 0,02. Réglable si le micro est faible.
  threshold: 0.012,
  startMs: 220,
  endMs: 700,
  maxMs: 15_000,
}

export type VadState = {
  speaking: boolean
  aboveSince: number | null
  belowSince: number | null
  startedAt: number | null
}

export function initialVadState(): VadState {
  return { speaking: false, aboveSince: null, belowSince: null, startedAt: null }
}

/**
 * Consomme une trame d'énergie. Émet « speech-start » quand la parole commence
 * et « speech-end » quand le segment doit être transcrit ; sinon `event: null`.
 */
export function vadStep(
  state: VadState,
  rms: number,
  now: number,
  config: VadConfig = DEFAULT_VAD_CONFIG,
): { state: VadState; event: "speech-start" | "speech-end" | null } {
  const energy = Number.isFinite(rms) ? Math.max(0, rms) : 0

  if (!state.speaking) {
    if (energy < config.threshold) {
      return { state: { ...state, aboveSince: null }, event: null }
    }
    const aboveSince = state.aboveSince ?? now
    if (now - aboveSince < config.startMs) {
      return { state: { ...state, aboveSince }, event: null }
    }
    return {
      state: { speaking: true, aboveSince: null, belowSince: null, startedAt: now },
      event: "speech-start",
    }
  }

  // Segment ouvert : durée maximale d'abord (un long monologue est découpé).
  if (state.startedAt !== null && now - state.startedAt >= config.maxMs) {
    return { state: initialVadState(), event: "speech-end" }
  }

  if (energy >= config.threshold) {
    return { state: { ...state, belowSince: null }, event: null }
  }

  const belowSince = state.belowSince ?? now
  if (now - belowSince >= config.endMs) {
    return { state: initialVadState(), event: "speech-end" }
  }
  return { state: { ...state, belowSince }, event: null }
}

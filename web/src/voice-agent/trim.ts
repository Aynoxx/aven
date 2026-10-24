// v11.3.0 : coupe des silences que le service ajoute autour de chaque réponse.
// Mesuré sur Denise (24 kHz) : ~150 ms avant le premier mot, ~900 ms après le
// dernier. Sans coupe, la fin de réponse gardait l'agent en « Lecture » près d'une
// seconde de trop, et le début paraissait mou.
// Pur : testable avec Node seul (aucun AudioContext, aucune dépendance web).
export const TRIM_THRESHOLD = 0.002 // ≈ -54 dBFS : sous le souffle, jamais dans la voix
export const TRIM_MARGIN_MS = 40 // on conserve l'attaque de la consonne

/**
 * Plage utile d'un échantillon décodé, en indices (`end` exclu).
 * Rend `{ start: 0, end: 0 }` pour un buffer entièrement silencieux.
 */
export function trimRange(samples: Float32Array, sampleRate: number): { start: number; end: number } {
  if (!samples.length || !(sampleRate > 0)) return { start: 0, end: 0 }
  let first = -1
  for (let index = 0; index < samples.length; index++) {
    if (Math.abs(samples[index]) > TRIM_THRESHOLD) {
      first = index
      break
    }
  }
  if (first < 0) return { start: 0, end: 0 }
  let last = first
  for (let index = samples.length - 1; index > first; index--) {
    if (Math.abs(samples[index]) > TRIM_THRESHOLD) {
      last = index
      break
    }
  }
  const margin = Math.round((TRIM_MARGIN_MS / 1000) * sampleRate)
  return {
    start: Math.max(0, first - margin),
    end: Math.min(samples.length, last + 1 + margin),
  }
}

// v11.3.0 : raccourcit les pauses INTERNES d'une réponse lue.
// Mesuré sur le service : ~1 s entre deux phrases, alors qu'une conversation
// française tient autour de 400 ms. Le débit global (rate) reste à 0 % — c'est la
// longueur des silences qui donnait l'impression de lenteur, pas la vitesse des
// mots (essai à +8 % et +16 % : écarté).
// La coupe tombe au milieu d'un silence à moins de -54 dBFS : pas de clic, et les
// consonnes ne sont jamais rognées.
// Pur : testable avec Node seul (aucun AudioContext).
export const PAUSE_MAX_MS = 650 // au-delà, la pause est trop longue pour une réponse
export const PAUSE_TARGET_MS = 420 // longueur conservée (rythme conversationnel)
export const PAUSE_THRESHOLD = 0.002 // même seuil que la coupe des extrémités

export type CompressedAudio = {
  samples: Float32Array
  /** Millisecondes retirées des silences internes. */
  removedMs: number
  /** Nombre de pauses raccourcies. */
  cuts: number
}

/**
 * Raccourcit chaque silence interne plus long que `maxPauseMs` à `targetPauseMs`.
 * Les silences de tête et de queue ne sont pas traités ici (voir trim.ts).
 */
export function compressPauses(
  samples: Float32Array,
  sampleRate: number,
  options: { maxPauseMs?: number; targetPauseMs?: number; threshold?: number } = {},
): CompressedAudio {
  const maxPauseMs = options.maxPauseMs ?? PAUSE_MAX_MS
  const targetPauseMs = options.targetPauseMs ?? PAUSE_TARGET_MS
  const threshold = options.threshold ?? PAUSE_THRESHOLD
  if (!samples.length || !(sampleRate > 0) || targetPauseMs >= maxPauseMs) {
    return { samples, removedMs: 0, cuts: 0 }
  }
  const msToSamples = (ms: number) => Math.round((ms / 1000) * sampleRate)

  const segments: Float32Array[] = []
  let removed = 0
  let cuts = 0
  let copied = 0
  let index = 0
  while (index < samples.length) {
    // Repère un silence (valeur absolue sous le seuil) qui ne touche pas les bords.
    if (Math.abs(samples[index]) > threshold) {
      index++
      continue
    }
    let end = index
    while (end < samples.length && Math.abs(samples[end]) <= threshold) end++
    const isInternal = index > 0 && end < samples.length
    const lengthMs = ((end - index) / sampleRate) * 1000
    if (isInternal && lengthMs > maxPauseMs) {
      const keep = Math.min(end - index, msToSamples(targetPauseMs))
      const cutFrom = index + keep
      segments.push(samples.subarray(copied, cutFrom))
      removed += ((end - cutFrom) / sampleRate) * 1000
      cuts++
      copied = end
    }
    index = end
  }
  if (!cuts) return { samples, removedMs: 0, cuts: 0 }
  segments.push(samples.subarray(copied))
  const total = segments.reduce((sum, segment) => sum + segment.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const segment of segments) {
    out.set(segment, offset)
    offset += segment.length
  }
  return { samples: out, removedMs: Math.round(removed), cuts }
}

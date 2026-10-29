// v11.10.0 : mise en forme du PCM de la voix locale — niveau et silences.
// Pourquoi ce module existe : mesuré le 2026-10-27 sur le moteur livré, la voix
// clonée sortait 2,4 dB sous Piper Tom à phrase identique (RMS des trames voisées :
// −22,8 contre −20,4 dBFS, et −6,3 dBFS de crête contre 0,0) ; chaque réponse se
// terminait par 420 à 600 ms de silence, et la voix intégrée du même moteur par
// 590 ms. Joué tel quel, l'agent paraissait sourd (il fallait monter le volume)
// et traînait à la fin de chaque phrase.
//
// La règle n'est pas inventée ici : c'est celle que le chemin Edge applique déjà
// au décodage complet — coupe des silences de tête et de queue
// (`web/src/voice-agent/trim.ts`) et pauses internes de plus de 650 ms ramenées à
// 420 ms (`web/src/voice-agent/pause.ts`). Les seuils et la marge sont les mêmes,
// pour que les deux voix s'entendent de la même façon.
//
// Ce qui change par rapport à Edge : ici tout est en FLUX. Le silence de queue ne
// se reconnaît qu'à la fin — on le retient donc jusqu'à ce qu'une parole le suive,
// et on le jette si le flux se termine. Le silence de tête est retenu de la même
// façon (avec la marge d'attaque), et une pause interne n'est livrée que bornée.
//
// Pur : testable avec Node seul, sans AudioContext ni processus.
export const PCM_LEVEL_GAIN_DB = 2.5
/**
 * Seuil de silence sur des échantillons 16 bits : 65 ≈ −54 dBFS, le même seuil
 * que `trim.ts` et `pause.ts` (0,002 en flottant, où 1,0 vaut 32768).
 */
export const PCM_SILENCE_THRESHOLD = 65
/** Marge conservée avant la première consonne : 40 ms, comme `trim.ts`. */
export const PCM_TRIM_MARGIN_MS = 40
/** Au-delà, une pause interne est trop longue pour une réponse. */
export const PCM_PAUSE_MAX_MS = 650
/** Longueur conservée d'une pause trop longue — le rythme conversationnel d'Edge. */
export const PCM_PAUSE_TARGET_MS = 420
/** Durée d'analyse : 10 ms. Assez court pour ne pas rogner une attaque. */
export const PCM_FRAME_MS = 10

/**
 * Applique un gain aux échantillons, en place, avec saturation. La saturation
 * compte : un gain appliqué sans borne produirait un repli de signe sur les
 * crêtes, c'est-à-dire un craquement à chaque mot fort.
 */
export function applyPcmGain(samples: Int16Array, gainDb: number): void {
  if (!gainDb) return
  const gain = 10 ** (gainDb / 20)
  for (let index = 0; index < samples.length; index++) {
    const value = Math.round((samples[index] ?? 0) * gain)
    samples[index] = value > 32767 ? 32767 : value < -32768 ? -32768 : value
  }
}

export type PcmShaperOptions = {
  /** Fréquence du moteur (24 kHz pour Pocket TTS). */
  sampleRate: number
  /** Gain à appliquer avant l'analyse. 0 = niveau du moteur, inchangé. */
  gainDb?: number
  marginMs?: number
  pauseMaxMs?: number
  pauseTargetMs?: number
}

export type PcmShaper = {
  /** Reçoit des octets PCM 16 bits petit-boutistes, rend ce qui doit être joué. */
  push(bytes: Uint8Array): Uint8Array
  /** Termine le flux : jette le silence de queue retenu. */
  end(): Uint8Array
}

/** Rend les échantillons en octets PCM 16 bits petit-boutistes. */
function encode(segments: Int16Array[]): Uint8Array {
  let total = 0
  for (const segment of segments) total += segment.length
  if (!total) return new Uint8Array(0)
  const bytes = new Uint8Array(total * 2)
  const view = new DataView(bytes.buffer)
  let at = 0
  for (const segment of segments) {
    for (let index = 0; index < segment.length; index++) {
      view.setInt16(at, segment[index] ?? 0, true)
      at += 2
    }
  }
  return bytes
}

/**
 * Crée la mise en forme d'un flux. Un seul état, donc un seul flux par instance :
 *   - le silence de tête est jeté, à l'exception de la marge d'attaque ;
 *   - une pause interne plus longue que `pauseMaxMs` est ramenée à
 *     `pauseTargetMs` (les plus courtes passent intactes) ;
 *   - le silence de queue est jeté par `end()`.
 * L'octet orphelin d'un paquet impair est reporté : un paquet peut finir au
 * milieu d'un échantillon, et le perdre décalerait tout le reste du flux.
 */
export function createPcmShaper(options: PcmShaperOptions): PcmShaper {
  const sampleRate = options.sampleRate
  if (!(sampleRate > 0)) throw new Error("Fréquence d'échantillonnage invalide.")
  const frame = Math.max(1, Math.round((PCM_FRAME_MS / 1000) * sampleRate))
  const marginFrames = Math.max(0, Math.round((options.marginMs ?? PCM_TRIM_MARGIN_MS) / PCM_FRAME_MS))
  const pauseMaxFrames = Math.max(0, Math.round((options.pauseMaxMs ?? PCM_PAUSE_MAX_MS) / PCM_FRAME_MS))
  const pauseTargetFrames = Math.min(pauseMaxFrames, Math.max(0, Math.round((options.pauseTargetMs ?? PCM_PAUSE_TARGET_MS) / PCM_FRAME_MS)))
  const gainDb = options.gainDb ?? 0

  let carry = new Uint8Array(0)
  let rest = new Int16Array(0)
  let speaking = false
  // Silences retenus avant la première parole : jamais plus que la marge.
  let lead: Int16Array[] = []
  // Silence interne en cours : livré dès qu'une parole le suit.
  const pause: Int16Array[] = []
  let pauseCut = false

  const isVoiced = (frameSamples: Int16Array): boolean => {
    for (let index = 0; index < frameSamples.length; index++) {
      if (Math.abs(frameSamples[index] ?? 0) > PCM_SILENCE_THRESHOLD) return true
    }
    return false
  }

  /** Traite les trames complètes ; rend les segments à livrer dans l'ordre. */
  const process = (samples: Int16Array): Int16Array[] => {
    const out: Int16Array[] = []
    for (let at = 0; at + frame <= samples.length; at += frame) {
      const current = samples.subarray(at, at + frame)
      const voiced = isVoiced(current)
      if (!speaking) {
        if (!voiced) {
          lead.push(current)
          if (lead.length > marginFrames) lead.shift()
          continue
        }
        // Première parole : la marge d'attaque est livrée avec elle.
        speaking = true
        for (const kept of lead) out.push(kept)
        lead = []
        out.push(current)
        continue
      }
      if (voiced) {
        for (const held of pause) out.push(held)
        pause.length = 0
        pauseCut = false
        out.push(current)
        continue
      }
      // Pause déjà ramenée : le silence qui suit est jeté, sinon la pause
      // reprendrait sa longueur d'origine à la reprise de la parole.
      if (pauseCut) continue
      pause.push(current)
      // Pause trop longue : on garde son DÉBUT (le silence après la dernière
      // syllabe) et on jette le reste — c'est ce que fait `pause.ts` hors flux.
      if (pause.length > pauseMaxFrames) {
        pause.length = pauseTargetFrames
        pauseCut = true
      }
    }
    return out
  }

  const push = (bytes: Uint8Array): Uint8Array => {
    if (!bytes.length) return new Uint8Array(0)
    const joined = new Uint8Array(carry.length + bytes.length)
    joined.set(carry, 0)
    joined.set(bytes, carry.length)
    const usable = joined.length - (joined.length % 2)
    carry = joined.slice(usable)
    const fresh = new Int16Array(usable / 2)
    const view = new DataView(joined.buffer, joined.byteOffset, usable)
    for (let index = 0; index < fresh.length; index++) fresh[index] = view.getInt16(index * 2, true)
    applyPcmGain(fresh, gainDb)

    // Un paquet ne tombe pas sur une frontière de trame : le reste est reporté.
    const merged = new Int16Array(rest.length + fresh.length)
    merged.set(rest, 0)
    merged.set(fresh, rest.length)
    const complete = merged.length - (merged.length % frame)
    rest = merged.slice(complete)
    return encode(process(merged.subarray(0, complete)))
  }

  const end = (): Uint8Array => {
    // Le silence de queue est jeté : c'est tout l'intérêt du report. L'octet
    // orphelin l'est aussi (une moitié d'échantillon ne s'entend pas).
    const tail = rest
    rest = new Int16Array(0)
    carry = new Uint8Array(0)
    if (!speaking) return new Uint8Array(0)
    pause.length = 0
    pauseCut = false
    // Les échantillons incomplets restants ne sont pas une trame : on les rend
    // seulement s'ils portent du son, pour ne pas couper une fin de consonne.
    return tail.length && isVoiced(tail) ? encode([tail]) : new Uint8Array(0)
  }

  return { push, end }
}

/** Mise en forme d'un bloc complet (aperçu des Réglages, chemin non diffusé). */
export function shapePcm(bytes: Uint8Array, options: PcmShaperOptions): Uint8Array {
  const shaper = createPcmShaper(options)
  const head = shaper.push(bytes)
  const tail = shaper.end()
  if (!tail.length) return head
  const joined = new Uint8Array(head.length + tail.length)
  joined.set(head, 0)
  joined.set(tail, head.length)
  return joined
}

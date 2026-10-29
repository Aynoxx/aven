// v11.3.0 : lecture de l'audio neuronal dans la webview.
// Pourquoi ici et pas dans le host : Chromium décode le MP3 et enchaîne les phrases
// sans nouveau processus — le chemin PowerShell jetable coûtait ~1,9 s par phrase
// (mesuré) et coupait la voix entre deux phrases.
// L'audio ne touche jamais le disque : il arrive en base64, est décodé en mémoire,
// et disparaît une fois joué.
import type { VoiceSpeech } from "../types"
// v11.3.0 : la plage utile est calculée par un module pur testé, pas au jugé.
import { trimRange } from "./trim"
// v11.3.0 : ~1 s entre deux phrases, c'est trop pour une réponse parlée.
import { compressPauses } from "./pause"

let context: AudioContext | null = null
let current: AudioBufferSourceNode | null = null
// v11.5.3 : le flux MSE (stream.ts) s'enregistre ici. Une interruption coupe
// alors TOUTE lecture — y compris un flux en cours — sans import circulaire.
const stoppers = new Set<() => void>()

export function registerVoicePlaybackStopper(stop: () => void): () => void {
  stoppers.add(stop)
  return () => { stoppers.delete(stop) }
}

function ensureContext(): AudioContext {
  if (!context) context = new AudioContext()
  return context
}

/** Décode une chaîne base64 en octets — supporté partout dans la webview. */
export function decodeBase64(value: string): Uint8Array {
  const binary = atob(String(value ?? ""))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Coupe la phrase ou le flux en cours. Idempotent. */
export function stopVoicePlayback(): void {
  for (const stop of [...stoppers]) {
    try { stop() } catch { /* déjà arrêté */ }
  }
  if (!current) return
  try { current.stop() } catch { /* déjà terminé */ }
  current = null
}

/**
 * Joue l'audio d'une réponse du host. Rend `true` si quelque chose a été joué,
 * `false` quand le host a parlé lui-même (voix Windows locale) ou n'a rien envoyé.
 */
export async function playVoiceSpeech(speech: VoiceSpeech | undefined | null): Promise<boolean> {
  if (!speech?.audio) return false
  stopVoicePlayback()
  const audioContext = ensureContext()
  // v11.1.1 : la politique d'autoplay peut suspendre le contexte ; un clic sur le
  // micro l'a déjà réveillé, mais on retente ici sans jamais bloquer la réponse.
  if (audioContext.state === "suspended") await audioContext.resume().catch(() => undefined)
  const bytes = decodeBase64(speech.audio)
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const buffer = await audioContext.decodeAudioData(copy)
  // v11.3.0 : le service laisse ~150 ms avant le premier mot et ~900 ms après le
  // dernier (mesuré) — on joue la plage utile. Les pauses INTERNES de plus de
  // 650 ms sont ramenées à ~420 ms : c'est ce qui donnait l'impression de lenteur,
  // pas la vitesse des mots (le débit reste à 0 %).
  const range = trimRange(buffer.getChannelData(0), buffer.sampleRate)
  if (range.end <= range.start) return false
  let playBuffer: AudioBuffer = buffer
  let offset = range.start / buffer.sampleRate
  let duration = (range.end - range.start) / buffer.sampleRate
  // Mono uniquement (le format demandé) : couper des canaux séparément décalerait
  // les voix l'une par rapport à l'autre.
  if (buffer.numberOfChannels === 1) {
    const compressed = compressPauses(buffer.getChannelData(0).subarray(range.start, range.end), buffer.sampleRate)
    if (compressed.cuts) {
      playBuffer = audioContext.createBuffer(1, compressed.samples.length, buffer.sampleRate)
      // `set` plutôt que `copyToChannel` : le type d'un Float32Array issu d'un
      // sous-tableau n'est pas garanti adossé à un ArrayBuffer par TypeScript.
      playBuffer.getChannelData(0).set(compressed.samples)
      offset = 0
      duration = compressed.samples.length / buffer.sampleRate
    }
  }
  const source = audioContext.createBufferSource()
  source.buffer = playBuffer
  source.connect(audioContext.destination)
  current = source
  await new Promise<void>((resolve) => {
    source.onended = () => resolve()
    source.start(0, offset, duration)
  })
  if (current === source) current = null
  return true
}

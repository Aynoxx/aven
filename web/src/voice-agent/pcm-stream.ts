// v11.10.0 : lecture du flux PCM de la voix locale Pocket TTS.
// Pourquoi ce lecteur à part : MediaSource — le chemin d'Edge — n'accepte pas
// d'échantillons nus. Le host envoie du PCM 16 bits mono 24 kHz par paquets de
// ~0,55 s ; ici, chaque paquet devient un AudioBuffer programmé sur l'horloge de
// l'AudioContext, ce qui enchaîne les paquets sans trou et laisse le premier son
// partir dès le premier d'entre eux (mesuré : 270 ms, contre ~2,4 s si l'on
// attendait le WAV complet).
//
// Deux pièges connus sont traités ici, pas ailleurs :
//   - l'abonnement au flux vient de `registerStreamSink`, installé AVANT l'appel
//     (créer un écouteur après la commande perdait toutes les trames, v11.5.3) ;
//   - un paquet peut finir au milieu d'un échantillon : l'octet orphelin est
//     reporté sur le paquet suivant par `pcmSamples`.
import { decodeBase64, registerVoicePlaybackStopper } from "./playback"
import { PCM_SAMPLE_RATE, pcmChunkPlan, pcmSamples, pcmSeconds, shouldStartPlayback } from "./pcm-schedule"
import { registerStreamSink, type VoiceStreamPlayer } from "./stream"

/** Sans aucune trame, on rend la main : le host est en repli, pas en lecture. */
const FIRST_CHUNK_TIMEOUT_MS = 12_000
/** Marge après la fin annoncée du dernier paquet, avant de rendre la main. */
const END_WATCHDOG_MS = 2_000

/** Vrai si la webview sait empiler du PCM dans une horloge audio. */
export function isPcmStreamSupported(): boolean {
  try {
    return typeof AudioContext === "function"
  } catch {
    return false
  }
}

/**
 * Prépare la lecture d'un flux PCM. Rend `null` — et l'appelant garde le chemin
 * complet (WAV d'un bloc) — quand la webview ne peut pas ouvrir d'AudioContext.
 */
export function createPcmStream(streamId: string): VoiceStreamPlayer | null {
  if (!isPcmStreamSupported()) return null
  let context: AudioContext
  try {
    context = new AudioContext({ sampleRate: PCM_SAMPLE_RATE })
  } catch {
    return null
  }
  // Le clic sur le micro a déjà débloqué l'audio ; on retente sans jamais bloquer.
  void context.resume().catch(() => undefined)

  let cursor = 0
  let bufferedMs = 0
  // L'octet orphelin peut venir d'un sous-tableau : `ArrayBufferLike` est donc
  // nécessaire, sinon TypeScript refuse de lui réaffecter le reste d'un paquet.
  let carry: Uint8Array<ArrayBufferLike> = new Uint8Array(0)
  let sawChunk = false
  let ended = false
  let started = false
  let finished = false
  let firstTimer = 0
  let endTimer = 0
  const pending: Int16Array[] = []
  const nodes = new Set<AudioBufferSourceNode>()
  let unregister: () => void = () => undefined
  let resolveDone: (played: boolean) => void = () => undefined
  const done = new Promise<boolean>((resolve) => { resolveDone = resolve })

  const cleanup = () => {
    window.clearTimeout(firstTimer)
    window.clearTimeout(endTimer)
    try { unregister() } catch { /* déjà retiré */ }
    for (const node of nodes) {
      try { node.stop() } catch { /* déjà terminé */ }
    }
    nodes.clear()
    try { void context.close() } catch { /* déjà fermé */ }
  }

  const settle = (played: boolean) => {
    if (finished) return
    finished = true
    cleanup()
    resolveDone(played)
  }

  const maybeFinish = () => {
    // v11.12.1 : on ne rend JAMAIS la main avec des échantillons reçus et non
    // programmés — c'est exactement l'audio qui manquait à la fin (mesuré :
    // 1,07 s jouée sur une réponse de ~9 s).
    if (!ended || nodes.size || pending.length) return
    window.clearTimeout(endTimer)
    settle(true)
  }

  /** Programme les paquets en attente, bout à bout, sur l'horloge audio. */
  const flushPending = () => {
    while (pending.length) {
      const samples = pending.shift()
      if (!samples?.length) continue
      const buffer = context.createBuffer(1, samples.length, PCM_SAMPLE_RATE)
      const channel = buffer.getChannelData(0)
      for (let i = 0; i < samples.length; i++) channel[i] = samples[i]! / 32768
      const plan = pcmChunkPlan(cursor, context.currentTime, pcmSeconds(samples.length))
      cursor = plan.cursor
      const node = context.createBufferSource()
      node.buffer = buffer
      node.connect(context.destination)
      nodes.add(node)
      node.onended = () => {
        nodes.delete(node)
        maybeFinish()
      }
      node.start(plan.startAt)
    }
  }

  // v11.5.3 : le lecteur s'enregistre dans la carte partagée ; l'abonnement unique
  // (installé au chargement du module) lui remet ses trames par identifiant. Une
  // interruption (bouton, Échap, nouvelle réponse) coupe aussi ce flux.
  unregister = (() => {
    const removeSink = registerStreamSink(streamId, (event) => {
      const data = event.data
      if (event.type === "voice.stream.chunk") {
        if (!data.audio) return
        const bytes = decodeBase64(data.audio)
        const { samples, carry: rest } = pcmSamples(bytes, carry)
        carry = rest
        if (!sawChunk) {
          sawChunk = true
          window.clearTimeout(firstTimer)
        }
        if (!samples.length) return
        pending.push(samples)
        bufferedMs += pcmSeconds(samples.length) * 1000
        // v11.12.1 : chaque paquet est programmé DÈS SON ARRIVÉE, pas seulement le
        // premier ni à la fin. Avant ce correctif, seul le lot initial partait :
        // tout le reste attendait dans `pending`, et la fin de lecture — qui ne
        // voyait plus aucun nœud en cours — rendait la main en le jetant. La
        // réponse s'arrêtait après ~1 s (mesuré le 2026-10-28 : 1,07 s jouée sur
        // une confirmation de note de ~9 s, aucun arrêt, phase revenue à « Écoute »).
        if (!started) {
          if (!shouldStartPlayback(bufferedMs, ended)) return
          started = true
          bufferedMs = 0
        }
        flushPending()
        return
      }
      if (event.type === "voice.stream.end") {
        ended = true
        if (!sawChunk) {
          settle(false)
          return
        }
        // v11.12.1 : le reliquat reçu mais non programmé part MAINTENANT, même si
        // la lecture a déjà commencé — c'est le cas courant d'un flux plus rapide
        // que la lecture. Sans ce vidage, la fin rendait la main sans jouer.
        started = true
        bufferedMs = 0
        flushPending()
        // La fin annoncée peut précéder la fin réelle du dernier paquet : on rend
        // la main un peu après son heure théorique si aucun `ended` n'arrive.
        endTimer = window.setTimeout(
          () => settle(true),
          Math.max(0, (cursor - context.currentTime) * 1000) + END_WATCHDOG_MS,
        )
        maybeFinish()
        return
      }
      if (event.type === "voice.stream.error") settle(false)
    })
    const removeStopper = registerVoicePlaybackStopper(() => settle(false))
    return () => {
      removeSink()
      removeStopper()
    }
  })()

  // Aucune trame : le host prépare un repli complet. On ne laisse pas la promesse
  // pendante — l'appelant joue le repli dès que l'appel rend la main.
  firstTimer = window.setTimeout(() => { if (!sawChunk) settle(false) }, FIRST_CHUNK_TIMEOUT_MS)

  return {
    done,
    cancel: () => settle(false),
  }
}

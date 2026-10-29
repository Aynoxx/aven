// v11.5.3 : carte partagée des lecteurs de flux et abonnement unique aux
// événements du host.
// v11.14.0 : le lecteur WebM/Opus (MediaSource) a été retiré avec les voix
// neuronales d'Edge ; il ne reste que le lecteur PCM du moteur local
// (pcm-stream.ts). Ce module garde la CARTE et l'abonnement — un seul, installé
// au chargement : deux écouteurs se disputeraient les trames, et un abonné créé
// après la commande perdrait toutes les trames (piège mesuré en v11.5.3).
import { api } from "../api"

export type VoiceStreamPlayer = {
  /** Vrai si l'audio a été joué jusqu'au bout. */
  done: Promise<boolean>
  /** Coupe la lecture en cours (interruption, repli, démontage). Idempotent. */
  cancel: () => void
}

export type StreamEvent = { type: string; data: { streamId?: string; audio?: string; message?: string } }
type StreamSink = (event: StreamEvent) => void
const sinks = new Map<string, StreamSink>()
let listening = false

/**
 * v11.10.0 : inscrit un lecteur dans la carte partagée. L'empilement audio du
 * PCM local y vit ; un abonné peut aussi être ajouté avant que le lecteur existe
 * (l'abonnement du module remet alors les trames à leur arrivée).
 * Un seul abonnement demeure (celui du chargement), donc aucune trame n'est perdue.
 */
export function registerStreamSink(streamId: string, sink: StreamSink): () => void {
  installVoiceStreamListener()
  sinks.set(streamId, sink)
  return () => {
    sinks.delete(streamId)
  }
}

/**
 * v11.5.3 : l'abonnement vit au chargement du module, PAS au moment de la réponse.
 * `listen` est un invoke asynchrone : créé juste avant `voiceAgentSayStream`, il
 * était traité après la commande bloquante — les trames partaient du host mais
 * n'arrivaient jamais au lecteur (mesuré : 0 trame sur 6, 12 s d'attente, aucun
 * son). Installé bien avant la première réponse, il supprime cette course.
 * Aucun listen par réponse : l'abonnement unique est celui du chargement.
 */
export function installVoiceStreamListener(): void {
  if (listening) return
  listening = true
  api.onEvent((event) => {
    if (!event.type.startsWith("voice.stream.")) return
    const data = (event.data ?? {}) as StreamEvent["data"]
    if (!data.streamId) return
    sinks.get(data.streamId)?.({ type: event.type, data })
  })
}

// Le module est importé au démarrage (par le hook vocal) : l'abonnement est donc
// en place avant que l'utilisateur puisse déclencher une réponse.
installVoiceStreamListener()

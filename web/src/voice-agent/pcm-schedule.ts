// v11.10.0 : lecture d'un flux PCM dans la webview (voix locale Pocket TTS).
// Pourquoi ce module existe : MediaSource — le chemin d'Edge — ne lit pas
// d'échantillons nus. Le host envoie donc du PCM 16 bits mono 24 kHz par paquets
// de ~0,55 s ; ici, on les empile dans un AudioContext en les enchaînant sans
// trou. Deux décisions méritent d'être testées hors du navigateur :
//   1. où reprendre le curseur de lecture quand un paquet arrive après l'heure
//      (l'audio ne doit jamais être programmé « par-dessus » le précédent) ;
//   2. comment traiter un paquet de longueur IMPAIRE : le dernier octet est la
//      moitié d'un échantillon, et le perdre décalerait tout le reste du flux.
// Toutes les durées de ce module sont en SECONDES d'horloge audio, comme
// `AudioContext.currentTime` — une seule unité, donc aucun facteur 1000 oublié.
// Pur : testable avec Node seul, sans navigateur.
/** Décalage initial : laisse au navigateur une marge avant le premier son. */
export const PCM_START_DELAY_S = 0.08
/**
 * Démarrage dès qu'un paquet est là : les paquets font déjà ~0,55 s, attendre
 * davantage n'ajouterait que du silence au début. Le seuil sert aux paquets
 * courts d'un moteur plus rapide que la lecture.
 */
export const PCM_MIN_BUFFER_MS = 250
/** Fréquence du moteur (24 kHz) : miroir de `host/pocket-tts.ts`. */
export const PCM_SAMPLE_RATE = 24_000

/**
 * Convertit des octets PCM 16 bits signés en échantillons, en reportant l'octet
 * orphelin d'un paquet impair sur le paquet suivant : un paquet sur deux peut
 * finir au milieu d'un échantillon, et couper là produirait un clic à chaque
 * reprise (et décalerait tout le flux).
 */
export function pcmSamples(
  bytes: Uint8Array,
  carry: Uint8Array = new Uint8Array(0),
): { samples: Int16Array; carry: Uint8Array } {
  const joined = new Uint8Array(carry.length + bytes.length)
  joined.set(carry, 0)
  joined.set(bytes, carry.length)
  const usable = joined.length - (joined.length % 2)
  const samples = new Int16Array(usable / 2)
  const view = new DataView(joined.buffer, joined.byteOffset, usable)
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true)
  return { samples, carry: joined.subarray(usable) }
}

/** Durée d'un lot d'échantillons, en secondes d'horloge audio. */
export function pcmSeconds(sampleCount: number, sampleRate: number = PCM_SAMPLE_RATE): number {
  return sampleCount / sampleRate
}

/**
 * Place un paquet sur l'horloge audio. `cursor` est l'instant où finit l'audio
 * déjà programmé ; `now` est l'instant courant de l'horloge. Si le curseur est
 * derrière `now`, la lecture a pris du retard : on repart de `now` et on le dit
 * (`gap`), au lieu de programmer dans le passé.
 */
export function pcmChunkPlan(
  cursor: number,
  now: number,
  duration: number,
  startDelay: number = PCM_START_DELAY_S,
): { startAt: number; cursor: number; gap: number } {
  const earliest = now + startDelay
  const startAt = Math.max(cursor, earliest)
  // Un « trou » n'existe que si de l'audio avait déjà été programmé (`cursor > 0`)
  // et que son heure est passée. Au tout premier paquet, le délai initial est un
  // choix, pas un retard : le compter comme un trou fausserait toute mesure.
  const gap = cursor > 0 ? Math.max(0, startAt - cursor) : 0
  return { startAt, cursor: startAt + duration, gap }
}

/**
 * Vrai quand la lecture peut commencer : assez d'audio d'avance, ou flux terminé
 * (une réponse très courte ne doit pas rester muette faute de volume).
 */
export function shouldStartPlayback(
  bufferedMs: number,
  ended: boolean,
  minBufferMs: number = PCM_MIN_BUFFER_MS,
): boolean {
  return ended || bufferedMs >= minBufferMs
}

// v11.3.0 : voix neuronales françaises via le service de lecture d'Edge.
// Pourquoi ce module existe : la synthèse locale de Windows (System.Speech) ne
// propose que des voix SAPI5 robotiques et coûte ~1,9 s de démarrage par phrase
// (processus PowerShell jetable, mesuré). Les voix neuronales de Microsoft sont
// accessibles sans compte ni carte bancaire par le service « Lire à voix haute »
// d'Edge ; la synthèse est faite ici, côté host, puis l'audio est joué par la
// webview.
//
// v11.3.0 : le jeton d'accès est calculé ici, et non plus recopié depuis une
// bibliothèque. Il ne protège aucun secret : c'est l'horodatage (fenêtre de cinq
// minutes, format Windows) haché avec la constante publique du client Edge. Une
// bibliothèque qui suit le protocole peut le fournir, mais `msedge-tts` 2.1.0 se
// faisait refuser sa poignée de main (HTTP 200 au lieu de 101) alors que le
// protocole décrit ci-dessous répondait 9 fois sur 9.
//
// Contraintes du plan :
//   - aucune clé, aucun compte, aucune facturation : le service est gratuit ;
//   - service NON contractuel : une panne ou une limite (429) ne rend jamais
//     l'agent muet — le host le dit et reprend la voix Windows locale ;
//   - la voix choisie est un identifiant préfixé « edge: » ; une préférence
//     enregistrée en v11.1.0 (nom Windows brut) reste une voix locale.
// Pur : testable avec Node seul, sans réseau ni dépendance desktop.
import { createHash } from "node:crypto"

/** Voix disponibles. Les identifiants sont stables et préfixés. */
export const EDGE_VOICES = [
  { id: "edge:fr-FR-DeniseNeural", label: "Denise — française, posée" },
  { id: "edge:fr-FR-HenriNeural", label: "Henri — français, grave" },
  { id: "edge:fr-FR-EloiseNeural", label: "Éloïse — française, claire" },
  { id: "edge:fr-FR-VivienneMultilingualNeural", label: "Vivienne — multilingue" },
  { id: "edge:fr-FR-RemyMultilingualNeural", label: "Rémy — multilingue" },
] as const

export const EDGE_VOICE_IDS: string[] = EDGE_VOICES.map((voice) => voice.id)
/** Voix par défaut : la meilleure qualité disponible sans réglage. */
export const DEFAULT_EDGE_VOICE = "edge:fr-FR-DeniseNeural"
/** Une limite de débit (429) est souvent passagère : une seule seconde tentative. */
export const EDGE_RETRY_DELAY_MS = 1_200
/**
 * v11.4.3 : après un 429, le service reste fermé un moment. Re-tenter à chaque
 * phrase coûte 1,2 s d'attente à chaque fois ET entretient la limite : on laisse
 * passer une minute avant de le solliciter de nouveau.
 */
export const EDGE_COOLDOWN_MS = 60_000

/** Le service est-il encore en blocage ? `blockedUntil` = instant de fin. */
export function edgeCooldownActive(blockedUntil: number, now: number = Date.now()): boolean {
  return Number.isFinite(blockedUntil) && blockedUntil > now
}

export const EDGE_QUOTA_MESSAGE =
  "Le service vocal Edge limite temporairement les requêtes (HTTP 429)."

/** Constante publique du client de lecture d'Edge — ce n'est pas un secret. */
export const EDGE_TRUSTED_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
/** Version du client annoncée au service : elle accompagne le format du jeton. */
export const EDGE_SPEECH_VERSION = "1-143.0.3650.96"
/** Le jeton change toutes les cinq minutes (fenêtre du service). */
export const EDGE_TOKEN_WINDOW_SECONDS = 300
/** Décalage entre l'époque Unix et l'époque Windows (1601), en secondes. */
const WINDOWS_EPOCH_SECONDS = 11_644_473_600

/**
 * Jeton `Sec-MS-GEC` : horodatage Windows arrondi à la fenêtre de cinq minutes,
 * concaténé à la constante publique puis haché en SHA-256.
 * Pur : l'instant est un paramètre, donc testable sans horloge réelle.
 */
export function edgeSpeechToken(nowMs: number = Date.now()): string {
  const seconds = Math.floor(nowMs / 1000) + WINDOWS_EPOCH_SECONDS
  const window = Math.floor(seconds / EDGE_TOKEN_WINDOW_SECONDS) * EDGE_TOKEN_WINDOW_SECONDS
  // 1 seconde = 10 000 000 ticks de 100 ns côté Windows.
  return createHash("sha256")
    .update(`${BigInt(window) * 10_000_000n}${EDGE_TRUSTED_TOKEN}`, "ascii")
    .digest("hex")
    .toUpperCase()
}

/** Échappe le texte pour le SSML : le service refuserait un « & » ou un « < » nu. */
export function escapeSsml(text: string): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/** Retire le préfixe de préférence (« edge: ») pour obtenir le nom de voix brut. */
export function edgeVoiceName(voiceId: string): string {
  return String(voiceId ?? "").replace(/^edge:/, "")
}

/** Vrai pour une voix neuronale — donc un service distant, donc en ligne. */
export function isEdgeVoice(value: string): boolean {
  return String(value ?? "").startsWith("edge:")
}

export type VoiceRoute =
  | { kind: "edge"; voice: string }
  // v11.5.0 : voix locale Piper, choisie explicitement ou utilisée en repli quand
  // le service neuronal est injoignable. Hors ligne, sans quota, sans 429.
  | { kind: "piper"; voice: string }
  | { kind: "sapi"; voice: string }

/**
 * Décide qui parle, à partir de la préférence enregistrée :
 *   - préfixe « edge: » → voix neuronale ;
 *   - préfixe « sapi: » → voix Windows choisie explicitement ;
 *   - préférence vide → voix neuronale par défaut (la meilleure qualité) ;
 *   - tout le reste → nom Windows hérité d'une préférence v11.1.0.
 * Ne lève jamais : le repli en cas d'échec réseau appartient à l'appelant, qui
 * peut prévenir l'utilisateur.
 */
export function resolveVoiceRoute(prefs: { voiceName: string }): VoiceRoute {
  const voiceName = String(prefs.voiceName ?? "").trim()
  if (isEdgeVoice(voiceName)) return { kind: "edge", voice: edgeVoiceName(voiceName) }
  // v11.5.0 : « piper:fr_FR-siwis-medium » → la voix locale Piper.
  if (voiceName.startsWith("piper:")) return { kind: "piper", voice: voiceName.slice(6) }
  if (voiceName.startsWith("sapi:")) return { kind: "sapi", voice: voiceName.slice(5) }
  if (!voiceName) return { kind: "edge", voice: edgeVoiceName(DEFAULT_EDGE_VOICE) }
  return { kind: "sapi", voice: voiceName }
}

/** Vrai si l'erreur ressemble à une limite de débit du service vocal. */
export function isEdgeRateLimit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "")
  return /429|too many requests/i.test(message)
}

/** Message lisible pour un échec du service vocal — jamais un code nu. */
export function describeEdgeFailure(error: unknown): string {
  if (isEdgeRateLimit(error)) return EDGE_QUOTA_MESSAGE
  const message = error instanceof Error ? error.message : String(error ?? "")
  const clean = message.replace(/^Error:\s*/, "").trim()
  // Le service ferme la connexion (1007) en nommant la voix refusée.
  const unsupported = clean.match(/Unsupported voice\s+(\S+?)\.?$/i)
  if (unsupported) return `Le service vocal Edge ne connaît pas la voix « ${unsupported[1]} ».`
  return clean || "Le service vocal Edge n'a pas répondu."
}

// v11.14.0 : qui parle, à partir de la préférence enregistrée.
// Pourquoi ce module existe : la décision vivait dans `host/voice-agent-edge.ts`
// aux côtés des voix neuronales. Celles-ci (Edge) et la voix locale Piper ayant
// été retirées, le routage reste — il ne connaît plus que le moteur local
// Pocket TTS et la voix Windows, avec repli sur Windows pour toute préférence
// héritée d'une version antérieure.
// Pur : testable avec Node seul, sans dépendance desktop.

export type VoiceRoute =
  // v11.10.0 : moteur local Pocket TTS, choisi explicitement dans les Réglages.
  | { kind: "pocket"; voice: string }
  // Voix Windows choisie explicitement, ou voix par défaut quand la préférence
  // est vide : la lecture est locale, hors ligne, jamais muette.
  | { kind: "sapi"; voice: string }

/**
 * Décide qui parle :
 *   - préfixe « pocket: » → le moteur local Pocket TTS ;
 *   - préfixe « sapi: » → la voix Windows choisie explicitement ;
 *   - préférence vide → la voix Windows par défaut ;
 *   - préférence héritée (« edge: », « piper: », nom Windows brut v11.1.0) →
 *     la voix Windows par défaut : un préfixe retiré ne doit jamais fabriquer
 *     un nom de voix Windows inconnu.
 * Ne lève jamais : le repli en cas d'échec appartient à l'appelant, qui peut
 * prévenir l'utilisateur.
 */
export function resolveVoiceRoute(prefs: { voiceName: string }): VoiceRoute {
  const voiceName = String(prefs.voiceName ?? "").trim()
  if (voiceName.startsWith("pocket:")) return { kind: "pocket", voice: voiceName.slice(7) }
  if (voiceName.startsWith("sapi:")) return { kind: "sapi", voice: voiceName.slice(5) }
  if (!voiceName) return { kind: "sapi", voice: "" }
  if (voiceName.startsWith("edge:") || voiceName.startsWith("piper:")) return { kind: "sapi", voice: "" }
  return { kind: "sapi", voice: voiceName }
}

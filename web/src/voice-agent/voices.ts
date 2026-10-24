// v11.3.0 : catalogue des voix tel que l'interface le présente.
// Duplication volontaire et commentée de `host/voice-agent-edge.ts` : le renderer
// n'importe pas le host (deux graphes de compilation). Seule la LISTE de libellés
// est doublée ; la décision de parler, elle, reste dans le host.
// Pur : testable avec Node seul.

export type VoiceOption = { id: string; label: string }

/** Miroir de EDGE_VOICES côté host — les identifiants doivent rester identiques. */
export const EDGE_VOICE_OPTIONS: VoiceOption[] = [
  { id: "edge:fr-FR-DeniseNeural", label: "Denise — française, posée" },
  { id: "edge:fr-FR-HenriNeural", label: "Henri — français, grave" },
  { id: "edge:fr-FR-EloiseNeural", label: "Éloïse — française, claire" },
  { id: "edge:fr-FR-VivienneMultilingualNeural", label: "Vivienne — multilingue" },
  { id: "edge:fr-FR-RemyMultilingualNeural", label: "Rémy — multilingue" },
]

/**
 * v11.5.0 : voix locale Piper, qui remplace la voix Windows en repli. Le host ne
 * la propose que si l'installeur l'a embarquée : la liste reste donc la source
 * de vérité, ce miroir ne sert qu'aux libellés.
 */
export const PIPER_VOICE_OPTIONS: VoiceOption[] = [
  { id: "piper:fr_FR-siwis-medium", label: "Siwis — locale, hors ligne" },
]

const EDGE_LABELS = new Map(
  [...EDGE_VOICE_OPTIONS, ...PIPER_VOICE_OPTIONS].map((voice) => [voice.id, voice.label]),
)

/** Vrai pour une voix neuronale — un service distant, donc en ligne. */
export function isNeuralVoice(id: string): boolean {
  return String(id ?? "").startsWith("edge:")
}

/**
 * Ramène une préférence enregistrée à un identifiant du menu. Les versions
 * antérieures stockaient le nom Windows brut (« Microsoft Hortense Desktop »).
 */
export function voiceIdOf(pref: string | undefined): string {
  const value = String(pref ?? "").trim()
  if (!value) return ""
  if (value.startsWith("edge:") || value.startsWith("piper:") || value.startsWith("sapi:")) return value
  return `sapi:${value}`
}

/** Libellé lisible d'une voix : « edge:fr-FR-… » ne doit jamais s'afficher. */
export function voiceLabel(id: string): string {
  const value = String(id ?? "")
  const neural = EDGE_LABELS.get(value)
  if (neural) return neural
  if (value.startsWith("sapi:")) return value.slice(5)
  if (value.startsWith("edge:")) return value.slice(5)
  if (value.startsWith("piper:")) return value.slice(6)
  return value
}

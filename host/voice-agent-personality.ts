// v11.1.3 : personnalités de l'agent vocal. Une humeur change le TON de la
// réponse, jamais le contenu ni l'exécution des commandes ; aucun bruitage.
// Liste fermée : une valeur inconnue retombe sur « neutre ».
// Nouvelles directives : on peut varier le rythme, le débit et les pauses prosodiques
// pour rendre les réponses plus vivantes, sans avoir besoin de SSML complet.

export type VoicePersonality = "neutre" | "direct" | "chaleureux"

export interface VoicePersonalityOptions {
  id: VoicePersonality
  label: string
  hint: string
}

export const VOICE_PERSONALITIES: VoicePersonalityOptions[] = [
  { id: "neutre", label: "Neutre", hint: "Précis et bref, sans effet de style. Le rythme est stable et neutre." },
  { id: "direct", label: "Direct", hint: "Factuel et sans flatterie, deux phrases maximum. Le débit est modéré, peu de pauses." },
  { id: "chaleureux", label: "Chaleureux", hint: "Ton chaleureux et bienveillant, sans familiarité excessive. Le débit est plus lent, avec des pauses naturelles." },
]

export const DEFAULT_VOICE_PERSONALITY: VoicePersonality = "neutre"

export function isVoicePersonality(value: unknown): value is VoicePersonality {
  return value === "neutre" || value === "direct" || value === "chaleureux"
}

export function normalizeVoicePersonality(value: unknown): VoicePersonality {
  return isVoicePersonality(value) ? value : DEFAULT_VOICE_PERSONALITY
}

export function getVoicePersonalityHint(personality: VoicePersonality): string {
  const entry = VOICE_PERSONALITIES.find((p) => p.id === personality)
  return entry ? entry.hint : ""
}
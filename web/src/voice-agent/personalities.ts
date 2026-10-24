// v11.1.0 : miroir des personnalités de host/voice-agent-personality.ts pour les
// Réglages (duplication volontaire et commentée, même contrat que les types IPC).
// Une humeur ne change que le ton — jamais l'exécution d'une commande.
import type { VoicePersonality } from "../types"

export const VOICE_PERSONALITY_OPTIONS: { id: VoicePersonality; label: string; hint: string }[] = [
  { id: "neutre", label: "Neutre", hint: "Précis et posé, sans effet de style." },
  { id: "direct", label: "Direct", hint: "Factuel et sans détour, deux phrases maximum." },
  { id: "chaleureux", label: "Chaleureux", hint: "Ton posé et bienveillant, sans familiarité excessive." },
]

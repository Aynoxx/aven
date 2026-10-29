// v11.3.0 : catalogue des voix tel que l'interface le présente.
// v11.14.0 : les voix neuronales (Edge) et la voix locale Piper ont été retirées ;
// il ne reste que le moteur local Pocket TTS, la voix Windows héritée des
// préférences anciennes, et les voix Windows listées par le host.
// Duplication volontaire et commentée : le renderer n'importe pas le host (deux
// graphes de compilation). Seule la LISTE de libellés est doublée ; la décision
// de parler, elle, reste dans le host.
// Pur : testable avec Node seul.

export type VoiceOption = { id: string; label: string }

/**
 * v11.10.0 : moteur local Pocket TTS (binaire embarqué, poids téléchargés au
 * premier usage). Le host ne le propose que si son binaire est présent ; ce
 * miroir ne sert qu'au libellé.
 */
export const POCKET_VOICE_OPTIONS: VoiceOption[] = [
  { id: "pocket:fr", label: "Pocket TTS — locale, voix française" },
  // v11.10.0 : le host ne propose QUE l'une des deux, selon qu'un profil de voix
  // clonée est installé : le libellé décrit donc toujours ce qui va être dit, sans
  // jamais nommer une personne.
  { id: "pocket:clone", label: "Pocket TTS — locale, voix clonée" },
]

/**
 * v11.11.0 : page où accepter les conditions du modèle de clonage. Miroir de
 * `POCKET_CLONE_TERMS_URL` (host/pocket-tts.ts) — même raison que les libellés de
 * voix : le renderer n'importe pas le host. La sonde v11.11.0 refuse deux valeurs
 * divergentes.
 */
export const POCKET_CLONE_TERMS_URL = "https://huggingface.co/kyutai/pocket-tts"

const VOICE_LABELS = new Map(POCKET_VOICE_OPTIONS.map((voice) => [voice.id, voice.label]))

/**
 * Ramène une préférence enregistrée à un identifiant du menu. Les versions
 * antérieures stockaient le nom Windows brut (« Microsoft Hortense Desktop ») et
 * des préfixes retirés (« edge: », « piper: ») : ceux-ci n'ont plus d'entrée au
 * menu, donc on rend la voix par défaut plutôt qu'un faux choix.
 */
export function voiceIdOf(pref: string | undefined): string {
  const value = String(pref ?? "").trim()
  if (!value) return ""
  if (value.startsWith("edge:") || value.startsWith("piper:")) return ""
  if (value.startsWith("pocket:") || value.startsWith("sapi:")) return value
  return `sapi:${value}`
}

/** Libellé lisible d'une voix : un identifiant préfixé ne doit jamais s'afficher. */
export function voiceLabel(id: string): string {
  const value = String(id ?? "")
  const known = VOICE_LABELS.get(value)
  if (known) return known
  if (value.startsWith("sapi:")) return value.slice(5)
  if (value.startsWith("pocket:")) return value.slice(7)
  return value
}

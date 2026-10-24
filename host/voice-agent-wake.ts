// v11.1.0 : mot d'activation de l'agent vocal Aven (nouveau canal, distinct de la
// dictée v8.x). Le STT distant renvoie une transcription libre : ce module la
// normalise, reconnaît « Aven » de façon TOLÉRANTE (accents, casse, « a ven »,
// « avène », « avenne ») et retire le mot et les politesses avant le routage.
//
// Règles d'or :
//   - « Aven » uniquement — jamais « Jarvis » ni un autre nom d'assistant ;
//   - la détection reste bornée : un mot qui CONTIENT « aven » (« aventure »,
//     « événement ») ne réveille pas l'agent, un mot d'activation collé au début
//     d'une phrase oui ;
//   - aucun modèle local, aucune IA : uniquement de la normalisation de texte.
//
// v11.2.1 : la prononciation voulue — A français, « ven » à l'anglaise — fait
// écrire au STT des formes que le motif v11.1.0 refusait : « Haven » surtout,
// mais aussi « Aveun », « Avin », « Avain ». Le réveil échouait donc sans laisser
// de trace, alors que la transcription était juste. La liste des graphies est
// maintenant fermée et explicite, et le mot doit être ENTIER : « avenue »,
// « avenir », « aventure » ne réveillent toujours rien.
//
// Pur : testable avec Node seul, sans dépendance desktop ni réseau.

export const WAKE_WORD = "aven"

/** Normalise une transcription : minuscules, sans accents, ponctuation → espaces. */
export function normalizeVoiceText(text: string): string {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

// v11.2.1 : graphies acceptées, une PAR MOT entier (la normalisation a déjà retiré
// accents et ponctuation) :
//   av(e|ai|ei)?n+  → aven, avène, avenne, avenes ; haven, havenne…
//   av(in|ain|ein)  → avin, avain (le « e » final de « avine » reste toléré)
//   av(e|i|ai)un    → aveun, aviun
// Le « Avent »/« Avant » de Whisper n'est PAS ici : il est traité plus bas, avec
// une pause obligatoire, parce que ce sont aussi des mots français courants.
const WAKE_TOKEN_RE = /^(?:h?av(?:e|ai|ei)?n{1,3}e?s?|h?av(?:in|ain|ein)e?s?|h?av(?:e|i|ai)un)$/
// « a ven » en deux mots (le STT coupe parfois le mot d'activation).
const SPLIT_WAKE_NEXT_RE = /^v(?:en|in|ain)$/

/** Position du mot d'activation dans les mots normalisés, ou null. */
function wakePosition(words: string[]): { index: number; length: number } | null {
  for (let index = 0; index < words.length; index++) {
    if (WAKE_TOKEN_RE.test(words[index])) return { index, length: 1 }
    if ((words[index] === "a" || words[index] === "ah") && SPLIT_WAKE_NEXT_RE.test(words[index + 1] ?? ""))
      return { index, length: 2 }
  }
  return null
}

// v11.1.1 : Whisper transcrit très souvent « Aven » en « Avant » (voire
// « Avent »). On accepte ces homophones UNIQUEMENT en tête d'énoncé et suivis
// d'une pause (« Avant, ouvre une note ») : « avant de partir » ou « avant je
// pensais » restent du texte ordinaire et ne réveillent pas l'agent.
const WAKE_HOMOPHONE_PAUSE_RE = /^\s*(?:hey\s+|ok\s+|salut\s+)?(?:avant|avent)\s*[,;:.!?]/i
// Variante sans ponctuation : elle ne suffit PAS à réveiller l'agent (le module
// de commandes exige en plus une commande reconnue).
const WAKE_HOMOPHONE_START_RE = /^\s*(?:hey\s+|ok\s+|salut\s+)?(?:avant|avent)(?=\s|$)/i

/** Vrai si le texte contient le mot d'activation (variantes tolérées). */
export function hasWakeWord(text: string): boolean {
  const raw = String(text ?? "")
  const normalized = normalizeVoiceText(raw)
  const words = normalized ? normalized.split(" ") : []
  return wakePosition(words) !== null || WAKE_HOMOPHONE_PAUSE_RE.test(raw)
}

/**
 * Vrai si l'énoncé commence par un homophone du mot d'activation (« Avant »,
 * « Avent »). Sert au routage : une commande reconnue derrière l'homophone
 * vaut réveil même si Whisper a omis la virgule.
 */
export function startsWithWakeHomophone(text: string): boolean {
  return WAKE_HOMOPHONE_START_RE.test(String(text ?? ""))
}

/** Retire le mot d'activation et tout ce qui le précède. */
export function stripWakeWord(text: string): string {
  const normalized = normalizeVoiceText(text)
  const words = normalized ? normalized.split(" ") : []
  const found = wakePosition(words)
  const raw = String(text ?? "").trim()
  if (!found) {
    // v11.1.1 : homophone en tête (« Avant, … ») — on retire ce premier mot,
    // jamais un « avant » au milieu d'une phrase.
    const rawWords = raw ? raw.split(/\s+/) : []
    const index = rawWords.findIndex((word) => /^(?:avant|avent)[,;:.!?]*$/i.test(word))
    if (index >= 0) return rawWords.slice(index + 1).join(" ").trim()
    return raw
  }
  // v11.2.1 : on repart du texte d'origine pour conserver accents et majuscules
  // utiles aux noms propres ; les index sont comptés en MOTS, donc la longueur
  // du mot reconnu (accents, ponctuation) n'a plus d'importance.
  const rawWords = raw ? raw.split(/\s+/) : []
  const cut = found.index + found.length
  if (rawWords.length <= cut) return ""
  return rawWords.slice(cut).join(" ").trim()
}

// v11.1.0 : le texte brut garde ses accents (« plaît ») — les motifs acceptent
// donc les graphies accentuées et les deux apostrophes (droite et courbe).
const POLITENESS = [
  /^(?:s['’]?il te pla[iî]t|s['’]?il vous pla[iî]t|stp|svp|merci|salut|bonjour)[\s,]+/i,
  /[\s,]+(?:s['’]?il te pla[iî]t|s['’]?il vous pla[iî]t|stp|svp|merci)[\s.!?]*$/i,
]

/** Retire les politesses de début et de fin, sans toucher au contenu. */
export function stripPoliteness(text: string): string {
  let value = String(text ?? "").trim()
  for (let guard = 0; guard < 3; guard++) {
    const before = value
    for (const pattern of POLITENESS) value = value.replace(pattern, "").trim()
    if (value === before) break
  }
  return value.replace(/^[,.:;!\s]+/, "").replace(/[,.:;!\s]+$/, "").trim()
}

export type WakeDetection = {
  /** Le mot d'activation a été reconnu. */
  woken: boolean
  /** Texte utile restant (mot d'activation et politesses retirés). */
  command: string
}

/** Détecte « Aven » puis nettoie la demande qui suit. */
export function detectWakeWord(text: string): WakeDetection {
  const woken = hasWakeWord(text)
  const command = woken ? stripPoliteness(stripWakeWord(text)) : stripPoliteness(text)
  return { woken, command }
}

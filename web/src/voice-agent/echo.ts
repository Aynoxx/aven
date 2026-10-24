// v11.4.1 : l'agent s'entend lui-même. La webview joue sa propre voix dans les
// haut-parleurs, le micro la reprend, le STT la transcrit — et cette transcription
// était traitée comme une réponse. Sur une note en attente, elle l'annulait
// (« Je n'ai pas enregistré la note » alors que personne n'avait parlé).
//
// Le garde est textuel, pas acoustique : un fragment de trois mots ou plus,
// CONTIGU, déjà prononcé par l'agent moins de 2,5 s avant (ou pendant qu'il
// parle), est un écho. Un mot seul (« oui », « non », « stop ») n'est JAMAIS un
// écho — c'est précisément ainsi qu'on répond.
//
// Pur : testable avec Node seul, sans dépendance desktop ni réseau.

/** Délai après la fin de la lecture pendant lequel sa transcription peut arriver. */
export const ECHO_WINDOW_MS = 2_500
/** Longueur minimale d'un fragment pour être reconnu comme écho. */
export const ECHO_MIN_WORDS = 3

/** Minuscules, sans accents, sans ponctuation : deux graphies se comparent. */
export function normalizeSpeech(text: string): string {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * La transcription est-elle la propre voix de l'agent ?
 * `speaking` = la lecture est encore en cours ; `endedAt` = instant de fin de la
 * dernière lecture (0 si aucune). `now` est injecté pour rester testable.
 */
export function isSelfEcho(input: {
  heard: string
  spoken: string
  speaking?: boolean
  endedAt: number
  now?: number
}): boolean {
  const heardWords = normalizeSpeech(input.heard).split(" ").filter(Boolean)
  if (heardWords.length < ECHO_MIN_WORDS) return false
  const spokenWords = normalizeSpeech(input.spoken).split(" ").filter(Boolean)
  if (spokenWords.length < ECHO_MIN_WORDS) return false
  const now = input.now ?? Date.now()
  const within = input.speaking === true || (input.endedAt > 0 && now - input.endedAt <= ECHO_WINDOW_MS)
  if (!within) return false
  // Le fragment doit être un bloc CONTIGU de la phrase prononcée : des mots
  // éparpillés ne suffisent pas, sinon une vraie demande se confondrait avec la
  // réponse que l'agent vient de lire.
  for (let start = 0; start + heardWords.length <= spokenWords.length; start += 1) {
    let same = true
    for (let offset = 0; offset < heardWords.length; offset += 1) {
      if (spokenWords[start + offset] !== heardWords[offset]) {
        same = false
        break
      }
    }
    if (same) return true
  }
  return false
}

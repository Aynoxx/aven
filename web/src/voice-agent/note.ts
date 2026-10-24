// v11.4.0 : création de note à la voix. La règle qui compte : Aven n'écrit
// JAMAIS une note dans la foulée d'une phrase. Elle répète le contenu, puis
// attend un « oui » explicite ; tout le reste annule. Sans cette seconde
// question, une transcription approximative du STT écrirait n'importe quoi dans
// les notes de l'utilisateur — une erreur qu'on ne voit pas, qu'on ne corrige pas.
//
// Ce que ce module porte :
//   - l'extraction du brouillon (« note que j'ai rendez-vous » → « j'ai rendez-vous ») ;
//   - la question de contenu quand la phrase ne le porte pas (« crée une note ») ;
//   - la phrase de confirmation, qui RÉPÈTE le contenu à lire ;
//   - le classement de la réponse orale : oui / non / autre ;
//   - le titre lisible dérivé du brouillon.
//
// Pur : testable avec Node seul, sans dépendance desktop ni réseau.

/** Fenêtre pendant laquelle la réponse à la question de confirmation est acceptée. */
// v11.4.0 : 45 s — le temps d'écouter une phrase de confirmation et de répondre.
// La fenêtre de suivi ordinaire (10 s) ne suffit pas : elle est calée sur la
// réaction à une réponse, pas sur une décision à prendre.
export const NOTE_CONFIRM_MS = 45_000
/** Garde-fou : une phrase dictée n'est pas un document. */
export const NOTE_MAX_CHARS = 600
/** Longueur du brouillon relu dans la question (au-delà, on abrège). */
const PROMPT_MAX_CHARS = 180
/** Longueur du titre dérivé. */
const TITLE_MAX_CHARS = 60

export type NoteRequest = { draft: string }
/** `confirm` = écrire ; `cancel` = renoncer ; `other` = on n'a pas compris. */
export type NoteReply = "confirm" | "cancel" | "other"

// Le contenu suit « note que », « crée une note : », « prends note que »…
// Les verbes de consultation (ouvre, affiche, montre) sont volontairement
// absents : « ouvre une note » reste une navigation, pas une création.
const REQUEST_PATTERNS: RegExp[] = [
  // « note que j'ai rendez-vous », « note bien que … », « note : acheter du pain »
  /^notes?\s+(?:bien\s+)?(?:que\b|qu['’]|:|,)\s*(.*)$/i,
  // « crée une note : … », « prends une note pour demain », « ajoute un mémo »
  /^(?:prends?|cr[eé]e?|cr[eé]er|ajoute|[eé]cris|enregistre|note)\s+(?:(?:une?|la|ma|le)\s+)?(?:note|pense-b[eê]te|m[eé]mo)\b\s*(?:que\b|qu['’]|:|-|,|sur\b|pour\b|au sujet de\b|disant\b|de\b)?\s*(.*)$/i,
  // « nouvelle note : … »
  /^nouvelle\s+note\b\s*(?:que\b|:|-|,)?\s*(.*)$/i,
]

/** Retire les bribes de politesse et de ponctuation autour du contenu dicté. */
function cleanDraft(raw: string): string {
  const text = String(raw ?? "")
    .replace(/^[\s:;,\-–—.]+/, "")
    .replace(/\s+/g, " ")
    .replace(/^[«"“']+/, "")
    .replace(/[»"”']+$/, "")
    .replace(/\s*(?:s['’]il te pla[iî]t|merci)\s*[.!?]*$/i, "")
    .trim()
  return text.slice(0, NOTE_MAX_CHARS).trim()
}

/**
 * Demande de note contenue dans une phrase, avec le contenu éventuel.
 * `{ draft: "" }` = l'utilisateur a demandé une note sans dire quoi : il faut
 * lui demander le texte. `null` = la phrase n'est pas une création de note.
 */
export function parseNoteDraft(text: string): NoteRequest | null {
  const value = String(text ?? "").trim()
  if (!value || value.length > 240) return null
  for (const pattern of REQUEST_PATTERNS) {
    const match = pattern.exec(value)
    if (match) return { draft: cleanDraft(match[1] ?? "") }
  }
  return null
}

// v11.4.0 : le refus passe AVANT l'accord. « non », « n'enregistre pas »,
// « attends » ne doivent jamais être lus comme un « oui » parce qu'ils
// contiennent un mot proche — le sens de l'écriture est irréversible.
const CANCEL_START = /^(?:non|nan|nope|annule|annuler|laisse(?:\s+(?:tomber|b[eé]ton))?|efface|supprime|attends|pas\s+maintenant|ne\s|l['’]enregistre\s+pas|n['’]enregistre\s+pas)\b/i
const CONFIRM_START = /^(?:oui|ouais|yep|ok|okay|d['’]accord|parfait|confirme|je\s+confirme|enregistre|vas[-\s]?y|valide|c['’]est\s+bon|c['’]est\s+ça|c['’]est\s+exact|exactement|volontiers|bien\s+s[ûu]r)\b/i

/** Classe la réponse orale à « Je l'enregistre ? ». */
export function classifyNoteReply(text: string): NoteReply {
  const value = String(text ?? "").trim()
  if (!value) return "other"
  if (CANCEL_START.test(value)) return "cancel"
  if (CONFIRM_START.test(value)) return "confirm"
  return "other"
}

/** Phrase lue quand la commande ne portait aucun contenu. */
export const NOTE_CONTENT_PROMPT = "Quel texte dois-je noter ?"

/** Phrase lue AVANT toute écriture : elle répète le contenu à enregistrer. */
export function noteConfirmPrompt(draft: string): string {
  const flat = String(draft ?? "").replace(/\s+/g, " ").trim()
  const shown = flat.length <= PROMPT_MAX_CHARS
    ? flat
    : flat.slice(0, PROMPT_MAX_CHARS).replace(/\s+\S*$/, "") + "…"
  return `Je note : « ${shown} ». Je l’enregistre ?`
}

/** Confirmation après écriture — le seul message prononcé une fois la note créée. */
export function noteCreatedReply(title?: string): string {
  const clean = String(title ?? "").trim()
  return clean ? `Note créée : « ${clean} ».` : "Note créée."
}

export const NOTE_CANCELLED_REPLY = "D’accord, je n’ai rien enregistré."
export const NOTE_UNCONFIRMED_REPLY = "Je n’ai pas enregistré la note."

/** Titre lisible tiré du contenu dicté (premier segment, tronqué aux mots). */
export function noteTitleFromDraft(draft: string): string {
  const flat = String(draft ?? "").replace(/\s+/g, " ").trim()
  if (!flat) return "Note vocale"
  const short = flat.length <= TITLE_MAX_CHARS
    ? flat
    : flat.slice(0, TITLE_MAX_CHARS).replace(/\s+\S*$/, "") + "…"
  return short.replace(/^[«"“']+/, "").replace(/[»"”']+$/, "").replace(/[.!?]+$/, "").trim() || "Note vocale"
}

/**
 * La confirmation est-elle encore ouverte ? `askedAt` est l'instant où la
 * question a été posée : au-delà de NOTE_CONFIRM_MS, un « oui » tardif ne doit
 * pas écrire une note dont l'utilisateur ne se souvient plus.
 */
export function noteConfirmationOpen(askedAt: number, now = Date.now()): boolean {
  return Number.isFinite(askedAt) && now >= askedAt && now - askedAt <= NOTE_CONFIRM_MS
}

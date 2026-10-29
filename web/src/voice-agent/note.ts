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

// v11.15.0 : « crée-moi une note », « fais une note » et « peux-tu créer une
// note » ne matchaient aucun motif : la phrase partait au LLM, qui n'avait aucun
// outil de création et répondait qu'il ne pouvait pas. Le préambule poli est
// retiré, le trait d'union de « crée-moi » devient un mot, et les verbes de
// rédaction (fais, génère, rédige) rejoignent la liste. « ouvre », « affiche » et
// « supprime » restent absents : consulter ou détruire n'est pas créer.
const REQUEST_LEAD_RE =
  /^(?:(?:peux|pourrais|peut|pourriez|veux|voudrais|aimerais)[- ](?:tu|vous)|je\s+(?:veux|voudrais|aimerais)(?:\s+que\s+(?:tu|vous))?|j['’]?aimerais(?:\s+que\s+(?:tu|vous))?|tu\s+peux|vous\s+pouvez|s['’]?il\s+te\s+pla[iî]t|s['’]?il\s+vous\s+pla[iî]t|stp|svp)\s+/i
const REQUEST_VERB =
  "(?:prends?|prendre|cr[eé]e?s?|cr[eé]er|fais|faire|g[eé]n[eè]re?|g[eé]n[eé]rer|r[eé]dige|r[eé]diger|ajoute|ajouter|[eé]cris|[eé]crire|enregistre|enregistrer|note)"
const REQUEST_PATTERNS: RegExp[] = [
  // « note que j'ai rendez-vous », « note bien que … », « noter que … »
  /^note(?:r|s)?\s+(?:bien\s+)?(?:que\b|qu['’]|:|,)\s*(.*)$/i,
  // « crée une note : … », « crée-moi une note », « fais une note sur … »
  new RegExp(
    `^(?:me\\s+)?${REQUEST_VERB}\\s+(?:(?:moi|nous)\\s+)?(?:(?:une?|la|ma|le)\\s+)?(?:note|pense-b[eê]te|m[eé]mo)\\b\\s*(?:que\\b|qu['’]|:|-|,|sur\\b|pour\\b|au sujet de\\b|disant\\b|de\\b)?\\s*(.*)$`,
    "i",
  ),
  // « nouvelle note : … »
  /^nouvelle\s+note\b\s*(?:que\b|:|-|,)?\s*(.*)$/i,
]

/** Retire le préambule poli et le trait d'union de « crée-moi ». */
function normalizeRequestLead(raw: string): string {
  let value = String(raw ?? "").trim()
  for (let guard = 0; guard < 2; guard++) {
    const before = value
    value = value.replace(REQUEST_LEAD_RE, "").trim()
    if (value === before) break
  }
  return value.replace(/^([a-zà-ÿ]+)-moi\b/i, "$1 moi")
}

// v11.15.0 : « crée une note qui résume… » décrit un contenu À COMPOSER, pas un
// brouillon dicté. Le laisser au modèle (outil create_note) évite d'écrire une
// note dont le texte serait « qui résume… ».
const RELATIVE_DRAFT = /^(?:qui|que|qu['’]|dont|où)\b/i

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
  const request = normalizeRequestLead(value)
  for (const [index, pattern] of REQUEST_PATTERNS.entries()) {
    const match = pattern.exec(request)
    if (match) {
      const draft = cleanDraft(match[1] ?? "")
      // Seule la formule « crée une note … » peut décrire un contenu à composer ;
      // « note : qui est de garde » reste une dictée explicite.
      if (index === 1 && RELATIVE_DRAFT.test(draft)) return null
      return { draft }
    }
  }
  return null
}

// v11.16.0 : une note DICTÉE et une note À RÉDIGER ne sont pas le même geste.
// « note que j'ai rendez-vous » est le texte exact ; « la note doit contenir un
// résumé de comment faire une boucle python » décrit un contenu à composer.
// Prendre la seconde au mot créait une note qui recopiait la demande. La
// décision reste pure et locale ; la rédaction elle-même est un appel dédié au
// modèle, jamais une écriture par le modèle.
const DICTATION_START =
  /^(?:note|retiens|pense[- ]?b[êe]te|m[ée]mo)\s*(?:bien\s+)?(?:que\b|qu['’]|:|,)/i
const NOTE_IS_CONTENT =
  /\b(?:la|une|cette|ma)\s+note\s+(?:doit|devra|pourra|est\s+cens[ée]e)\s+(?:contenir|être|expliquer|r[ée]sumer|d[ée]crire|dire|pr[ée]senter)\b/i
const NOTE_ON_TOPIC =
  /\b(?:fais|faire|cr[ée]e|cr[ée]er|g[ée]n[èe]re|g[ée]n[ée]rer|r[ée]dige|r[ée]diger|[ée]cris|[ée]crire|voudrais|aimerais|je\s+voudrais|j'?aimerais)\b[^.?!]{0,60}\b(?:une?|la|ma|cette)\s+note\s+(?:sur|pour|qui|à\s+propos|au\s+sujet|expliquant|r[ée]sumant|d[ée]crivant|en\s+plus)\b/i
// `\b` ne voit pas la frontière après un « é » (non-mot pour JavaScript) :
// les marqueurs accentués sont délimités explicitement.
const COMPOSE_MARKER =
  /(?:^|[^a-zà-ÿ])(?:r[ée]sume|r[ée]sumer|r[ée]sum[ée]s?|explique|expliquer|explication|tutoriel|guide|pas\s+à\s+pas|mode\s+d['’]emploi)(?=$|[^a-zà-ÿ])/i
const HOW_TO =
  /\bcomment\s+(?:faire|fonctionne|cr[ée]r|utiliser|marcher|se\s+passe)\b/i
// v11.16.1 : reconnaître les demandes naturelles sans verbe impératif
// comme « je voudrais une note sur… », « note-moi… », « note de… ».
const REQUEST_NATURAL =
  /\b(?:je\s+peux|on\s+peut|peux\s+je|quel\s+sujet|de\s+quoi|sur\s+quel)\b/i
// Patterns additionnels pour NOTE_ON_TOPIC
const NOTE_ON_TOPIC_EXT =
  /\b(?:pour\s+la\s+note|de\s+la\s+note|sur\s+la\s+note|dans\s+la\s+note)\b/i

/**
 * Vrai si la phrase décrit le contenu que la note doit avoir, au lieu de le
 * dicter. Une dictée explicite (« note que… », « note :… ») garde toujours la
 * priorité : elle ne doit jamais être réécrite par le modèle.
 */
export function noteNeedsComposition(text: string): boolean {
  const raw = String(text ?? "").trim()
  if (!raw || DICTATION_START.test(raw)) return false
  return NOTE_IS_CONTENT.test(raw) || NOTE_ON_TOPIC.test(raw) || NOTE_ON_TOPIC_EXT.test(raw) || COMPOSE_MARKER.test(raw) || HOW_TO.test(raw) || REQUEST_NATURAL.test(raw)
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

// v11.16.0 : la question est PRONONCÉE. Une note composée porte du Markdown
// (« ### », « ** », ```python) qu'aucune voix ne doit lire : le texte écrit
// garde tout, seule la relecture orale est aplatie. Les blocs de code sont
// retirés entièrement — lire un programme à voix haute n'aide personne.
export function spokenDraft(draft: string): string {
  return String(draft ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** Phrase lue AVANT toute écriture : elle répète le contenu à enregistrer. */
export function noteConfirmPrompt(draft: string): string {
  // Une note uniquement composée de code n'a rien à relire : on le dit.
  const flat = spokenDraft(draft) || "un texte rédigé"
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

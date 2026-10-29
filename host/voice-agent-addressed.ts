// v11.14.1 : en mode éveillé, tout ce que le micro entend n'est pas une demande.
// Un bruit de fond, une hésitation (« euh », « hum »), une remarque adressée à
// quelqu'un d'autre ou une hallucination du STT sur du silence partaient au LLM ;
// n'ayant rien de neuf à dire, il répondait en répétant sa phrase précédente.
//
// La décision est TEXTUELLE et déterministe — aucun modèle, aucun appel réseau,
// aucune latence ajoutée. Un énoncé est adressé quand il porte une marque
// d'adresse (question, impératif, deuxième personne, demande explicite) ou quand
// il est assez long pour être volontaire. Le doute profite à la conversation :
// seul un énoncé manifestement ambiant est écarté. Comprendre une phrase longue
// dite à quelqu'un d'autre demanderait un classifieur payé en latence ; ce n'est
// pas le contrat de ce module.
//
// Pur : testable avec Node seul, sans dépendance desktop ni réseau.
import { normalizeVoiceText } from "./voice-agent-wake.js"

export type VoiceAddressVerdict = "addressed" | "filler" | "hallucination" | "ambient" | "empty"

/**
 * Au-delà de ce nombre de mots, un énoncé sans marque d'adresse est tenu pour
 * volontaire : couper une vraie demande serait pire que répondre à une remarque.
 */
export const AMBIENT_MAX_WORDS = 12

// Hésitations, béquilles et accusés de réception : dits seuls, ils ne demandent
// rien à personne. « oui » et « non » en font partie quand aucune question n'est
// ouverte (une note ou une action en attente est traitée AVANT ce module).
const FILLER_TOKENS = new Set([
  "euh", "eu", "heu", "heum", "hum", "hmm", "hm", "mm", "mmm",
  "bah", "ben", "bon", "bof", "hein", "oh", "ah", "eh",
  "ok", "okay", "oki", "d'accord", "daccord", "oui", "ouais", "nan", "non",
  "merci", "salut", "coucou", "voila", "bref", "attends", "attendez",
  "super", "nickel", "parfait", "cool", "entendu", "exactement", "mouais",
  "tres", "bien", "pff", "tsk", "ahem", "hem",
])

// Béquilles en plusieurs mots, comparées au texte normalisé ENTIER : « vas-y »
// après une question est une réponse, seul c'est du bruit de pièce.
const FILLER_PHRASES = new Set(["vas y", "c'est bon", "c'est parti", "peut etre"])

// Hallucinations connues de Whisper sur du silence ou du bruit (transcriptions
// de sous-titres, fins de vidéo). Reconnues sur le texte NORMALISÉ : accents,
// casse et ponctuation ont déjà disparu.
const STT_HALLUCINATIONS: RegExp[] = [
  /^sous titres? (?:realises?|realisees?|par|de|d|d'amara)/,
  /^sous titrage/,
  /amara org/,
  /^merci d'avoir regarde/,
  /^merci d avoir regarde/,
  /^merci de votre attention/,
  /^merci a tous/,
  /^abonnez vous/,
  /^n'oubliez pas de vous abonner/,
  /^n oubliez pas de vous abonner/,
  /^vous pouvez vous abonner/,
  /^transcription (?:realisee|par)/,
]

// Étiquette de bruit produite par le STT : « [Musique] », « (rires) », « *bruit* ».
const NOISE_TAG_RE = /^\s*(?:\[[^\]]*\]|\([^)]*\)|\*[^*]*\*)\s*$/

// Deuxième personne : la marque la plus fiable d'une parole adressée à l'agent.
const SECOND_PERSON = new Set(["tu", "toi", "ton", "ta", "tes", "te", "vous", "votre", "vos"])

// Mots interrogatifs : ils disent qu'une question est posée, où qu'elle soit.
const QUESTION_WORDS = new Set([
  "comment", "pourquoi", "quand", "ou", "combien", "qui", "quel", "quelle", "quels",
  "quelles", "quoi",
])
// Premiers mots d'une question : les interrogatifs, plus les verbes d'une
// question directe (« Peux-tu… », « As-tu… ») — la ponctuation du STT n'est pas fiable.
const QUESTION_FIRST = new Set([
  ...QUESTION_WORDS,
  "est", "peux", "peut", "pourrais", "pourriez", "sais", "as",
  "veux", "voudrais", "aimerais", "dois", "doit", "faut", "serait",
])

// Verbes d'action à l'impératif : « résume », « note que… », « explique-moi ».
const IMPERATIVE_FIRST = new Set([
  "ouvre", "ouvrir", "ferme", "fermer", "met", "mets", "mettre", "fais", "faire",
  "dis", "dire", "donne", "donner", "montre", "montrer", "affiche", "afficher",
  "explique", "expliquer", "raconte", "raconter", "resume", "resumer", "cherche",
  "chercher", "trouve", "trouver", "note", "noter", "ajoute", "ajouter", "cree",
  "creer", "supprime", "supprimer", "efface", "effacer", "lance", "lancer",
  "arrete", "arreter", "passe", "passer", "va", "aller", "retourne", "retourner",
  "reviens", "revenir", "calcule", "calculer", "corrige", "corriger", "ecris",
  "ecrire", "lis", "lire", "traduis", "traduire", "compare", "comparer", "decris",
  "decrire", "organise", "organiser", "range", "ranger", "planifie", "planifier",
  "rappelle", "rappeler", "continue", "continuer", "reprends", "reprendre",
  "recommence", "recommencer", "augmente", "augmenter", "baisse", "baisser",
  "change", "changer", "modifie", "modifier", "renomme", "renommer", "deplace",
  "deplacer", "archive", "archiver", "epingle", "epingler", "active", "desactive",
  "coupe", "stop", "dors", "silence", "tais", "reponds", "repondre", "aide",
  "aider", "prepare", "preparer", "genere", "generer", "synthetise", "analyser",
  "verifie", "verifier",
])

// Tournures de demande qui ne commencent pas par un verbe : elles disent
// explicitement qu'on s'adresse à l'agent.
const ADDRESS_PHRASES = [
  "je voudrais", "je veux", "je voudrai", "j'aimerais", "j'aimerai",
  "j'ai besoin", "j'aurais besoin", "il me faut", "il me faudrait",
  "peux tu", "pourrais tu", "tu peux", "tu pourrais", "tu veux bien",
  "est ce que", "qu'est ce", "c'est quoi", "merci de", "n'oublie pas de",
]

function isSecondPerson(word: string): boolean {
  return SECOND_PERSON.has(word) || word.startsWith("t'")
}

/**
 * Classe une transcription : adressée à l'agent, ou écartée avec sa raison.
 * `filler`, `hallucination`, `ambient` et `empty` ne méritent aucune réponse.
 */
export function classifyVoiceAddress(
  text: string,
  options?: { expectsAnswer?: boolean },
): VoiceAddressVerdict {
  const raw = String(text ?? "").trim()
  if (!raw) return "empty"
  if (NOISE_TAG_RE.test(raw)) return "hallucination"
  const normalized = normalizeVoiceText(raw)
  const words = normalized ? normalized.split(" ") : []
  if (!words.length) return "empty"
  if (STT_HALLUCINATIONS.some((pattern) => pattern.test(normalized))) return "hallucination"
  const backchannel = words.every((word) => FILLER_TOKENS.has(word)) || FILLER_PHRASES.has(normalized)
  if (backchannel) {
    // v11.14.1 : si Aven vient de POSER une question, « oui », « non » ou « ok »
    // sont la réponse. Le contexte est fourni par l'appelant, jamais deviné ici.
    return options?.expectsAnswer ? "addressed" : "filler"
  }
  // v11.14.1 : le point d'interrogation seul ne suffit pas — « Bon, on y va ? »
  // se dit dans une pièce sans s'adresser à Aven. Il faut un mot interrogatif.
  if (raw.includes("?") && words.some((word) => QUESTION_WORDS.has(word))) return "addressed"
  if (words.length > AMBIENT_MAX_WORDS) return "addressed"
  if (words.some(isSecondPerson)) return "addressed"
  // Une béquille en tête (« bon, », « euh, », « bah, ») ne cache pas la demande :
  // c'est le premier mot PLEIN qui est examiné.
  let head = 0
  while (head < words.length && FILLER_TOKENS.has(words[head])) head += 1
  const first = words[head] ?? ""
  if (QUESTION_FIRST.has(first)) return "addressed"
  if (IMPERATIVE_FIRST.has(first)) return "addressed"
  if (ADDRESS_PHRASES.some((phrase) => normalized === phrase || normalized.startsWith(phrase + " ") || normalized.includes(" " + phrase))) {
    return "addressed"
  }
  return "ambient"
}

/** Vrai si la parole mérite une réponse de l'agent. */
export function isAddressedToAgent(text: string, options?: { expectsAnswer?: boolean }): boolean {
  return classifyVoiceAddress(text, options) === "addressed"
}

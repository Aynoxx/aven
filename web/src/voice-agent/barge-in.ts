// v11.4.2 : la voix de l'agent coupait sa propre question de confirmation.
// v11.11.1 : ce n'était qu'un cas d'un problème général — les réponses se coupaient
// avant leur fin. Deux dégâts, une seule origine : la voix de l'agent revient par
// les haut-parleurs, et le micro la détecte pendant TOUTE la lecture.
//   1. la détection d'énergie arrêtait la lecture en cours ;
//   2. elle changeait aussi la requête de la session, et le lecteur était alors
//      annulé au retour de la synthèse — la fin disparaissait même quand la
//      lecture n'avait pas été arrêtée.
// Le niveau du micro ne décide donc plus RIEN. La décision se prend là où
// l'information existe : sur le texte transcrit — l'écho est reconnu par echo.ts
// (fragments contigus de ce que l'agent vient de dire).
//
// v11.15.0 : toute transcription ne coupait pas seulement l'écho : le bruit de la
// pièce (« euh », une remarque pour quelqu'un d'autre) arrêtait aussi la réponse,
// avant même de savoir si la parole s'adressait à Aven. La coupe se décide
// désormais sur le VERDICT D'ADRESSE calculé par le host. « attends », « attendez »
// et « chut » restent des reprises même seuls : le classifieur les range parmi les
// béquilles, mais pendant une lecture ils s'adressent à celui qui parle.
//
// Pur : testable avec Node seul, sans dépendance desktop ni réseau.
import { normalizeSpeech } from "./echo"

/** Reprises qui coupent la lecture même seules, sans autre marque d'adresse. */
const BARGE_IN_WORDS = new Set(["attends", "attendez", "chut"])

/** Vrai si la phrase est une reprise de parole directe (« attends », « chut »). */
export function isBargeInPhrase(text: string): boolean {
  const words = normalizeSpeech(text).split(" ").filter(Boolean)
  if (!words.length) return false
  return words.every((word) => BARGE_IN_WORDS.has(word))
}

/**
 * Vrai si cette parole transcrite doit couper la lecture en cours.
 * `echo` : la transcription est la propre voix de l'agent (echo.ts) ;
 * `reading` : une réponse est en cours de lecture ;
 * `addressed` : le host a classé la parole comme adressée à Aven.
 */
export function shouldInterruptSpeech(input: {
  echo: boolean
  reading: boolean
  addressed: boolean
  heard?: string
}): boolean {
  // Un écho ne coupe jamais rien : ce n'est pas quelqu'un qui parle.
  if (input.echo) return false
  // Hors lecture, il n'y a rien à couper : la parole suit son cours normal.
  if (input.reading !== true) return false
  // Une parole adressée prend la main. Le bruit de la pièce, lui, laisse la
  // réponse aller au bout — c'est le défaut que v11.15.0 corrige.
  if (input.addressed) return true
  return isBargeInPhrase(input.heard ?? "")
}

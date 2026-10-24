// v11.4.4 : dictionnaire de prononciation, appliqué au texte AVANT la synthèse.
// Pourquoi ce fichier existe : les moteurs de synthèse lisent les noms propres
// d'Aven avec leurs règles de lecture générales, et se trompent. Mesuré sur
// Piper (phonémiseur espeak-ng) : « Freebuff » sortait « frebff », une syllabe
// avalée. Quatre graphies ont été écoutées ; « Fribeuf » est la seule qui rende
// le nom correctement. Même travail pour « Aven », retenu en « Aveun ».
//
// Deux règles portent ce fichier :
//   1. La réécriture ne touche QUE le texte envoyé à la synthèse. L'interface
//      continue d'afficher « Freebuff » et « Aven » : c'est de l'audio, pas de
//      l'orthographe.
//   2. Elle est PAR MOTEUR. Les voix neuronales du service d'Edge prononcent ces
//      deux noms correctement (aucune plainte sur des dizaines d'écoutes) ; les
//      réécrire dégraderait une prononciation juste. Seule la voix locale, de la
//      même famille ancienne que Piper, reçoit le dictionnaire.
//
// Pur : testable avec Node seul, sans dépendance desktop.
export type SpeechEngine = "edge" | "piper" | "sapi"

/** Graphie à prononcer, par moteur. Volontairement vide pour « edge ». */
export const PRONUNCIATIONS: Record<SpeechEngine, Record<string, string>> = {
  edge: {},
  // v11.5.0 : c'est sur Piper que les deux graphies ont été validées à l'oreille
  // (quatre essais pour « Freebuff », trois pour « Aven »).
  piper: {
    Freebuff: "Fribeuf",
    Aven: "Aveun",
  },
  // La voix Windows reste couverte : elle partage le même défaut de lecture.
  sapi: {
    Freebuff: "Fribeuf",
    Aven: "Aveun",
  },
}

/**
 * Réécrit les mots du dictionnaire dans `text`, pour le moteur donné.
 *
 * Les frontières sont des LETTRES, pas `\b` : en Unicode, `\b` traite les
 * accents comme des séparateurs et couperait « Aven » dans « Avençon ». Un mot
 * plus long qui contient l'entrée (« Avenir », « Freebufferie ») n'est jamais
 * touché, et la casse est ignorée (« FREEBUFF » aussi).
 */
export function applyPronunciations(text: string, engine: SpeechEngine): string {
  const source = String(text ?? "")
  const entries = Object.entries(PRONUNCIATIONS[engine] ?? {})
  if (!entries.length) return source
  let out = source
  // Les entrées les plus longues d'abord : une future entrée « Freebuff Pro »
  // doit passer avant « Freebuff ».
  for (const [word, spoken] of entries.sort((a, b) => b[0].length - a[0].length)) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    out = out.replace(new RegExp(`(?<!\\p{L})${escaped}(?!\\p{L})`, "giu"), spoken)
  }
  return out
}

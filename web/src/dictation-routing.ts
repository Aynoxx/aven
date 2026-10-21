// v10.4.0 : provenance d'une dictée — la décision qui manquait.
//
// Constat : le micro du hub et celui du composeur partageaient le MÊME routage.
// Une commande dictée depuis la conversation pouvait donc ouvrir une page au lieu
// d'écrire dans la chatbox, et une dictée du hub repartait trop souvent chez l'agent
// au lieu d'exécuter la commande demandée.
//
// Règle unique, ici et nulle part ailleurs :
//   · composeur → toujours une dictée ordinaire (aucune action, aucun changement d'agent) ;
//   · hub       → l'action d'application s'exécute, une cible d'agent réellement
//                 présente bascule, le reste rejoint le composeur.
//
// Pur : testable avec Node seul, sans dépendance desktop.
import type { DictationIntent } from "./types"

export type DictationOrigin = "hub" | "composer"

/**
 * Intention EFFECTIVE d'une dictée selon l'endroit où elle a été prononcée.
 * Le composeur est une zone de rédaction : il ne déclenche jamais rien, même quand
 * la phrase ressemble à un ordre (« ouvre les paramètres » reste du texte).
 */
export function effectiveIntent(
  intent: DictationIntent | undefined,
  origin: DictationOrigin,
  agentIds: readonly string[],
): DictationIntent {
  if (origin === "composer") return { intent: "chat" }
  if (intent?.intent === "app") return intent
  if (intent?.intent === "agent") {
    // Une cible absente ou inconnue ne bascule nulle part : la dictée reste sur
    // l'agent courant (garde de la liste fermée, côté renderer).
    return intent.target && agentIds.includes(intent.target) ? intent : { intent: "chat" }
  }
  return { intent: "chat" }
}

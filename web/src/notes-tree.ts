// Pur : testable avec Node seul, sans dépendance desktop.
//
// v12.6.0 : retirer une note de l'arbre AFFICHÉ, sans attendre le disque. Une
// suppression doit se voir à l'instant ; le rechargement qui suit confirme. Le
// module est pur parce que la récursion est la seule logique en jeu — elle se
// teste sans React ni IPC.

export type PrunableEntry = { type: "note" | "folder"; id: string; children?: PrunableEntry[] }

/**
 * Renvoie un nouvel arbre sans la note `id` (l'entrée d'origine n'est pas
 * modifiée). Un dossier vidé de ses notes reste en place : c'est un contenant
 * réel sur disque, pas un résultat de recherche.
 */
export function pruneNote<T extends PrunableEntry>(nodes: T[], id: string): T[] {
  const kept: T[] = []
  for (const node of nodes) {
    if (node.type === "note") {
      if (node.id !== id) kept.push(node)
      continue
    }
    const children = Array.isArray(node.children) ? node.children : []
    const next = pruneNote(children, id)
    kept.push(next === children ? node : ({ ...node, children: next } as T))
  }
  return kept
}

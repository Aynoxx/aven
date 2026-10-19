// Pur : testable avec Node seul, sans dépendance desktop.
// v10.2.2 : une session sans modèle persistait la chaîne littérale « null/… » et la
// carte « MODÈLE ACTIF » l'affichait telle quelle. Une ref inutilisable n'est pas un
// modèle : on la traite comme « Auto » (le routeur choisit au prochain message).

/** Ref de modèle affichable, ou null si absente/dégénérée. */
export function usableModelRef(ref: unknown): string | null {
  const value = String(ref ?? "").trim()
  if (!value) return null
  if (/^(null|undefined)$/i.test(value)) return null
  if (/^(null|undefined)\//i.test(value)) return null
  return value
}

/** Libellé d'une conversation sans modèle utilisable. */
export const AUTO_MODEL_LABEL = "Auto — le routeur choisit"

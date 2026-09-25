// Actions sur sélection (v8.9.0) : sélectionner du texte dans une réponse ouvre une mini-barre
// (Copier / Corriger / Expliquer / Envoyer à l'agent). Ce module est pur : extraction de la
// sélection et construction des prompts, sans DOM obligatoire (testable avec Node seul).
// Le texte cité atterrit TOUJOURS dans le composeur : l'utilisateur valide avec Entrée.

export const SELECTION_MAX = 4000 // garde-fou : une sélection démesurée ne doit pas noyer le composeur

export type SelectionPromptAction = "fix" | "explain" | "send"

/** Texte sélectionné À L'INTÉRIEUR du conteneur donné ("" sinon ou sans DOM). */
export function selectionWithin(root: Element | null): string {
  if (typeof window === "undefined" || !root) return ""
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return ""
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return ""
  // On conserve les sauts de ligne et l'indentation (c'est du code), on ne rogne que les bords.
  const text = sel.toString().trim()
  if (!text) return ""
  return text.length > SELECTION_MAX ? text.slice(0, SELECTION_MAX) + "…" : text
}

/** Construit le prompt prérempli dans le composeur selon l'action choisie. */
export function buildPrompt(action: SelectionPromptAction, selection: string): string {
  const text = selection.trim()
  if (!text) return ""
  if (action === "fix") return `Corrige ce code :\n\n\`\`\`\n${text}\n\`\`\``
  if (action === "explain") return `Explique ce code :\n\n\`\`\`\n${text}\n\`\`\``
  // « Envoyer à l'agent » : citation en bloc, l'utilisateur écrit sa demande à la suite.
  return text.split("\n").map((line) => `> ${line}`).join("\n") + "\n\n"
}

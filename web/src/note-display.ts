// Pur : testable avec Node seul, sans dépendance desktop.
// v10.2.2 : le fichier .md commence par « # Titre » (auto-suffisant sur disque) et
// l'aperçu affichait ce H1 SOUS un h4 qui répétait déjà le titre. On retire le H1
// de tête uniquement quand il répète le titre affiché — le fichier reste intact.

/** Retire un « # titre » de tête quand il répète exactement le titre affiché. */
export function stripLeadingTitle(markdown: string, title: string): string {
  const text = String(markdown ?? "")
  const expected = String(title ?? "").trim().toLowerCase()
  if (!expected) return text
  const match = text.match(/^\s*#\s+(.+?)\s*(?:\r?\n|$)/)
  if (!match) return text
  if (match[1].trim().toLowerCase() !== expected) return text
  return text.slice(match[0].length).replace(/^\s*\r?\n/, "")
}

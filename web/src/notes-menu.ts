// Pur : testable avec Node seul, sans dépendance desktop.
// v12.8.0 : le menu contextuel de l'éditeur est une décision pure — la même
// fonction sert au clavier, à la souris et aux tests. Elle ne connaît ni TipTap
// ni React : elle reçoit le texte avant le curseur et rend la requête.
export type SlashGroup = "Titres" | "Listes" | "Blocs" | "Mise en forme"

export type SlashCommand = {
  id: string
  label: string
  group: SlashGroup
  keywords: string[]
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { id: "h1", label: "Titre 1", group: "Titres", keywords: ["titre", "heading", "h1"] },
  { id: "h2", label: "Titre 2", group: "Titres", keywords: ["titre", "heading", "h2"] },
  { id: "h3", label: "Titre 3", group: "Titres", keywords: ["titre", "heading", "h3"] },
  { id: "paragraph", label: "Texte normal", group: "Titres", keywords: ["texte", "paragraphe", "normal"] },
  { id: "bullet", label: "Liste à puces", group: "Listes", keywords: ["liste", "puces", "bullet"] },
  { id: "ordered", label: "Liste numérotée", group: "Listes", keywords: ["liste", "numérotée", "ordered"] },
  { id: "task", label: "Liste de tâches", group: "Listes", keywords: ["tâche", "case", "todo", "task"] },
  { id: "quote", label: "Citation", group: "Blocs", keywords: ["citation", "quote"] },
  { id: "code", label: "Bloc de code", group: "Blocs", keywords: ["code", "terminal"] },
  { id: "divider", label: "Séparateur horizontal", group: "Blocs", keywords: ["séparateur", "ligne", "divider"] },
  { id: "table", label: "Tableau", group: "Blocs", keywords: ["tableau", "table", "colonnes"] },
  { id: "callout", label: "Encadré d'information", group: "Blocs", keywords: ["encadré", "information", "info", "callout"] },
  { id: "link", label: "Lien", group: "Mise en forme", keywords: ["lien", "url", "link"] },
  { id: "bold", label: "Gras", group: "Mise en forme", keywords: ["gras", "bold"] },
  { id: "italic", label: "Italique", group: "Mise en forme", keywords: ["italique", "italic"] },
]

/** Texte normalisé pour chercher dans les libellés et les mots-clés. */
export function normalizeMenuQuery(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** `/` au début d'un mot ; la position est celle du slash dans le texte reçu. */
export function slashQueryBefore(text: string): { query: string; start: number } | null {
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(String(text ?? ""))
  if (!match) return null
  const offset = match[0].startsWith(" ") ? 1 : 0
  return { query: match[1], start: match.index + offset }
}

/** `@` au début d'un mot, sans avaler un deuxième arobase. */
export function mentionQueryBefore(text: string): { query: string; start: number } | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(String(text ?? ""))
  if (!match) return null
  const offset = match[0].startsWith(" ") ? 1 : 0
  return { query: match[1], start: match.index + offset }
}

/** Commandes filtrées par libellé et mots-clés ; vide = toutes. */
export function filterSlashCommands(query: string): SlashCommand[] {
  const terms = normalizeMenuQuery(query).split(" ").filter(Boolean)
  if (!terms.length) return [...SLASH_COMMANDS]
  return SLASH_COMMANDS.filter((command) => {
    // Le groupe sert à ranger le menu, pas à élargir la recherche : « titre » ne
    // doit pas faire remonter « Texte normal » parce qu'il partage le groupe Titres.
    const haystack = normalizeMenuQuery(`${command.label} ${command.keywords.join(" ")}`)
    return terms.every((term) => haystack.includes(term))
  })
}

/** Navigation circulaire du menu, jamais un index hors bornes. */
export function nextMenuIndex(current: number, length: number, delta: number): number {
  if (length <= 0) return 0
  if (!Number.isFinite(current) || current < 0 || current >= length) return 0
  return (current + delta + length) % length
}

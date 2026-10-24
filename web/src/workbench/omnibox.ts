// v11.0.0 : barre de commande du Poste — parseur pur, testable sans DOM.
//
// Trois modes, une seule saisie :
//   · texte nu          → recherche conversations / notes ;
//   · « > »             → commandes d'application ;
//   · « /notes » etc.   → portée explicite.
// Une recherche vide n'exécute jamais d'action implicite.

export type OmniboxScope = "conversations" | "notes" | "files"

export type OmniboxCommand = {
  id: string
  label: string
  hint: string
}

export const OMNIBOX_COMMANDS: OmniboxCommand[] = [
  { id: "new-chat", label: "Nouvelle conversation", hint: "Ctrl N" },
  { id: "new-note", label: "Nouvelle note", hint: "Notes" },
  { id: "capture", label: "Capture rapide", hint: "Ctrl Maj N" },
  { id: "open-conversations", label: "Conversations", hint: "Instrument" },
  { id: "open-notes", label: "Notes", hint: "Instrument" },
  { id: "open-files", label: "Fichiers", hint: "Instrument" },
  { id: "open-terminal", label: "Terminal Freebuff", hint: "Instrument" },
  { id: "open-orchestration", label: "Orchestration", hint: "Instrument" },
  { id: "open-settings", label: "Réglages", hint: "Instrument" },
  { id: "open-settings-appearance", label: "Réglages · Apparence", hint: "Instrument" },
  { id: "open-settings-usage", label: "Réglages · Usage", hint: "Instrument" },
  { id: "go-home", label: "Aujourd'hui", hint: "Accueil" },
]

export type ParsedOmnibox =
  | { mode: "search"; query: string }
  | { mode: "command"; query: string }
  | { mode: "scope"; scope: OmniboxScope; query: string }

const SCOPE_ALIASES: Record<string, OmniboxScope> = {
  notes: "notes",
  note: "notes",
  fichiers: "files",
  fichier: "files",
  files: "files",
  conversations: "conversations",
  conversation: "conversations",
  chats: "conversations",
}

export function parseOmnibox(raw: string): ParsedOmnibox {
  const value = raw.trimStart()
  if (value.startsWith(">")) return { mode: "command", query: value.slice(1).trim() }
  if (value.startsWith("/")) {
    const body = value.slice(1)
    const match = body.match(/^([a-zà-ÿ]+)(?:\s+([\s\S]*))?$/i)
    if (!match) return { mode: "scope", scope: "notes", query: "" }
    const scope = SCOPE_ALIASES[match[1].toLocaleLowerCase("fr-FR")]
    if (!scope) return { mode: "scope", scope: "notes", query: body }
    return { mode: "scope", scope, query: (match[2] ?? "").trim() }
  }
  return { mode: "search", query: value.trim() }
}

export function matchCommands(query: string): OmniboxCommand[] {
  const needle = query.trim().toLocaleLowerCase("fr-FR")
  if (!needle) return OMNIBOX_COMMANDS
  return OMNIBOX_COMMANDS.filter((c) =>
    c.label.toLocaleLowerCase("fr-FR").includes(needle) || c.id.includes(needle),
  )
}

// Classement stable : préfixe d'abord, puis inclusion, puis ordre d'origine.
export function rankByQuery<T>(items: readonly T[], query: string, pick: (item: T) => string): T[] {
  const needle = query.trim().toLocaleLowerCase("fr-FR")
  if (!needle) return [...items]
  const scored: { item: T; score: number; index: number }[] = []
  items.forEach((item, index) => {
    const value = pick(item).toLocaleLowerCase("fr-FR")
    if (!value.includes(needle)) return
    scored.push({ item, score: value.startsWith(needle) ? 0 : 1, index })
  })
  scored.sort((a, b) => a.score - b.score || a.index - b.index)
  return scored.map((s) => s.item)
}

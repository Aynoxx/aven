// Pur : testable avec Node seul, sans dépendance desktop.
// v12.8.0 : la bibliothèque cherche dans les notes, les repères, les étiquettes
// libres et les agents associés. Les notes viennent du host (contenu), le reste
// est déjà dans la mémoire de la vue — on fusionne sans rappeler le disque.
import type { NoteHighlight, NoteSearchHit, NoteTreeEntry } from "./types"

export type SearchKind = "all" | "note" | "highlight" | "label" | "agent"
export type HitKind = Exclude<SearchKind, "all">

export type TreeNote = { id: string; title: string; folder: string; updated: number }
export type LibraryHit = {
  key: string
  id: string
  // v12.8.0 : un repère a son propre identifiant, mais son clic ouvre la note.
  noteId?: string
  title: string
  snippet: string
  folder: string
  kind: HitKind
  typeLabel: string
}

export const SEARCH_KIND_LABELS: Record<HitKind, string> = {
  note: "Note",
  highlight: "Repère",
  label: "Étiquette",
  agent: "Agent",
}

export function normalizeLibraryText(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export function noteFolder(id: string): string {
  const clean = String(id ?? "").replace(/\\/g, "/")
  return clean.includes("/") ? clean.slice(0, clean.lastIndexOf("/")) : ""
}

export function noteName(id: string): string {
  const clean = String(id ?? "").replace(/\\/g, "/")
  return clean.slice(clean.lastIndexOf("/") + 1).replace(/\.md$/i, "")
}

/** Notes visibles de l'arbre, dans l'ordre de l'arbre. */
export function flattenTreeNotes(tree: NoteTreeEntry[]): TreeNote[] {
  const out: TreeNote[] = []
  const walk = (nodes: NoteTreeEntry[]) => {
    for (const node of nodes) {
      if (node.type === "note") out.push({ id: node.id, title: node.title, folder: noteFolder(node.id), updated: node.updated })
      else walk(node.children)
    }
  }
  walk(tree)
  return out
}

function matchesQuery(text: string, query: string): boolean {
  const terms = normalizeLibraryText(query).split(" ").filter(Boolean)
  if (!terms.length) return false
  const haystack = normalizeLibraryText(text)
  return terms.every((term) => haystack.includes(term))
}

/**
 * Résultats locaux : étiquettes, agents et repères. Une note n'apparaît qu'une
 * fois par nature, avec son vrai libellé — jamais une ligne inventée.
 */
export function localSearchHits(input: {
  query: string
  notes: TreeNote[]
  labels: Record<string, string[]>
  agentTags: Record<string, string[]>
  agentNames: Record<string, string>
  highlights: NoteHighlight[]
}): LibraryHit[] {
  const query = String(input.query ?? "")
  if (!normalizeLibraryText(query)) return []
  const out: LibraryHit[] = []
  const byId = new Map(input.notes.map((note) => [note.id, note]))

  for (const note of input.notes) {
    const labels = input.labels[note.id] ?? []
    const matchingLabels = labels.filter((label) => matchesQuery(label, query))
    if (matchingLabels.length) {
      out.push({
        key: `label:${note.id}`,
        id: note.id,
        title: note.title,
        snippet: matchingLabels.join(" · "),
        folder: note.folder,
        kind: "label",
        typeLabel: SEARCH_KIND_LABELS.label,
      })
    }
  }

  for (const note of input.notes) {
    const tags = input.agentTags[note.id] ?? []
    const matchingAgents = tags.filter((tag) => matchesQuery(`${input.agentNames[tag] ?? tag} ${tag}`, query))
    if (matchingAgents.length) {
      out.push({
        key: `agent:${note.id}`,
        id: note.id,
        title: note.title,
        snippet: matchingAgents.map((tag) => input.agentNames[tag] ?? tag).join(" · "),
        folder: note.folder,
        kind: "agent",
        typeLabel: SEARCH_KIND_LABELS.agent,
      })
    }
  }

  for (const highlight of input.highlights) {
    if (!matchesQuery(`${highlight.quote} ${highlight.noteTitle}`, query)) continue
    const note = byId.get(highlight.noteId)
    out.push({
      key: `highlight:${highlight.id}`,
      id: highlight.id,
      noteId: highlight.noteId,
      title: note?.title || highlight.noteTitle,
      snippet: highlight.quote,
      folder: highlight.folder,
      kind: "highlight",
      typeLabel: SEARCH_KIND_LABELS.highlight,
    })
  }

  return out
}

/** Fusionne les résultats du contenu (host) et les résultats locaux, sans doublon. */
export function mergeLibraryHits(noteHits: NoteSearchHit[], localHits: LibraryHit[], filter: SearchKind): LibraryHit[] {
  const byKey = new Map<string, LibraryHit>()
  for (const hit of noteHits) {
    const id = String(hit.id ?? "")
    if (!id) continue
    const key = `note:${id}`
    byKey.set(key, {
      key,
      id,
      title: hit.title || noteName(id),
      snippet: hit.snippet || "",
      folder: hit.folder ?? noteFolder(id),
      kind: "note",
      typeLabel: SEARCH_KIND_LABELS.note,
    })
  }
  for (const hit of localHits) if (!byKey.has(hit.key)) byKey.set(hit.key, hit)
  const order: Record<HitKind, number> = { note: 0, highlight: 1, label: 2, agent: 3 }
  return [...byKey.values()]
    .filter((hit) => filter === "all" || hit.kind === filter)
    .sort((a, b) => (order[a.kind] - order[b.kind]) || a.title.localeCompare(b.title, "fr"))
}

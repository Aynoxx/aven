// Métadonnées des notes (v8.10.0) : épinglage persistant par espace de travail.
// Fichier `.opencode-app/notes-meta.json` dans l'espace actif — même convention que
// agent-names.json et archived.json. Sans dépendance à Electron : testable avec Node seul.
import { readFileSync } from "node:fs"
import path from "node:path"
import { writeJsonAtomicPretty } from "./atomic-file.js"

export const MAX_PINNED = 20

const file = (workspace: string) => path.join(workspace, ".opencode-app", "notes-meta.json")

type NotesMeta = { pinned: string[] }

function readMeta(workspace: string): NotesMeta {
  try {
    const raw = JSON.parse(readFileSync(file(workspace), "utf8")) as NotesMeta
    return { pinned: Array.isArray(raw.pinned) ? raw.pinned.filter((id) => typeof id === "string") : [] }
  } catch {
    return { pinned: [] }
  }
}

export function loadPinned(workspace: string): string[] {
  return readMeta(workspace).pinned
}

/** Épingle ou détache une note. Retourne la nouvelle liste. */
export function togglePin(workspace: string, id: string): string[] {
  const meta = readMeta(workspace)
  // défense : jamais de traversée de chemin. Les \\ sont normalisés AVANT basename :
  // sur Linux, path.basename ne les découpe pas (« ..\\evil\\note.md » resterait entier).
  const clean = path.basename(String(id || "").replace(/[\\/]+/g, "/"))
  const wasPinned = meta.pinned.includes(clean)
  if (wasPinned) meta.pinned = meta.pinned.filter((x) => x !== clean)
  else {
    if (meta.pinned.length >= MAX_PINNED) throw new Error(`Maximum ${MAX_PINNED} notes épinglées.`)
    meta.pinned.push(clean)
  }
  writeJsonAtomicPretty(file(workspace), meta)
  return meta.pinned
}

/** Normalise un texte pour la recherche : minuscules, sans accents, ponctuation → espace. */
export function normalizeForSearch(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // accents
    .replace(/[^a-z0-9]+/g, " ") // ponctuation et symboles → espace
    .trim()
}

/** Les termes de la requête sont-ils tous présents dans le texte normalisé ? */
export function matchQuery(normalizedText: string, normalizedQuery: string): boolean {
  const terms = normalizedQuery.split(/\s+/).filter(Boolean)
  return terms.every((t) => normalizedText.includes(t))
}

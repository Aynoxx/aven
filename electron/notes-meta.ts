// Métadonnées des notes (v8.10.0) : épinglage persistant par espace de travail.
// Fichier `.opencode-app/notes-meta.json` dans l'espace actif — même convention que
// agent-names.json et archived.json. Sans dépendance à Electron : testable avec Node seul.
// v9.3.0 : le fichier porte aussi les TAGS PAR AGENT de chaque note (carte mentale :
// une note peut être liée à un ou plusieurs agents, filtre dans la vue Notes).
import { readFileSync } from "node:fs"
import path from "node:path"
import { writeJsonAtomicPretty } from "./atomic-file.js"

export const MAX_PINNED = 20
export const MAX_NOTE_TAGS = 6

const file = (workspace: string) => path.join(workspace, ".opencode-app", "notes-meta.json")

type NotesMeta = { pinned: string[]; tags?: Record<string, string[]> }

function readMeta(workspace: string): NotesMeta {
  try {
    const raw = JSON.parse(readFileSync(file(workspace), "utf8")) as NotesMeta
    const tags: Record<string, string[]> = {}
    if (raw.tags && typeof raw.tags === "object") {
      for (const [id, list] of Object.entries(raw.tags)) {
        if (!Array.isArray(list)) continue
        // Défense : jamais de traversée de chemin dans les identifiants (même règle que pinned).
        const cleanId = path.basename(String(id).replace(/[\\/]+/g, "/"))
        const clean = list.filter((t) => typeof t === "string" && t.trim()).map((t) => String(t).trim().slice(0, 30))
        if (cleanId && clean.length) tags[cleanId] = [...new Set(clean)].slice(0, MAX_NOTE_TAGS)
      }
    }
    return { pinned: Array.isArray(raw.pinned) ? raw.pinned.filter((id) => typeof id === "string") : [], tags }
  } catch {
    return { pinned: [], tags: {} }
  }
}

/** Tags par agent d'une note (liste vide si aucune). */
export function loadTags(workspace: string, id: string): string[] {
  const clean = path.basename(String(id || "").replace(/[\\/]+/g, "/"))
  return readMeta(workspace).tags?.[clean] ?? []
}

/** Remplace les tags d'une note. Normalisation : accents retirés, minuscules, tirets. */
export function setTags(workspace: string, id: string, tags: string[]): string[] {
  const clean = path.basename(String(id || "").replace(/[\\/]+/g, "/"))
  if (!clean || clean !== String(id || "")) throw new Error("Note invalide")
  const normalized = normalizeTags(tags)
  const meta = readMeta(workspace)
  meta.tags = { ...(meta.tags ?? {}) }
  if (normalized.length) meta.tags[clean] = normalized
  else delete meta.tags[clean]
  writeJsonAtomicPretty(file(workspace), meta)
  return normalized
}

/** Normalise une liste de tags : minuscules, sans accents, 30 car. max, dédoublonnée. */
export function normalizeTags(tags: unknown): string[] {
  const out = (Array.isArray(tags) ? tags : [])
    .map((t) => String(t ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .slice(0, MAX_NOTE_TAGS)
  return [...new Set(out)]
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

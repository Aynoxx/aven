// Métadonnées des notes (v8.10.0) : épinglage persistant par espace de travail.
// Fichier `.opencode-app/notes-meta.json` dans l'espace actif — même convention que
// agent-names.json et archived.json. Sans dépendance à Electron : testable avec Node seul.
// v9.3.0 : le fichier porte aussi les TAGS PAR AGENT de chaque note (carte mentale :
// une note peut être liée à un ou plusieurs agents, filtre dans la vue Notes).
import { readFileSync } from "node:fs"
import path from "node:path"
import { writeJsonAtomicPretty } from "./atomic-file.js"
import { cleanNoteId, cleanRelPath } from "./notes.js"

export const MAX_PINNED = 20
export const MAX_NOTE_TAGS = 6
export const MAX_NOTE_LABELS = 12
export const MAX_NOTE_HIGHLIGHTS = 500

export type NoteHighlight = { id: string; noteId: string; noteTitle: string; quote: string; createdAt: number }

const file = (workspace: string) => path.join(workspace, ".opencode-app", "notes-meta.json")

type NotesMeta = { pinned: string[]; tags?: Record<string, string[]>; labels?: Record<string, string[]>; highlights?: NoteHighlight[] }

function readMeta(workspace: string): NotesMeta {
  try {
    const raw = JSON.parse(readFileSync(file(workspace), "utf8")) as NotesMeta
    const tags: Record<string, string[]> = {}
    if (raw.tags && typeof raw.tags === "object") {
      for (const [id, list] of Object.entries(raw.tags)) {
        if (!Array.isArray(list)) continue
        // Défense : ids en chemin relatif sûr (v10.1.0 : sous-dossiers supportés).
        const cleanId = cleanNoteId(id)
        if (!cleanId) continue
        const clean = list.filter((t) => typeof t === "string" && t.trim()).map((t) => String(t).trim().slice(0, 30))
        if (clean.length) tags[cleanId] = [...new Set(clean)].slice(0, MAX_NOTE_TAGS)
      }
    }
    const labels: Record<string, string[]> = {}
    if (raw.labels && typeof raw.labels === "object") {
      for (const [id, list] of Object.entries(raw.labels)) {
        const cleanId = cleanNoteId(id)
        if (!cleanId || !Array.isArray(list)) continue
        const clean = normalizeLabels(list)
        if (clean.length) labels[cleanId] = clean
      }
    }
    const highlights: NoteHighlight[] = Array.isArray(raw.highlights)
      ? raw.highlights.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const noteId = cleanNoteId(item.noteId)
        const id = String(item.id ?? "").trim().slice(0, 100)
        const quote = String(item.quote ?? "").trim().slice(0, 2000)
        const createdAt = Number(item.createdAt)
        if (!noteId || !id || !quote || !Number.isFinite(createdAt) || createdAt <= 0) return []
        return [{ id, noteId, noteTitle: String(item.noteTitle ?? "").trim().slice(0, 120), quote, createdAt }]
      }).slice(-MAX_NOTE_HIGHLIGHTS)
      : []
    return {
      pinned: Array.isArray(raw.pinned) ? raw.pinned.filter((id) => typeof id === "string") : [],
      tags,
      labels,
      highlights,
    }
  } catch {
    return { pinned: [], tags: {}, labels: {}, highlights: [] }
  }
}

/** Tags par agent d'une note (liste vide si aucune). */
export function loadTags(workspace: string, id: string): string[] {
  const clean = cleanNoteId(id)
  return clean ? readMeta(workspace).tags?.[clean] ?? [] : []
}

// v10.5.0 : lecture en lot pour l'arbre Notes — un seul accès au fichier de métadonnées.
export function loadAllTags(workspace: string): Record<string, string[]> {
  const tags = readMeta(workspace).tags ?? {}
  return Object.fromEntries(Object.entries(tags).map(([id, values]) => [id, [...values]]))
}

/** Remplace les tags d'une note. Normalisation : accents retirés, minuscules, tirets. */
export function setTags(workspace: string, id: string, tags: string[]): string[] {
  const clean = cleanNoteId(id)
  if (!clean) throw new Error("Note invalide")
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
  // Défense (v10.1.0) : ids en chemin relatif sûr — jamais de traversée.
  const clean = cleanNoteId(id)
  if (!clean) throw new Error("Note invalide")
  const wasPinned = meta.pinned.includes(clean)
  if (wasPinned) meta.pinned = meta.pinned.filter((x) => x !== clean)
  else {
    if (meta.pinned.length >= MAX_PINNED) throw new Error(`Maximum ${MAX_PINNED} notes épinglées.`)
    meta.pinned.push(clean)
  }
  writeJsonAtomicPretty(file(workspace), meta)
  return meta.pinned
}

// v10.2.2 : une note purgée laissait son épinglage et ses tags dans notes-meta.json.
// Le fichier devenait une liste de fantômes (ids absents du disque) et le filtre par
// agent proposait des tags pour des notes inexistantes. On oublie explicitement.
/** Oublie épinglage et tags d'une note supprimée définitivement. */
export function forgetNote(workspace: string, id: string): void {
  const clean = cleanNoteId(id)
  if (!clean) return
  const meta = readMeta(workspace)
  // v10.2.2 : la purge reçoit l'id de la POUBELLE (».trash/note.md»), alors que
  // l'épinglage et les tags sont indexés sur le chemin d'origine (».note.md»).
  // Sans cette normalisation, les métadonnées survivaient à la suppression.
  const keys = new Set([clean, clean.replace(/^\.(?:trash|archive)\//, "")])
  const pinned = meta.pinned.filter((x) => !keys.has(x))
  const tags = { ...(meta.tags ?? {}) }
  const labels = { ...(meta.labels ?? {}) }
  const highlights = (meta.highlights ?? []).filter((item) => !keys.has(item.noteId))
  let hadTags = false
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(tags, key)) hadTags = true
    delete tags[key]
    delete labels[key]
  }
  const labelsChanged = Object.keys(labels).length !== Object.keys(meta.labels ?? {}).length
  const highlightsChanged = highlights.length !== (meta.highlights ?? []).length
  if (pinned.length === meta.pinned.length && !hadTags && !labelsChanged && !highlightsChanged) return
  writeJsonAtomicPretty(file(workspace), { pinned, tags, labels, highlights })
}

/** Suit le déplacement ou le renommage d'un fichier/dossier dans l'arbre des notes. */
export function rekeyNoteMetadata(workspace: string, fromPath: string, toPath: string): void {
  const from = cleanRelPath(fromPath)
  const to = cleanRelPath(toPath)
  if (!from || !to || from === to) return
  const remap = (value: string) => value === from || value.startsWith(from + "/")
    ? to + value.slice(from.length)
    : value
  const meta = readMeta(workspace)
  let changed = false

  const pinned = meta.pinned.map((id) => {
    const next = remap(id)
    if (next !== id) changed = true
    return next
  })
  const rekeyMap = (source: Record<string, string[]> = {}) => {
    const result: Record<string, string[]> = {}
    for (const [id, values] of Object.entries(source)) {
      const next = remap(id)
      if (next !== id) changed = true
      result[next] = [...new Set([...(result[next] ?? []), ...values])]
    }
    return result
  }
  const tags = rekeyMap(meta.tags)
  const labels = rekeyMap(meta.labels)
  const highlights = (meta.highlights ?? []).map((item) => {
    const noteId = remap(item.noteId)
    if (noteId !== item.noteId) changed = true
    return noteId === item.noteId ? item : { ...item, noteId }
  })
  if (!changed) return
  writeJsonAtomicPretty(file(workspace), { pinned: [...new Set(pinned)], tags, labels, highlights })
}

/** Highlights conservés dans les métadonnées de l'espace, avec leur note source. */
export function loadHighlights(workspace: string): NoteHighlight[] {
  return (readMeta(workspace).highlights ?? [])
    .map((item) => ({ ...item }))
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Enregistre un extrait sélectionné dans une note et garde sa provenance. */
export function addHighlight(workspace: string, noteId: string, noteTitle: string, quote: string): NoteHighlight {
  const cleanId = cleanNoteId(noteId)
  const cleanQuote = String(quote ?? "").trim().slice(0, 2000)
  if (!cleanId) throw new Error("Note invalide")
  if (!cleanQuote) throw new Error("Sélectionnez un extrait avant de le conserver")
  const meta = readMeta(workspace)
  const now = Date.now()
  const id = `highlight-${now.toString(36)}-${(meta.highlights ?? []).length.toString(36)}`
  const item: NoteHighlight = {
    id,
    noteId: cleanId,
    noteTitle: String(noteTitle ?? "").trim().slice(0, 120),
    quote: cleanQuote,
    createdAt: now,
  }
  meta.highlights = [...(meta.highlights ?? []), item].slice(-MAX_NOTE_HIGHLIGHTS)
  writeJsonAtomicPretty(file(workspace), {
    pinned: meta.pinned,
    tags: meta.tags ?? {},
    labels: meta.labels ?? {},
    highlights: meta.highlights,
  })
  return item
}

/** Supprime uniquement le highlight demandé, jamais sa note source. */
export function removeHighlight(workspace: string, id: string): void {
  const meta = readMeta(workspace)
  const next = (meta.highlights ?? []).filter((item) => item.id !== String(id ?? ""))
  if (next.length === (meta.highlights ?? []).length) return
  meta.highlights = next
  writeJsonAtomicPretty(file(workspace), {
    pinned: meta.pinned,
    tags: meta.tags ?? {},
    labels: meta.labels ?? {},
    highlights: next,
  })
}

/** Étiquettes libres d'une note, indépendantes des agents affectés. */
export function loadLabels(workspace: string, id: string): string[] {
  const clean = cleanNoteId(id)
  return clean ? readMeta(workspace).labels?.[clean] ?? [] : []
}

/** Toutes les étiquettes libres, lues en un seul accès et copiées pour l'UI. */
export function loadAllLabels(workspace: string): Record<string, string[]> {
  const labels = readMeta(workspace).labels ?? {}
  return Object.fromEntries(Object.entries(labels).map(([id, values]) => [id, [...values]]))
}

/** Remplace les étiquettes libres d'une note. */
export function setLabels(workspace: string, id: string, labels: string[]): string[] {
  const clean = cleanNoteId(id)
  if (!clean) throw new Error("Note invalide")
  const normalized = normalizeLabels(labels)
  const meta = readMeta(workspace)
  meta.labels = { ...(meta.labels ?? {}) }
  if (normalized.length) meta.labels[clean] = normalized
  else delete meta.labels[clean]
  writeJsonAtomicPretty(file(workspace), meta)
  return normalized
}

/** Normalise les étiquettes libres : accents retirés, tirets, 30 caractères, 12 max. */
export function normalizeLabels(labels: unknown): string[] {
  const values = (Array.isArray(labels) ? labels : [])
    .map((value) => String(value ?? "").trim().toLowerCase().normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .replace(/\\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30))
    .filter(Boolean)
  return [...new Set(values)].slice(0, MAX_NOTE_LABELS)
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

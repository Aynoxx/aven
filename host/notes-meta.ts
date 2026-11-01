// Métadonnées des notes (v8.10.0) : épinglage persistant par espace de travail.
// Fichier `.opencode-app/notes-meta.json` dans l'espace actif — même convention que
// agent-names.json et archived.json. Sans dépendance à Electron : testable avec Node seul.
// v9.3.0 : le fichier porte aussi les TAGS PAR AGENT de chaque note.
// v12.8.0 : il porte désormais les ÉTIQUETTES LIBRES, un système distinct des agents.
// Au déplacement d'une note ou au renommage d'un dossier, les clés sont remappées
// (remapNoteIds / remapNotePrefix) : épingles, agents et étiquettes suivent la note.
import { readFileSync } from "node:fs"
import path from "node:path"
import { writeJsonAtomicPretty } from "./atomic-file.js"
import { cleanFolder, cleanNoteId } from "./notes.js"

export const MAX_PINNED = 20
export const MAX_NOTE_TAGS = 6
export const MAX_NOTE_LABELS = 8

const file = (workspace: string) => path.join(workspace, ".opencode-app", "notes-meta.json")

type NotesMeta = { pinned: string[]; tags?: Record<string, string[]>; labels?: Record<string, string[]> }

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
        if (!Array.isArray(list)) continue
        const cleanId = cleanNoteId(id)
        if (!cleanId) continue
        const clean = normalizeLabels(list)
        if (clean.length) labels[cleanId] = clean
      }
    }
    return { pinned: Array.isArray(raw.pinned) ? raw.pinned.filter((id) => typeof id === "string") : [], tags, labels }
  } catch {
    return { pinned: [], tags: {}, labels: {} }
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

/** Étiquettes libres d'une note (casse et accents conservés pour l'affichage). */
export function loadLabels(workspace: string, id: string): string[] {
  const clean = cleanNoteId(id)
  return clean ? readMeta(workspace).labels?.[clean] ?? [] : []
}

/** Lecture en lot des étiquettes — un seul accès au fichier. */
export function loadAllLabels(workspace: string): Record<string, string[]> {
  const labels = readMeta(workspace).labels ?? {}
  return Object.fromEntries(Object.entries(labels).map(([id, values]) => [id, [...values]]))
}

/** Remplace les étiquettes d'une note. */
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

/** Normalise des étiquettes libres : espaces compactés, doublons insensibles à la casse, max 8. */
export function normalizeLabels(labels: unknown): string[] {
  const out = (Array.isArray(labels) ? labels : [])
    .map((label) => String(label ?? "").trim().replace(/\s+/g, " ").slice(0, 40))
    .filter(Boolean)
  const seen = new Set<string>()
  return out.filter((label) => {
    const key = label.toLocaleLowerCase("fr")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, MAX_NOTE_LABELS)
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
// v12.8.0 : elle laisse aussi ses étiquettes libres ; on les oublie ensemble.
/** Oublie épinglage, tags et étiquettes d'une note supprimée définitivement. */
export function forgetNote(workspace: string, id: string): void {
  const clean = cleanNoteId(id)
  if (!clean) return
  const meta = readMeta(workspace)
  // v10.2.2 : la purge reçoit l'id de la POUBELLE (».trash/note.md»), alors que
  // l'épinglage et les tags sont indexés sur le chemin d'origine (».note.md»).
  const keys = new Set([clean, clean.replace(/^\.(?:trash|archive)\//, "")])
  const pinned = meta.pinned.filter((x) => !keys.has(x))
  const tags = { ...(meta.tags ?? {}) }
  const labels = { ...(meta.labels ?? {}) }
  let had = false
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(tags, key)) had = true
    if (Object.prototype.hasOwnProperty.call(labels, key)) had = true
    delete tags[key]
    delete labels[key]
  }
  if (pinned.length === meta.pinned.length && !had) return
  writeJsonAtomicPretty(file(workspace), { ...meta, pinned, tags, labels })
}

/**
 * Suit une note déplacée : épingles, tags et étiquettes passent de l'ancien id au
 * nouveau. Un id de destination déjà présent gagne (le déplacement crée un id unique).
 */
export function remapNoteIds(workspace: string, fromId: string, toId: string): void {
  const from = cleanNoteId(fromId)
  const to = cleanNoteId(toId)
  if (!from || !to || from === to) return
  const meta = readMeta(workspace)
  let changed = false
  const pinned = meta.pinned.map((id) => {
    if (id !== from) return id
    changed = true
    return to
  })
  const remap = (map?: Record<string, string[]>) => {
    if (!map || !Object.prototype.hasOwnProperty.call(map, from)) return map
    changed = true
    const next = { ...map, [to]: map[from] }
    delete next[from]
    return next
  }
  const tags = remap(meta.tags)
  const labels = remap(meta.labels)
  if (changed) writeJsonAtomicPretty(file(workspace), { ...meta, pinned, tags, labels })
}

/** Suit un dossier renommé : toutes les clés sous l'ancien préfixe changent. */
export function remapNotePrefix(workspace: string, fromFolder: string, toFolder: string): void {
  const from = cleanFolder(fromFolder)
  const to = cleanFolder(toFolder)
  if (!from || !to || from === to) return
  const prefix = `${from}/`
  const meta = readMeta(workspace)
  let changed = false
  const remapId = (id: string) => {
    if (!id.startsWith(prefix)) return id
    changed = true
    return `${to}/${id.slice(prefix.length)}`
  }
  const remapMap = (map?: Record<string, string[]>) => {
    if (!map) return map
    const next: Record<string, string[]> = {}
    for (const [id, values] of Object.entries(map)) next[remapId(id)] = values
    return next
  }
  const pinned = meta.pinned.map(remapId)
  const tags = remapMap(meta.tags)
  const labels = remapMap(meta.labels)
  if (changed) writeJsonAtomicPretty(file(workspace), { ...meta, pinned, tags, labels })
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

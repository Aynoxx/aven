// Notes Markdown de l'espace de travail (page « Notes » de l'interface).
// Extrait de l'ancien app-tools.ts lors du retrait du backend vocal (v8.7.7) :
// les notes restent une fonctionnalité autonome, indépendante du vocal.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const NOTE_DIR = (workspace: string) => path.join(workspace, ".opencodeapp", "notes")
/** Dossier des notes de l'espace (v9.0.0) : de vrais fichiers .md accessibles depuis le PC. */
export const notesDir = NOTE_DIR
const safeId = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || `note-${Date.now()}`
const cleanTitle = (value: string) => String(value || "Sans titre").trim().replace(/\s+/g, " ").slice(0, 120) || "Sans titre"

function ensureNoteDir(workspace: string) {
  mkdirSync(NOTE_DIR(workspace), { recursive: true })
}

function notePath(workspace: string, id: string) {
  const clean = path.basename(id)
  if (!clean || clean !== id || !clean.endsWith(".md")) throw new Error("Note invalide")
  return path.join(NOTE_DIR(workspace), clean)
}

export function listNotes(workspace: string) {
  ensureNoteDir(workspace)
  return readdirSync(NOTE_DIR(workspace)).filter((file) => file.toLowerCase().endsWith(".md")).map((id) => {
    const file = notePath(workspace, id)
    const markdown = readFileSync(file, "utf8")
    const first = markdown.match(/^#\s+(.+)$/m)
    return { id, title: cleanTitle(first?.[1] ?? id.replace(/\.md$/i, "")), markdown, updated: Math.round(statSync(file).mtimeMs) }
  }).sort((a, b) => b.id.localeCompare(a.id))
}

export function getNote(workspace: string, id: string) {
  const file = notePath(workspace, id)
  if (!existsSync(file)) throw new Error("Note introuvable")
  const markdown = readFileSync(file, "utf8")
  const first = markdown.match(/^#\s+(.+)$/m)
  return { id, title: cleanTitle(first?.[1] ?? id.replace(/\.md$/i, "")), markdown, updated: Math.round(statSync(file).mtimeMs) }
}

export { ensureNoteDir, notePath, safeId, cleanTitle }

// Notes Markdown de l'espace de travail (page « Notes » de l'interface).
// Extrait de l'ancien app-tools.ts lors du retrait du backend vocal (v8.7.7) :
// les notes restent une fonctionnalité autonome, indépendante du vocal.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
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

/**
 * Crée ou met à jour une note (v9.3.0, vue Notes intégrée) : la note est un VRAI
 * fichier .md dans l'espace. `id` vide = création (titre imposé, id dérivé du titre).
 * Retourne la note telle que listNotes la renvoie.
 */
export function saveNote(workspace: string, id: string, title: string, markdown: string) {
  ensureNoteDir(workspace)
  const cleanTitleFinal = cleanTitle(title)
  const body = String(markdown ?? "")
  // Création : id dérivé du titre, avec suffixe si collision (note-2, note-3…).
  let finalId = String(id || "").trim()
  if (!finalId) {
    const base = safeId(cleanTitleFinal)
    finalId = `${base}.md`
    let n = 2
    while (existsSync(notePath(workspace, finalId))) {
      finalId = `${base}-${n}.md`
      n++
    }
  }
  const file = notePath(workspace, finalId)
  // La 1re ligne d'un titre absent du corps est écrite comme titre Markdown.
  const hasTitle = /^#\s+/m.test(body)
  const content = hasTitle ? body : `# ${cleanTitleFinal}\n\n${body}`
  writeFileSync(file, content.endsWith("\n") ? content : `${content}\n`, "utf8")
  return getNote(workspace, finalId)
}

export { ensureNoteDir, notePath, safeId, cleanTitle }

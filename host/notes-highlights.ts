// v12.8.0 : un repère (highlight) est un passage enregistré, séparé de la note.
// Le fichier vit dans les métadonnées de l'espace, jamais dans le Markdown : la
// note reste un fichier .md lisible ailleurs, et supprimer un repère ne touche
// jamais au document source. Les identifiants de note sont des chemins relatifs ;
// au déplacement d'une note ou au renommage d'un dossier, le host les remappe
// (cf. remapHighlightNote / remapHighlightPrefix).
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { writeJsonAtomicPretty } from "./atomic-file.js"
import { cleanFolder, cleanNoteId, getNote } from "./notes.js"

export const MAX_HIGHLIGHTS = 500
export const MAX_HIGHLIGHT_QUOTE = 1200

export type NoteHighlight = {
  id: string
  noteId: string
  noteTitle: string
  folder: string
  quote: string
  createdAt: number
}

const file = (workspace: string) => path.join(workspace, ".opencode-app", "notes-highlights.json")

const folderOf = (id: string) => (id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "")

/** Un passage affichable : espaces et sauts de ligne ramenés à une ligne. */
export function cleanHighlightQuote(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_HIGHLIGHT_QUOTE)
}

function readHighlights(workspace: string): NoteHighlight[] {
  try {
    const rows = JSON.parse(readFileSync(file(workspace), "utf8")) as unknown
    if (!Array.isArray(rows)) return []
    const out: NoteHighlight[] = []
    for (const row of rows) {
      if (!row || typeof row !== "object") continue
      const value = row as Record<string, unknown>
      const noteId = cleanNoteId(value.noteId)
      const quote = cleanHighlightQuote(value.quote)
      if (!noteId || !quote || typeof value.id !== "string" || !value.id.trim()) continue
      out.push({
        id: value.id,
        noteId,
        noteTitle: typeof value.noteTitle === "string" ? value.noteTitle.slice(0, 140) : path.basename(noteId, ".md"),
        folder: typeof value.folder === "string" ? value.folder.slice(0, 220) : folderOf(noteId),
        quote,
        createdAt: typeof value.createdAt === "number" && Number.isFinite(value.createdAt) ? value.createdAt : 0,
      })
    }
    return out
  } catch {
    return []
  }
}

function writeHighlights(workspace: string, highlights: NoteHighlight[]) {
  writeJsonAtomicPretty(file(workspace), highlights)
}

/** Tous les repères, du plus récent au plus ancien. */
export function listHighlights(workspace: string): NoteHighlight[] {
  return readHighlights(workspace).sort((a, b) => b.createdAt - a.createdAt)
}

/** Enregistre un passage d'une note existante. */
export function addHighlight(workspace: string, noteId: string, quote: string): NoteHighlight {
  const rel = cleanNoteId(noteId)
  if (!rel) throw new Error("Note invalide")
  const cleanQuote = cleanHighlightQuote(quote)
  if (!cleanQuote) throw new Error("Sélection vide")
  const note = getNote(workspace, rel)
  const highlights = readHighlights(workspace)
  if (highlights.length >= MAX_HIGHLIGHTS) throw new Error(`Maximum ${MAX_HIGHLIGHTS} repères.`)
  const highlight: NoteHighlight = {
    id: randomUUID(),
    noteId: rel,
    noteTitle: note.title,
    folder: folderOf(rel),
    quote: cleanQuote,
    createdAt: Date.now(),
  }
  writeHighlights(workspace, [highlight, ...highlights])
  return highlight
}

/** Supprime le repère seul ; la note source reste intacte. */
export function deleteHighlight(workspace: string, id: string): string {
  const clean = String(id ?? "").trim()
  if (!clean) throw new Error("Repère invalide")
  const highlights = readHighlights(workspace)
  const next = highlights.filter((h) => h.id !== clean)
  if (next.length === highlights.length) throw new Error("Repère introuvable")
  writeHighlights(workspace, next)
  return clean
}

/** Suit une note déplacée (même titre, nouveau chemin). */
export function remapHighlightNote(workspace: string, fromId: string, toId: string): void {
  const from = cleanNoteId(fromId)
  const to = cleanNoteId(toId)
  if (!from || !to || from === to) return
  const highlights = readHighlights(workspace)
  let changed = false
  const next = highlights.map((highlight) => {
    if (highlight.noteId !== from) return highlight
    changed = true
    let noteTitle = highlight.noteTitle
    try { noteTitle = getNote(workspace, to).title } catch { /* la note peut être en corbeille */ }
    return { ...highlight, noteId: to, noteTitle, folder: folderOf(to) }
  })
  if (changed) writeHighlights(workspace, next)
}

/** Suit tous les repères d'un dossier renommé. */
export function remapHighlightPrefix(workspace: string, fromFolder: string, toFolder: string): void {
  const from = cleanFolder(fromFolder)
  const to = cleanFolder(toFolder)
  if (!from || !to || from === to) return
  const prefix = `${from}/`
  const highlights = readHighlights(workspace)
  let changed = false
  const next = highlights.map((highlight) => {
    if (!highlight.noteId.startsWith(prefix)) return highlight
    changed = true
    const noteId = `${to}/${highlight.noteId.slice(prefix.length)}`
    let noteTitle = highlight.noteTitle
    try { noteTitle = getNote(workspace, noteId).title } catch { /* idem */ }
    return { ...highlight, noteId, noteTitle, folder: folderOf(noteId) }
  })
  if (changed) writeHighlights(workspace, next)
}

/** Une note définitivement supprimée ne laisse pas de repères orphelins. */
export function forgetHighlightsForNote(workspace: string, noteId: string): void {
  const clean = cleanNoteId(noteId)
  if (!clean) return
  const keys = new Set([clean, clean.replace(/^\.(?:trash|archive)\//, "")])
  const highlights = readHighlights(workspace)
  const next = highlights.filter((h) => !keys.has(h.noteId) && !keys.has(h.noteId.replace(/^\.(?:trash|archive)\//, "")))
  if (next.length !== highlights.length) writeHighlights(workspace, next)
}

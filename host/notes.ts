// Notes Markdown de l'espace (v10.1.0 « façon Kortex ») : de VRAIS fichiers .md
// dans .opencodeapp/notes/, organisation par SOUS-DOSSIERS (arborescence),
// poubelle (.trash) et archive (.archive) sur disque. Les ids sont des chemins
// RELATIFS au dossier notes (« projets/idee.md ») ; la racine reste valide.
// Compat v9 : listNotes/getNote/saveNote continuent de servir (maintenant récursifs).
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import { matchQuery, normalizeForSearch } from "./notes-meta.js"

const NOTE_DIR = (workspace: string) => path.join(workspace, ".opencodeapp", "notes")
export const notesDir = NOTE_DIR
export const TRASH_DIR = ".trash"
export const ARCHIVE_DIR = ".archive"
export const INBOX_DIR = "Inbox"

const safeId = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || `note-${Date.now()}`
const cleanTitle = (value: string) => String(value || "Sans titre").trim().replace(/\s+/g, " ").slice(0, 120) || "Sans titre"

/** Normalise un chemin relatif de note/dossier : slashs, pas de « .. », pas d'absolu. null = rejeté. */
export function cleanRelPath(raw: unknown): string | null {
  const s = String(raw ?? "").trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.?\//, "").replace(/\/$/, "")
  if (!s || s.length > 220 || path.isAbsolute(s) || /^[a-zA-Z]:/.test(s)) return null
  const segs = s.split("/").filter(Boolean)
  if (!segs.length || segs.some((x) => x === "." || x === "..")) return null
  return segs.join("/")
}
/** Dossier relatif valide (« » = racine). */
export function cleanFolder(raw: unknown): string {
  return cleanRelPath(raw) ?? ""
}
/** Id de note valide : doit finir par .md et être un chemin sûr. null = rejeté. */
export function cleanNoteId(raw: unknown): string | null {
  const s = cleanRelPath(raw)
  if (!s || !s.toLowerCase().endsWith(".md")) return null
  return s
}
function absOf(workspace: string, rel: string): string {
  const base = path.resolve(NOTE_DIR(workspace))
  const abs = path.resolve(base, rel)
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error("Chemin hors du dossier notes")
  return abs
}
function ensureDir(abs: string) { mkdirSync(abs, { recursive: true }) }

const firstTitle = (markdown: string, fallback: string) => cleanTitle(markdown.match(/^#\s+(.+)$/m)?.[1] ?? fallback)
type NoteRow = { id: string; title: string; markdown: string; updated: number }

function rowOf(workspace: string, rel: string): NoteRow {
  const abs = absOf(workspace, rel)
  const markdown = readFileSync(abs, "utf8")
  return { id: rel, title: firstTitle(markdown, path.basename(rel, ".md")), markdown, updated: Math.round(statSync(abs).mtimeMs) }
}

/** Répertoire des notes (racine créée au besoin). */
export function ensureNoteDir(workspace: string) { ensureDir(NOTE_DIR(workspace)) }

/** Tous les .md hors .trash/.archive, en chemins relatifs (récursif). */
export function listNotes(workspace: string): NoteRow[] {
  ensureNoteDir(workspace)
  const out: NoteRow[] = []
  const walk = (rel: string) => {
    const abs = absOf(workspace, rel)
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue // .trash/.archive invisibles
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(childRel)
      else if (entry.name.toLowerCase().endsWith(".md")) out.push(rowOf(workspace, childRel))
    }
  }
  walk("")
  return out.sort((a, b) => b.updated - a.updated)
}

export function getNote(workspace: string, id: string) {
  const rel = cleanNoteId(id)
  if (!rel) throw new Error("Note invalide")
  const abs = absOf(workspace, rel)
  if (!existsSync(abs) || statSync(abs).isDirectory()) throw new Error("Note introuvable")
  return rowOf(workspace, rel)
}

/** Crée ou met à jour une note. `id` vide = création (id dérivé du titre dans `folder`). */
export function saveNote(workspace: string, id: string, title: string, markdown: string, folder = "") {
  ensureNoteDir(workspace)
  const cleanTitleFinal = cleanTitle(title)
  const body = String(markdown ?? "")
  const provided = String(id ?? "").trim()
  let rel = ""
  if (provided) {
    // Un id fourni mais invalide (traversée, non-.md) est une ERREUR, pas une création.
    const cleaned = cleanNoteId(provided)
    if (!cleaned) throw new Error("Note invalide")
    rel = cleaned
  }
  if (!rel) {
    const dir = cleanFolder(folder)
    const base = safeId(cleanTitleFinal)
    rel = dir ? `${dir}/${base}.md` : `${base}.md`
    let n = 2
    while (existsSync(absOf(workspace, rel))) { rel = dir ? `${dir}/${base}-${n}.md` : `${base}-${n}.md`; n++ }
  }
  const abs = absOf(workspace, rel)
  ensureDir(path.dirname(abs))
  const content = /^#\s+/m.test(body) ? body : `# ${cleanTitleFinal}\n\n${body}`
  writeFileSync(abs, content.endsWith("\n") ? content : `${content}\n`, "utf8")
  return getNote(workspace, rel)
}

// ── Dossiers ────────────────────────────────────────────────────────────────
export function createFolder(workspace: string, folder: string) {
  const rel = cleanFolder(folder)
  if (!rel) throw new Error("Nom de dossier invalide")
  ensureDir(absOf(workspace, rel))
  return rel
}

export function renameFolder(workspace: string, from: string, to: string) {
  const src = cleanFolder(from); const dst = cleanFolder(to)
  if (!src || !dst) throw new Error("Dossier invalide")
  if (absOf(workspace, src) === absOf(workspace, "")) throw new Error("La racine ne se renomme pas")
  const target = absOf(workspace, dst)
  if (existsSync(target)) throw new Error("Le dossier de destination existe déjà")
  ensureDir(path.dirname(target))
  renameSync(absOf(workspace, src), target)
  return dst
}

export function deleteFolder(workspace: string, folder: string) {
  const rel = cleanFolder(folder)
  if (!rel) throw new Error("Dossier invalide")
  const src = absOf(workspace, rel)
  if (!existsSync(src)) throw new Error("Dossier introuvable")
  const target = absOf(workspace, `${TRASH_DIR}/${rel}`)
  ensureDir(path.dirname(target))
  let n = 2
  let dest = target
  while (existsSync(dest)) { dest = `${target}-${n}`; n++ }
  renameSync(src, dest)
  return rel
}

// ── Déplacement / poubelle / archive ────────────────────────────────────────
function uniqueAbs(workspace: string, rel: string): string {
  const abs = absOf(workspace, rel)
  if (!existsSync(abs)) return abs
  const dir = path.dirname(abs); const base = path.basename(abs, path.extname(abs)); const ext = path.extname(abs)
  let n = 2
  while (existsSync(path.join(dir, `${base}-${n}${ext}`))) n++
  return path.join(dir, `${base}-${n}${ext}`)
}

/** Déplace une note vers un dossier (« » = racine). Retourne le nouvel id. */
export function moveNote(workspace: string, id: string, folder: string) {
  const rel = cleanNoteId(id); if (!rel) throw new Error("Note invalide")
  const raw = String(folder ?? "").trim()
  const dir = cleanFolder(folder)
  if (raw && !dir) throw new Error("Dossier invalide")
  const src = absOf(workspace, rel)
  if (!existsSync(src)) throw new Error("Note introuvable")
  const dest = uniqueAbs(workspace, dir ? `${dir}/${path.basename(rel)}` : path.basename(rel))
  ensureDir(path.dirname(dest))
  renameSync(src, dest)
  return path.relative(path.resolve(NOTE_DIR(workspace)), dest).split(path.sep).join("/")
}

/** Poubelle : la note part dans .trash/<chemin d'origine> (restaurable). */
export function deleteNote(workspace: string, id: string) {
  const rel = cleanNoteId(id); if (!rel) throw new Error("Note invalide")
  const src = absOf(workspace, rel)
  if (!existsSync(src)) throw new Error("Note introuvable")
  const dest = uniqueAbs(workspace, `${TRASH_DIR}/${rel}`)
  ensureDir(path.dirname(dest))
  renameSync(src, dest)
  return rel
}

/** Restaure une note de la poubelle vers son emplacement d'origine. */
export function restoreNote(workspace: string, id: string) {
  const rel = cleanNoteId(id); if (!rel) throw new Error("Note invalide")
  const src = absOf(workspace, rel)
  if (!existsSync(src)) throw new Error("Note de la poubelle introuvable")
  const original = rel.split("/").filter((s, i) => !(i < rel.split("/").length - 1 && (s === TRASH_DIR || /^\.trash-\d+$/.test(s)))) .join("/")
  // L'id de poubelle est .trash/<chemin> (avec -n sur collision) : on retire le préfixe connu.
  const parts = rel.split("/")
  const idx = parts.findIndex((p) => p === TRASH_DIR || /^\.trash-\d+$/.test(p))
  const target = idx >= 0 ? parts.slice(idx + 1).join("/") : original
  const dest = uniqueAbs(workspace, target || path.basename(rel))
  ensureDir(path.dirname(dest))
  renameSync(src, dest)
  return path.relative(path.resolve(NOTE_DIR(workspace)), dest).split(path.sep).join("/")
}

/** Notes de la poubelle (ids « .trash/... »). */
export function listTrash(workspace: string): NoteRow[] {
  ensureNoteDir(workspace)
  const trash = absOf(workspace, TRASH_DIR)
  if (!existsSync(trash)) return []
  const out: NoteRow[] = []
  const walk = (rel: string) => {
    for (const entry of readdirSync(absOf(workspace, rel), { withFileTypes: true })) {
      const childRel = `${rel}/${entry.name}`
      if (entry.isDirectory()) walk(childRel)
      else if (entry.name.toLowerCase().endsWith(".md")) out.push(rowOf(workspace, childRel))
    }
  }
  walk(TRASH_DIR)
  return out.sort((a, b) => b.updated - a.updated)
}

/** Archive : déplace vers .archive/<chemin> ; unArchive inverse. */
export function archiveNote(workspace: string, id: string) {
  const rel = cleanNoteId(id); if (!rel) throw new Error("Note invalide")
  const src = absOf(workspace, rel)
  if (!existsSync(src)) throw new Error("Note introuvable")
  const dest = uniqueAbs(workspace, `${ARCHIVE_DIR}/${rel}`)
  ensureDir(path.dirname(dest))
  renameSync(src, dest)
  return rel
}

export function unarchiveNote(workspace: string, id: string) {
  const rel = cleanNoteId(id); if (!rel) throw new Error("Note invalide")
  const src = absOf(workspace, rel)
  if (!existsSync(src)) throw new Error("Note archivée introuvable")
  const parts = rel.split("/")
  const idx = parts.findIndex((p) => p === ARCHIVE_DIR || /^\.archive-\d+$/.test(p))
  const target = idx >= 0 ? parts.slice(idx + 1).join("/") : path.basename(rel)
  const dest = uniqueAbs(workspace, target || path.basename(rel))
  ensureDir(path.dirname(dest))
  renameSync(src, dest)
  return path.relative(path.resolve(NOTE_DIR(workspace)), dest).split(path.sep).join("/")
}

/** Notes archivées (ids « .archive/... »). */
export function listArchived(workspace: string): NoteRow[] {
  ensureNoteDir(workspace)
  const arc = absOf(workspace, ARCHIVE_DIR)
  if (!existsSync(arc)) return []
  const out: NoteRow[] = []
  const walk = (rel: string) => {
    for (const entry of readdirSync(absOf(workspace, rel), { withFileTypes: true })) {
      const childRel = `${rel}/${entry.name}`
      if (entry.isDirectory()) walk(childRel)
      else if (entry.name.toLowerCase().endsWith(".md")) out.push(rowOf(workspace, childRel))
    }
  }
  walk(ARCHIVE_DIR)
  return out.sort((a, b) => b.updated - a.updated)
}

/** Suppression définitive (poubelle vidée). */
export function purgeNote(workspace: string, id: string) {
  const rel = cleanNoteId(id); if (!rel) throw new Error("Note invalide")
  const abs = absOf(workspace, rel)
  if (!existsSync(abs)) throw new Error("Note introuvable")
  unlinkSync(abs)
  return rel
}

export type NoteTreeEntry =
  | { type: "folder"; id: string; name: string; children: NoteTreeEntry[] }
  | { type: "note"; id: string; name: string; title: string; updated: number }

/** Arbre dossiers/notes façon Kortex (dossiers pliés/repliables côté UI). */
export function notesTree(workspace: string): NoteTreeEntry[] {
  const folders = new Map<string, NoteTreeEntry & { type: "folder" }>()
  folders.set("", { type: "folder", id: "", name: "", children: [] })
  const ensureFolder = (rel: string): NoteTreeEntry & { type: "folder" } => {
    if (folders.has(rel)) return folders.get(rel)!
    const parentRel = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ""
    const parent = ensureFolder(parentRel)
    const node = { type: "folder" as const, id: rel, name: path.basename(rel), children: [] as NoteTreeEntry[] }
    folders.set(rel, node)
    parent.children.push(node)
    return node
  }
  for (const note of listNotes(workspace)) {
    const parentRel = note.id.includes("/") ? note.id.slice(0, note.id.lastIndexOf("/")) : ""
    ensureFolder(parentRel).children.push({ type: "note", id: note.id, name: path.basename(note.id), title: note.title, updated: note.updated })
  }
  const sortRec = (nodes: NoteTreeEntry[]) => {
    nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, "fr") : a.type === "folder" ? -1 : 1))
    for (const n of nodes) if (n.type === "folder") sortRec(n.children)
  }
  const root = folders.get("")!
  sortRec(root.children)
  return root.children
}

// ── Liens façon Kortex : [[titre]] dans le markdown ────────────────────────────
const WIKILINK = /\[\[([^\[\]\n]{1,120})\]\]/g

/** Résolution d'une cible [[...]] : id exact, nom de fichier sans .md, puis titre. */
export function resolveWikilink(workspace: string, target: string): string | null {
  const clean = String(target ?? "").trim()
  if (!clean) return null
  const notes = listNotes(workspace)
  const direct = cleanNoteId(clean.includes(".") ? clean : `${clean}.md`)
  if (direct && notes.some((n) => n.id === direct)) return direct
  const lowered = clean.toLowerCase()
  const byFile = notes.find((n) => path.basename(n.id).toLowerCase() === `${lowered}.md` || path.basename(n.id).toLowerCase() === lowered)
  if (byFile) return byFile.id
  const byTitle = notes.find((n) => n.title.toLowerCase() === lowered)
  return byTitle?.id ?? null
}

/** Liens sortants d'une note (ids résolus + cibles orphelines). */
export function noteLinks(workspace: string, id: string): { target: string; resolved: string | null }[] {
  const rel = cleanNoteId(id); if (!rel) throw new Error("Note invalide")
  const markdown = getNote(workspace, rel).markdown
  const out: { target: string; resolved: string | null }[] = []
  const seen = new Set<string>()
  for (const m of markdown.matchAll(WIKILINK)) {
    const target = m[1].trim()
    if (!target || seen.has(target)) continue
    seen.add(target)
    out.push({ target, resolved: resolveWikilink(workspace, target) })
  }
  return out
}

/** Backlinks : notes pointant vers la note donnée (clic → navigation). */
export function backlinks(workspace: string, id: string): string[] {
  const rel = cleanNoteId(id); if (!rel) throw new Error("Note invalide")
  const title = getNote(workspace, rel).title.toLowerCase()
  const base = path.basename(rel).toLowerCase().replace(/\.md$/, "")
  const relNoExt = rel.toLowerCase().replace(/\.md$/, "")
  return listNotes(workspace)
    .filter((n) => n.id !== rel)
    .filter((n) => {
      for (const m of n.markdown.matchAll(WIKILINK)) {
        const t = m[1].trim().toLowerCase()
        if (t === rel.toLowerCase() || t === relNoExt || t === base || t === title) return true
      }
      return false
    })
    .map((n) => n.id)
}

// ── Recherche globale (titre + corps) ───────────────────────────────────────
export function searchNotes(workspace: string, query: string): { id: string; title: string; snippet: string }[] {
  const q = normalizeForSearch(query)
  if (!q) return []
  return listNotes(workspace)
    .filter((n) => matchQuery(normalizeForSearch(`${n.title} ${n.markdown}`), q))
    .slice(0, 50)
    .map((n) => {
      const norm = normalizeForSearch(n.markdown)
      const at = norm.indexOf(q.split(/\s+/)[0])
      const snippet = at >= 0 ? n.markdown.slice(Math.max(0, at - 40), at + 90).replace(/\s+/g, " ").trim() : n.title
      return { id: n.id, title: n.title, snippet }
    })
}

// ── Quick capture (raccourci global → Inbox/) ───────────────────────────────
/** Capture rapide : crée une note datée dans Inbox/. */
export function quickCapture(workspace: string, title: string, markdown: string) {
  const folder = createFolder(workspace, INBOX_DIR)
  const clean = String(title ?? "").trim()
  const stamp = new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })
  return saveNote(workspace, "", clean || `Capture ${stamp}`, String(markdown ?? ""), folder)
}

export { safeId, cleanTitle }

import { app } from "electron"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { writeJsonAtomic } from "./atomic-file.js"

export type WorkspaceEntry = { path: string; name: string }
type Stored = { list: WorkspaceEntry[]; active?: string }

function registryFile() {
  return path.join(app.getPath("userData"), "workspaces.json")
}

function defaultWorkspace(): WorkspaceEntry {
  return { path: path.join(app.getPath("documents"), "Aven-workspace"), name: "Par défaut" }
}

function read(): Stored {
  try {
    const st = JSON.parse(readFileSync(registryFile(), "utf8")) as Stored
    if (st.list?.length) return st
  } catch {
    /* première utilisation, ou fichier absent */
  }
  return { list: [defaultWorkspace()] }
}

function write(st: Stored) {
  mkdirSync(app.getPath("userData"), { recursive: true })
  writeJsonAtomic(registryFile(), st)
}

export function listWorkspaces(): WorkspaceEntry[] {
  return read().list
}

/** Espace actif : celui enregistré, sinon le premier connu (toujours au moins l'espace par défaut). */
export function activeWorkspace(): WorkspaceEntry {
  const st = read()
  return st.list.find((w) => w.path === st.active) ?? st.list[0]
}

export function setActiveWorkspace(dir: string) {
  const st = read()
  const entry = st.list.find((w) => w.path === dir)
  if (!entry) throw new Error(`Espace de travail inconnu : ${dir}`)
  if (!existsSync(dir)) throw new Error(`Le dossier de travail n’existe plus : ${dir}`)
  write({ ...st, active: dir })
}

export function validateWorkspacePath(dir: string): string {
  const clean = path.resolve(String(dir || ""))
  const st = read()
  if (!st.list.some((w) => path.resolve(w.path) === clean)) throw new Error("Espace de travail non autorisé.")
  if (!existsSync(clean)) throw new Error("Le dossier de travail n’existe plus.")
  return clean
}

/** Ajoute un dossier existant (ou déjà créé) à la liste des espaces connus, sans le rendre actif. */
export function registerWorkspace(dir: string, name: string): WorkspaceEntry {
  const st = read()
  const clean = path.resolve(dir)
  const entry = { path: clean, name: name.trim() || path.basename(clean) }
  const next = st.list.some((w) => path.resolve(w.path) === clean)
    ? st.list.map((w) => (path.resolve(w.path) === clean ? entry : w))
    : [...st.list, entry]
  write({ ...st, list: next })
  return entry
}

export function removeWorkspace(dir: string) {
  const st = read()
  const list = st.list.filter((w) => w.path !== dir)
  if (!list.length) list.push(defaultWorkspace()) // toujours garder au moins un espace
  write({ list, active: st.active === dir ? undefined : st.active })
}

export function ensureDefaultRegistered() {
  const st = read()
  if (!existsSync(registryFile())) write(st) // matérialise le registre dès le premier lancement
}

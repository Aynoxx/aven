import { app } from "electron"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { writeJsonAtomic } from "./atomic-file.js"

export type WorkspaceEntry = { path: string; name: string }
type Stored = { list: WorkspaceEntry[]; active?: string }

function registryFile() {
  return path.join(app.getPath("userData"), "workspaces.json")
}

// v9.1.5 : plus AUCUN espace imposé. Un registre absent ou vide signifie « l'utilisateur
// n'a pas encore choisi son espace » — l'app démarre sur un écran de choix au lieu de
// créer en douce un dossier « Aven-workspace » dans Documents.
function read(): Stored {
  try {
    const st = JSON.parse(readFileSync(registryFile(), "utf8")) as Stored
    return { list: Array.isArray(st.list) ? st.list : [], active: st.active }
  } catch {
    /* première utilisation, ou fichier absent */
  }
  return { list: [] }
}

function write(st: Stored) {
  mkdirSync(app.getPath("userData"), { recursive: true })
  writeJsonAtomic(registryFile(), st)
}

export function listWorkspaces(): WorkspaceEntry[] {
  return read().list
}

/** Espace actif : UNIQUEMENT celui enregistré explicitement ; null tant qu'aucun choix n'a été fait.
 *  (v9.1.6) Le repli historique « premier connu » était un projet par défaut déguisé : le boot
 *  démarrait dessus sans que l'utilisateur n'ait jamais rien choisi. Désormais, un registre
 *  sans « active » (ou pointant un espace retiré) signifie « à choisir » — l'écran de choix
 *  s'affiche, avec la liste des espaces déjà connus proposés au clic. */
export function activeWorkspace(): WorkspaceEntry | null {
  const st = read()
  return st.list.find((w) => w.path === st.active) ?? null
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

// v9.1.5 : retirer le dernier espace est permis — l'app repasse alors sur l'écran de choix.
export function removeWorkspace(dir: string) {
  const st = read()
  const list = st.list.filter((w) => w.path !== dir)
  write({ list, active: st.active === dir ? undefined : st.active })
}

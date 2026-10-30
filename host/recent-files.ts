// Historique des fichiers OUVERTS dans Aven (v12.3.0).
// Pourquoi ce module existe : l'accueil propose « Reprendre » et le brief veut un
// dernier document réel. Aven ne gardait aucune trace d'ouverture — afficher un
// fichier « récent » alors qu'aucun n'a été ouvert serait un historique inventé.
// On enregistre donc les ouvertures, par espace, dans ses métadonnées.
//
// Pur : la décision (dédoublonnage, ordre, borne) est testable avec Node seul ;
// seule la lecture/écriture du fichier touche au disque, et toujours atomiquement.
import { readFileSync } from "node:fs"
import path from "node:path"
import { writeJsonAtomicPretty } from "./atomic-file.js"

/** Huit entrées : de quoi survivre à quelques ouvertures sans devenir un journal. */
export const MAX_RECENT_FILES = 8

export type RecentFile = {
  /** Chemin relatif à la racine de l'espace, séparateurs « / ». */
  path: string
  /** Dernier segment du chemin, pour l'affichage. */
  name: string
  /** Instant d'ouverture (epoch ms). */
  opened: number
}

const storeFile = (workspace: string) => path.join(workspace, ".opencode-app", "recent-files.json")

/** Un chemin d'espace est TOUJOURS relatif : ni lecteur, ni racine, ni « .. ». */
export function cleanRelativePath(value: unknown): string {
  const clean = String(value ?? "").replace(/\\/g, "/").trim()
  if (!clean || clean.startsWith("/") || /^[a-zA-Z]:/.test(clean)) return ""
  const segments = clean.split("/").filter(Boolean)
  if (segments.some((segment) => segment === "..")) return ""
  return segments.join("/")
}

/**
 * Nouvelle liste après l'ouverture d'un fichier : l'entrée remonte en tête, les
 * doublons disparaissent (un même fichier n'occupe qu'une ligne), la borne est
 * respectée. Un chemin invalide ne modifie rien — on ne journalise pas n'importe quoi.
 */
export function rememberFile(list: RecentFile[], entry: { path: unknown; name?: unknown }, at: number, limit = MAX_RECENT_FILES): RecentFile[] {
  const clean = cleanRelativePath(entry?.path)
  if (!clean) return list
  const name = String(entry?.name ?? "").trim().slice(0, 200) || clean.split("/").pop() || clean
  const opened = Number.isFinite(at) && at > 0 ? Math.round(at) : Date.now()
  const next: RecentFile = { path: clean, name, opened }
  return [next, ...list.filter((file) => file.path !== clean)].slice(0, Math.max(1, Math.floor(limit)))
}

/** Relit un fichier de métadonnées : tout ce qui n'est pas un chemin valide est écarté. */
export function parseRecentFiles(raw: unknown, limit = MAX_RECENT_FILES): RecentFile[] {
  const files = (raw as { files?: unknown })?.files
  if (!Array.isArray(files)) return []
  const out: RecentFile[] = []
  for (const item of files) {
    const clean = cleanRelativePath((item as RecentFile)?.path)
    if (!clean || out.some((file) => file.path === clean)) continue
    const name = String((item as RecentFile)?.name ?? "").trim().slice(0, 200) || clean.split("/").pop() || clean
    const opened = Number((item as RecentFile)?.opened)
    out.push({ path: clean, name, opened: Number.isFinite(opened) && opened > 0 ? Math.round(opened) : 0 })
  }
  return out.slice(0, Math.max(1, Math.floor(limit)))
}

/** Les fichiers ouverts dans cet espace, du plus récent au plus ancien. */
export function loadRecentFiles(workspace: string): RecentFile[] {
  try {
    return parseRecentFiles(JSON.parse(readFileSync(storeFile(workspace), "utf8")))
  } catch {
    return []
  }
}

/** Enregistre une ouverture et rend la liste à jour (écriture atomique). */
export function rememberWorkspaceFile(workspace: string, relative: unknown, at = Date.now()): RecentFile[] {
  const list = rememberFile(loadRecentFiles(workspace), { path: relative }, at)
  writeJsonAtomicPretty(storeFile(workspace), { files: list })
  return list
}

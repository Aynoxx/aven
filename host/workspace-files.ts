// Explorateur de fichiers de l'espace de travail (v9.3.0) — lecture seule.
// Sans dépendance à Electron : testable avec Node seul (RULES.md §8).
// Toute résolution de chemin passe par safeResolve() : le module ne peut JAMAIS
// lire ni lister hors de la racine de l'espace (traversée « .. », chemins absolus,
// racines Windows), quel que soit l'appelant.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

/** Taille maximale d'un fichier texte lisible dans l'aperçu (512 Kio). */
export const MAX_TEXT_BYTES = 512 * 1024

export type WorkspaceFileEntry = {
  name: string
  path: string // chemin relatif à la racine de l'espace (séparateurs « / »)
  kind: "dir" | "file"
  size: number // octets (fichiers)
  modified: number // epoch ms
}

export type WorkspaceTextFile = {
  path: string
  size: number
  truncated: boolean // true si le fichier dépasse MAX_TEXT_BYTES (contenu coupé)
  content: string
}

// Répertoires jamais exposés dans l'explorateur (config interne du moteur, données d'app).
const HIDDEN_ROOTS = new Set([".git", "node_modules", ".opencode", ".opencode-app", ".opencodeapp"])

/**
 * Résout un chemin RELATIF à la racine et garantit que le résultat reste DEDANS.
 * Rejette : chemin absolu, préfixe de lecteur, traversée par « .. », chemin vide.
 * Le test final est path.relative(root, resolved) — la seule vérité, indépendante
 * des séparateurs et des alias.
 */
export function safeResolve(root: string, relative: string): string {
  if (!root) throw new Error("Aucun espace de travail actif.")
  const clean = String(relative ?? "").replace(/\\/g, "/").trim()
  if (!clean || clean === ".") return path.resolve(root)
  if (path.isAbsolute(clean) || /^[a-zA-Z]:/.test(clean)) throw new Error("Chemin absolu refusé.")
  const segments = clean.split("/").filter((s) => s.length > 0)
  if (segments.some((s) => s === "..")) throw new Error("Traversée de dossier refusée.")
  const resolved = path.resolve(root, ...segments)
  const rel = path.relative(path.resolve(root), resolved)
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Chemin hors de l'espace de travail refusé.")
  return resolved
}

/** Détection binaire rapide : octet NUL dans les 8 premiers Kio = binaire. */
export function looksBinary(buffer: Buffer): boolean {
  const probe = buffer.subarray(0, 8192)
  return probe.includes(0)
}

/** Liste le contenu d'un dossier de l'espace (tri : dossiers puis noms). */
export function listWorkspaceDir(root: string, relative: string): WorkspaceFileEntry[] {
  const dir = safeResolve(root, relative)
  if (!existsSync(dir)) throw new Error("Dossier introuvable dans l'espace de travail.")
  const entries: WorkspaceFileEntry[] = []
  for (const name of readdirSync(dir)) {
    if (relative === "" && HIDDEN_ROOTS.has(name)) continue
    const full = path.join(dir, name)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(full)
    } catch {
      continue // fichier disparu entre readdir et stat : ignoré
    }
    entries.push({
      name,
      path: relative ? `${relative.replace(/\/+$/, "")}/${name}` : name,
      kind: st.isDirectory() ? "dir" : "file",
      size: st.isFile() ? st.size : 0,
      modified: Math.round(st.mtimeMs),
    })
  }
  return entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, "fr", { sensitivity: "base" }) : a.kind === "dir" ? -1 : 1))
}

/** Lit un fichier texte de l'espace (borné, binaire refusé avec message clair). */
export function readWorkspaceFile(root: string, relative: string): WorkspaceTextFile {
  const file = safeResolve(root, relative)
  const st = statSync(file)
  if (st.isDirectory()) throw new Error("C'est un dossier, pas un fichier.")
  if (st.size > MAX_TEXT_BYTES * 4) throw new Error("Fichier trop volumineux pour l'aperçu (limite : 2 Mio).")
  const buffer = readFileSync(file)
  if (looksBinary(buffer)) throw new Error("Fichier binaire : l'aperçu texte est indisponible.")
  const truncated = buffer.length > MAX_TEXT_BYTES
  return {
    path: String(relative ?? "").replace(/\\/g, "/"),
    size: st.size,
    truncated,
    content: buffer.subarray(0, MAX_TEXT_BYTES).toString("utf8"),
  }
}

/** Fil d'ariane : découpe un chemin relatif en segments { label, path }. */
export function breadcrumbOf(relative: string): { label: string; path: string }[] {
  const clean = String(relative ?? "").replace(/\\/g, "/").split("/").filter((s) => s.length > 0 && s !== ".")
  const crumbs = [{ label: "Espace", path: "" }]
  let acc = ""
  for (const segment of clean) {
    acc = acc ? `${acc}/${segment}` : segment
    crumbs.push({ label: segment, path: acc })
  }
  return crumbs
}

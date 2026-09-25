import { copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"

/** Écriture résistante aux arrêts brutaux : fichier temporaire puis remplacement. */
export function writeTextAtomic(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`
  writeFileSync(temp, content, "utf8")
  try {
    renameSync(temp, file)
  } catch (error) {
    // Windows peut refuser le remplacement d'un fichier existant selon le FS.
    // On conserve le mode de secours avec copie + suppression du temporaire.
    if (!existsSync(file)) throw error
    copyFileSync(temp, file)
    unlinkSync(temp)
  }
}

export function writeJsonAtomic(file: string, value: unknown) {
  writeTextAtomic(file, JSON.stringify(value))
}

export function writeJsonAtomicPretty(file: string, value: unknown) {
  writeTextAtomic(file, JSON.stringify(value, null, 2))
}

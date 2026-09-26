// Préférences utilisateur (v9.1.0) : interrupteur des notifications de bureau.
// Fichier `prefs.json` dans userData (même convention que settings.json), chiffré
// inutile : aucune donnée sensible ici.
import { app } from "electron"
import { mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { writeJsonAtomic } from "./atomic-file.js"

const file = () => path.join(app.getPath("userData"), "prefs.json")

export type Prefs = { notifications: boolean }

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(readFileSync(file(), "utf8")) as Partial<Prefs>
    return { notifications: raw.notifications !== false } // défaut : activé
  } catch {
    return { notifications: true }
  }
}

export function saveNotifications(notifications: boolean): Prefs {
  const next: Prefs = { ...loadPrefs(), notifications }
  mkdirSync(app.getPath("userData"), { recursive: true })
  writeJsonAtomic(file(), next)
  return next
}

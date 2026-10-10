// Préférences utilisateur (v9.1.0) : interrupteur des notifications de bureau.
// Fichier `prefs.json` dans userData (même convention que settings.json), chiffré
// inutile : aucune donnée sensible ici.
import { mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { writeJsonAtomic } from "./atomic-file.js"

// v10.0.0 : plus d'Electron — dossier utilisateur selon la convention du host
// (AVEN_USER_DATA_DIR, sinon %APPDATA%\Aven), identique à aven-app-host.ts.
const userDataDir = () => process.env.AVEN_USER_DATA_DIR || path.join(process.env.APPDATA || process.cwd(), "Aven")
const file = () => path.join(userDataDir(), "prefs.json")

export type Prefs = { notifications: boolean; freebuffResume?: boolean }

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(readFileSync(file(), "utf8")) as Partial<Prefs>
    return { notifications: raw.notifications !== false, freebuffResume: raw.freebuffResume === true } // défaut : nouvelle conversation
  } catch {
    return { notifications: true, freebuffResume: false }
  }
}

// (v9.5.0) L'agent Freebuff reprend-il sa dernière conversation au lieu d'en ouvrir une
// neuve ? Désactivé par défaut (le réflexe « je repars de zéro » reste le cas courant).
export function saveFreebuffResume(freebuffResume: boolean): Prefs {
  const next: Prefs = { ...loadPrefs(), freebuffResume }
  mkdirSync(userDataDir(), { recursive: true })
  writeJsonAtomic(file(), next)
  return next
}

export function saveNotifications(notifications: boolean): Prefs {
  const next: Prefs = { ...loadPrefs(), notifications }
  mkdirSync(userDataDir(), { recursive: true })
  writeJsonAtomic(file(), next)
  return next
}

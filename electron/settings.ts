import { app, safeStorage } from "electron"
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { PROVIDERS } from "./providers.js"
import { mergeNewModels, prunePaidModels, syncTrackedFiles, type FileSyncResult } from "./workspace-sync.js"
import { writeJsonAtomic } from "./atomic-file.js"

const settingsFile = () => path.join(app.getPath("userData"), "settings.json")

type Stored = { keysEnc?: Record<string, string>; openrouterKeyEnc?: string }

function readStored(): Stored {
  try {
    return JSON.parse(readFileSync(settingsFile(), "utf8")) as Stored
  } catch {
    return {}
  }
}

const decrypt = (enc?: string) => {
  if (!enc || !safeStorage.isEncryptionAvailable()) return undefined
  try {
    return safeStorage.decryptString(Buffer.from(enc, "base64"))
  } catch {
    return undefined
  }
}

/** Clés par fournisseur : celles enregistrées dans l'app (chiffrées par le système), sinon les variables d'environnement. */
export function loadKeys(): Record<string, string> {
  const st = readStored()
  const out: Record<string, string> = {}
  for (const p of PROVIDERS) {
    const legacy = p.id === "openrouter" ? st.openrouterKeyEnc : undefined // ancien format (v3.x)
    const v = decrypt(st.keysEnc?.[p.id] ?? legacy) || process.env[p.env]
    if (v) out[p.id] = v
  }
  return out
}

export function saveKey(provider: string, key: string) {
  if (!PROVIDERS.some((p) => p.id === provider)) throw new Error(`Fournisseur inconnu : ${provider}`)
  const clean = key.trim()
  if (clean && !safeStorage.isEncryptionAvailable()) {
    throw new Error("Le chiffrement du système est indisponible : utilise plutôt une variable d'environnement.")
  }
  const st = readStored()
  const keysEnc = { ...(st.keysEnc ?? {}) }
  if (clean) keysEnc[provider] = safeStorage.encryptString(clean).toString("base64")
  else delete keysEnc[provider]
  const next: Stored = { keysEnc }
  if (provider !== "openrouter" && st.openrouterKeyEnc && !keysEnc.openrouter) next.openrouterKeyEnc = st.openrouterKeyEnc
  mkdirSync(app.getPath("userData"), { recursive: true })
  writeJsonAtomic(settingsFile(), next)
}

const TRACKED = [
  "opencode.jsonc",
  "model-priorities.json",
  path.join(".opencode", "plugins", "aven-tool-guard.js"),
  path.join(".opencode", "plugins", "README.md"),
]

/**
 * Les agents sont découverts DANS LE GABARIT de l'app au lieu d'être listés en dur :
 * un agent ajouté dans une nouvelle version (ex. « projet » en v9.0.0) est ainsi
 * propagé aux espaces de travail existants au démarrage suivant. La liste statique
 * avait oublié « projet.md » : les espaces créés avant la v9.0.0 n'avaient pas
 * l'agent, et l'app refusait de démarrer (« Agents introuvables après 90s »).
 * (v9.0.1) Testable sans Electron : le gabarit est un paramètre.
 */
export function trackedAgentFiles(templateDir: string): string[] {
  const agentsDir = path.join(templateDir, ".opencode", "agents")
  if (!existsSync(agentsDir)) return []
  return readdirSync(agentsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.join(".opencode", "agents", f))
}

/**
 * Prépare un dossier de travail (le crée s'il n'existe pas encore) : copie la config et les
 * agents au premier lancement ; aux lancements suivants, met à jour automatiquement les
 * fichiers que tu n'as jamais modifiés, et n'écrase jamais ceux que tu as personnalisés
 * (voir workspace-sync.ts). Ajoute aussi les nouveaux modèles livrés avec l'app dans
 * model-priorities.json, sans toucher à tes priorités existantes.
 */
export function seedWorkspace(dir: string, templateDir: string): { sync: FileSyncResult[]; newModels: string[]; removedModels: string[] } {
  mkdirSync(path.join(dir, ".opencode", "agents"), { recursive: true })
  // Dédoublonnage : les agents découverts remplacent toute entrée statique de même nom.
  const tracked = [...new Set([...TRACKED, ...trackedAgentFiles(templateDir)])]
  const sync = syncTrackedFiles(dir, templateDir, tracked)
  const removedModels = prunePaidModels(dir)
  const newModels = mergeNewModels(dir, templateDir)
  return { sync, newModels, removedModels }
}

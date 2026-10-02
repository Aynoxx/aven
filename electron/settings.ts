import { app, safeStorage } from "electron"
import { mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { PROVIDERS } from "./providers.js"
import { writeJsonAtomic } from "./atomic-file.js"

// v10.0.0 (parité native) : le seed d'espace (TRACKED, trackedAgentFiles,
// seedWorkspace) vit désormais dans workspace-seed.ts — module pur bundlé DANS
// le host moteur pour que l'Electron et l'app WinUI partagent le MÊME code.
// settings.ts garde la ré-exportation du contrat historique (main.ts, tests).
export { trackedAgentFiles, seedWorkspace } from "./workspace-seed.js"

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



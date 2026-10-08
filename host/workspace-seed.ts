import { existsSync, mkdirSync, readdirSync } from "node:fs"
import path from "node:path"
import { mergeNewModels, prunePaidModels, syncTrackedFiles, type FileSyncResult } from "./workspace-sync.js"

// v10.0.0 : ce module sort de settings.ts (couplé à l'ancien shell Electron) pour
// être bundlé DANS le host moteur (aven-engine-host.mjs, méthode "workspace.seed") :
// une seule implémentation du seed, partout. Aucune dépendance
// Tauri/Electron : testable avec Node seul (tests/agent-sync.test.mjs).

export const TRACKED = [
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

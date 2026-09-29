import { readFileSync } from "node:fs"
import path from "node:path"

// Noms AFFICHÉS des agents (onglets), persistés dans l'espace de travail. Sans dépendance
// à Electron : testable avec Node seul. v9.7.1 : setName a disparu (le renommage d'agents
// a quitté l'UI en v9.6.0) — les noms déjà enregistrés restent lus et affichés, et le
// fichier existant n'est jamais supprimé (un ancien build peut encore écrire dedans).
const file = (workspace: string) => path.join(workspace, ".opencode-app", "agent-names.json")

export function loadNames(workspace: string): Record<string, string> {
  try {
    const raw = JSON.parse(readFileSync(file(workspace), "utf8")) as Record<string, unknown>
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string" && v.trim())) as Record<string, string>
  } catch {
    return {}
  }
}

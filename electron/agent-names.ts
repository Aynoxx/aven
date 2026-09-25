import { mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { writeJsonAtomicPretty } from "./atomic-file.js"

// Noms AFFICHÉS des agents (onglets). Sans dépendance à Electron : testable avec Node seul.
// Seul le nom affiché change : l'identifiant (code, recherche, analyse), le fichier .opencode/agents/*.md,
// le routage des modèles et model-priorities.json restent inchangés.
export const MAX_AGENT_NAME = 30

const file = (workspace: string) => path.join(workspace, ".opencode-app", "agent-names.json")

export function loadNames(workspace: string): Record<string, string> {
  try {
    const raw = JSON.parse(readFileSync(file(workspace), "utf8")) as Record<string, unknown>
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string" && v.trim())) as Record<string, string>
  } catch {
    return {}
  }
}

/** Nom vide = retour au nom d'origine. */
export function setName(workspace: string, id: string, name: string) {
  const names = loadNames(workspace)
  const clean = name.trim().slice(0, MAX_AGENT_NAME)
  if (clean) names[id] = clean
  else delete names[id]
  mkdirSync(path.dirname(file(workspace)), { recursive: true })
  writeJsonAtomicPretty(file(workspace), names)
}

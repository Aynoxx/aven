import type { Agent } from "../types"

// v10.4.0 : constantes et helpers partagés par le shell, le contrôleur et les pages —
// App.tsx ne porte plus de valeurs métier.

// Durée d'affichage d'un avis du hub (v9.1.4) : le bandeau s'efface tout seul au lieu de
// recouvrir l'interface indéfiniment.
export const HOME_NOTICE_TTL = 6_000
// Message exact affiché quand le CLI Freebuff est absent : le bandeau du hub reconnaît
// ce texte pour proposer le bouton « Installer » en direct.
export const FREEBUFF_MISSING_NOTICE = "Le CLI Freebuff n'est pas installé : Paramètres → Freebuff CLI gratuit → « Installer le CLI (npm) »."

export type Notice = { id: string; text: string }

export function orderAgents(agents: Agent[], order: string[]) {
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  const ordered = order.map((id) => byId.get(id)).filter((agent): agent is Agent => Boolean(agent))
  const missing = agents.filter((agent) => !order.includes(agent.id))
  return [...ordered, ...missing]
}

// v9.4.0 : orientation rapide — chaque besoin courant pointe vers le bon assistant.
// v9.6.0 : la page Tâches = un agent principal (orchestrateur « projet ») et des modes.
// « Tâche complexe » ouvre l’orchestrateur lui-même : il délègue aux trois autres via subagents.
// v10.1.0 : la page Tâches = UNE carte orchestrateur avec switch de mode.
// Auto : l'orchestrateur choisit le meilleur sous-agent pour chaque tâche.
// Mode manuel : délégation imposée au spécialiste choisi (instruction de session,
// host/task-mode.ts — appliquée à chaque envoi sur les conversations « projet »).
export const TASK_MODES_UI = [
  { id: "auto", icon: "agent", label: "Auto", hint: "L'orchestrateur choisit le meilleur sous-agent pour chaque tâche." },
  { id: "code", icon: "wrench", label: "Code", hint: "Délégation imposée au spécialiste code (l'orchestrateur coordonne et synthétise)." },
  { id: "analyse", icon: "sparkle", label: "Analyse", hint: "Délégation imposée au spécialiste analyse (l'orchestrateur coordonne et synthétise)." },
  { id: "recherche", icon: "search", label: "Recherche", hint: "Délégation imposée au spécialiste recherche (l'orchestrateur coordonne et synthétise)." },
] as const

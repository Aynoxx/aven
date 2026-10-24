import type { Agent } from "../types"

// v10.4.0 : constantes et helpers partagés par le shell, le contrôleur et les pages —
// App.tsx ne porte plus de valeurs métier.

// Durée d'affichage d'un avis du hub (v9.1.4) : le bandeau s'efface tout seul au lieu de
// recouvrir l'interface indéfiniment.
export const HOME_NOTICE_TTL = 6_000
// Message exact affiché quand le CLI Freebuff est absent : le bandeau du hub reconnaît
// ce texte pour proposer le bouton « Installer » en direct.
// v11.0.0 : la section s'appelle « Terminal Freebuff » dans les Réglages — le bandeau
// citait une destination qui n'existe plus (AGENTS.md §6, libellés fonctionnels).
export const FREEBUFF_MISSING_NOTICE = "Le CLI Freebuff n'est pas installé : Réglages → Terminal Freebuff → « Installer le CLI (npm) »."

// v11.0.1 : l'inspecteur affichait l'état brut du moteur (« ready ») en anglais, alors
// que le bandeau disait « EN LIGNE ». Une seule table de libellés pour les deux.
export function engineStatusLabel(status: string): string {
  if (status === "ready") return "en ligne"
  if (status === "starting") return "démarrage"
  if (status === "error") return "erreur"
  return status
}

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
  // v11.0.2 : un mode de délégation porte l'outil du spécialiste (graphique pour
  // l'analyse), pas l'étoile de la marque.
  { id: "analyse", icon: "chart", label: "Analyse", hint: "Délégation imposée au spécialiste analyse (l'orchestrateur coordonne et synthétise)." },
  { id: "recherche", icon: "search", label: "Recherche", hint: "Délégation imposée au spécialiste recherche (l'orchestrateur coordonne et synthétise)." },
] as const

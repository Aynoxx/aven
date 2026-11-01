import type { AgentPhase } from "../agent/sphere"
import type { AppState } from "../types"

// Pur : testable avec Node seul, sans dépendance desktop.
// v12.7.4 : `starting` ne couvre que le démarrage ; un Poste prêt sans espace
// reste `muted`, et une erreur garde `error` — sinon la sphère prétend démarrer
// après un échec.
export function agentPhaseFor(
  status: AppState["status"],
  needsWorkspace: boolean | undefined,
  voicePhase: AgentPhase,
): AgentPhase {
  if (status === "starting") return "starting"
  if (status === "error") return "error"
  if (needsWorkspace) return "muted"
  return voicePhase
}

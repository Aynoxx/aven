// v10.1.0 : mode de tâche de l'orchestrateur « projet ».
// La page Tâches affiche UNE carte orchestrateur ; le switch Auto / Code / Analyse /
// Recherche décide qui exécute : en « auto » l'orchestrateur choisit librement le
// meilleur sous-agent pour chaque tâche ; en mode manuel il reçoit l'instruction de
// DÉLÉGUER systématiquement l'exécution au sous-agent du mode choisi (il garde le
// contexte, la coordination et la synthèse).
// Le mode est persisté par espace (.opencode-app/task-mode.json) et appliqué aux
// sessions « projet » via l'instruction de session OpenCode (instructions.entry.put,
// clé TASK_MODE_INSTRUCTION_KEY). Logique pure : testable avec Node seul.
import { readFileSync } from "node:fs"
import path from "node:path"
import { writeJsonAtomicPretty } from "./atomic-file.js"

export type TaskMode = "auto" | "code" | "analyse" | "recherche"
export const TASK_MODES = ["auto", "code", "analyse", "recherche"] as const
export const DEFAULT_TASK_MODE: TaskMode = "auto"

/** Clé d'instruction de session OpenCode (JsonValue) portant le mode sur une session. */
export const TASK_MODE_INSTRUCTION_KEY = "aven.task-mode"

const file = (workspace: string) => path.join(workspace, ".opencode-app", "task-mode.json")

export function isTaskMode(value: unknown): value is TaskMode {
  return typeof value === "string" && (TASK_MODES as readonly string[]).includes(value)
}

/** Mode persisté de l'espace (défaut : auto — l'orchestrateur choisit lui-même). */
export function loadTaskMode(workspace: string): TaskMode {
  try {
    const raw = JSON.parse(readFileSync(file(workspace), "utf8")) as { mode?: unknown }
    return isTaskMode(raw.mode) ? raw.mode : DEFAULT_TASK_MODE
  } catch {
    return DEFAULT_TASK_MODE
  }
}

/** Persiste le mode de l'espace. Mode invalide = remise à « auto ». */
export function saveTaskMode(workspace: string, mode: unknown): TaskMode {
  const clean = isTaskMode(mode) ? mode : DEFAULT_TASK_MODE
  writeJsonAtomicPretty(file(workspace), { mode: clean })
  return clean
}

/**
 * Instruction injectée dans la session orchestrateur pour le mode courant.
 * Texte court et impératif : l'instruction accompagne CHAQUE tour de l'agent.
 */
export function taskModeInstruction(mode: TaskMode): string {
  if (mode === "auto") {
    return [
      "Mode AUTO : pour chaque tâche, choisis toi-même le meilleur sous-agent parmi",
      "« code », « analyse » et « recherche », fais-lui exécuter le travail, puis",
      "synthétise le résultat pour l'utilisateur.",
    ].join(" ")
  }
  return [
    `Mode ${mode.toUpperCase()} (imposé par l'utilisateur) : délègue systématiquement`,
    `l'exécution de chaque tâche au sous-agent « ${mode} ». Tu gardes le contexte de`,
    "la conversation, la coordination et la synthèse finale — mais tu n'exécutes pas",
    "toi-même le travail du spécialiste.",
  ].join(" ")
}

import path from "node:path"
import { loadKeys } from "./settings.js"
import type { Task } from "./priorities.js"
import {
  appendFreebuffMessages,
  getFreebuffPreviousRun,
  setFreebuffPreviousRun,
} from "./freebuff-history.js"

export const FREEBUFF_MODEL_LABEL = "Freebuff / Codebuff SDK"

type FreebuffEvent = { type?: string; [key: string]: unknown }

const AGENTS: Record<Task, string> = {
  projet: "codebuff/base@latest", // v9.0.0 : l'orchestrateur utilise l'agent généraliste Codebuff
  code: "codebuff/base@latest",
  analyse: "codebuff/thinker@latest",
  recherche: "codebuff/researcher@latest",
}

const running = new Map<string, AbortController>()

function outputText(output: unknown): string {
  const visit = (value: unknown, depth = 0): string => {
    if (depth > 8 || value == null) return ""
    if (typeof value === "string") return value.trim()
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    if (Array.isArray(value)) return value.map((item) => visit(item, depth + 1)).filter(Boolean).join("\n").trim()
    if (typeof value === "object") {
      const o = value as Record<string, unknown>
      if (o.type === "error") throw new Error(String(o.message ?? "Freebuff a signalé une erreur."))
      for (const key of ["text", "message", "value", "output"]) {
        const candidate = visit(o[key], depth + 1)
        if (candidate) return candidate
      }
      return ""
    }
    return ""
  }

  const text = visit(output)
  if (text) return text
  try {
    return JSON.stringify(output) ?? ""
  } catch {
    return String(output ?? "").trim()
  }
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/**
 * Erreur de facturation Codebuff (compte sans crédits, 402 Payment Required…).
 * Exportée pour le repli automatique : sur ce cas ET SEULEMENT CE CAS, Aven renvoie le
 * tour sur les modèles gratuits OpenCode au lieu d'afficher une erreur bloquante.
 */
export function isBillingError(err: unknown): boolean {
  return /payment required|\b402\b|insufficient|crédit|credit/i.test(errorText(err))
}

export function isFreebuffRunning(chatId: string) {
  return running.has(chatId)
}

export function interruptFreebuff(chatId: string) {
  running.get(chatId)?.abort()
}

/**
 * Exécute Codebuff dans le dossier Aven courant. C'est le chemin SDK officiel :
 * il nécessite une clé Codebuff et ne réutilise pas l'authToken du client Freebuff.
 */
export async function runFreebuff(options: {
  chatId: string
  task: Task
  prompt: string
  cwd: string
  notify?: (text: string, event?: FreebuffEvent) => void
}) {
  const apiKey = loadKeys().codebuff?.trim()
  if (!apiKey) throw new Error("Configure une clé Codebuff dans Paramètres pour utiliser Freebuff.")
  if (running.has(options.chatId)) throw new Error("Un tour Freebuff est déjà en cours dans cette conversation.")

  // Import dynamique : Aven reste lançable même si les dépendances n'ont pas encore été installées.
  // @ts-ignore — dépendance optionnelle au démarrage, installée par npm en usage normal.
  const { CodebuffClient } = await import("@codebuff/sdk")
  if (typeof CodebuffClient !== "function") throw new Error("Le SDK Codebuff est installé mais son client est indisponible.")

  const controller = new AbortController()
  running.set(options.chatId, controller)
  const previousRun = getFreebuffPreviousRun(options.chatId)
  const now = Date.now()

  let client: any
  try {
    client = new CodebuffClient({ apiKey, cwd: path.resolve(options.cwd) })
    const agent = AGENTS[options.task] ?? AGENTS.code
    options.notify?.(`Freebuff démarre avec ${agent}.`)
    const result = await client.run({
      agent,
      prompt: `Tu es le backend Freebuff intégré à Aven. Agent Aven : ${options.task}. Réponds en français.\n\n${options.prompt.trim()}`,
      previousRun,
      // v9.1.0 : l'orchestrateur projet a besoin de plus de pas pour déléguer aux
      // agents spécialisés puis synthétiser (30 comme son pendant OpenCode).
      maxAgentSteps: options.task === "projet" ? 30 : 20,
      signal: controller.signal,
      handleEvent: (event: FreebuffEvent) => {
        const type = String(event?.type ?? "")
        if (["agent_start", "agent_finish", "tool_call", "tool_result", "error"].includes(type)) {
          let text = `Freebuff : ${type.replaceAll("_", " ")}`
          const toolName = typeof event.toolName === "string" ? event.toolName : typeof event.name === "string" ? event.name : ""
          if (toolName) text += ` — ${toolName}`
          options.notify?.(text, event)
        }
      },
    } as Record<string, unknown>)

    if (!result || typeof result !== "object") throw new Error("Réponse Freebuff invalide.")
    const output = (result as { output?: unknown }).output
    const response = outputText(output)
    if (!response) throw new Error("Freebuff n'a renvoyé aucune réponse texte.")

    setFreebuffPreviousRun(options.chatId, result)
    // Historique écrit APRÈS le succès (message utilisateur et réponse ensemble) : avant,
    // le message utilisateur était enregistré avant le run et restait orphelin en cas
    // d'échec ou d'interruption.
    appendFreebuffMessages(options.chatId, [
      { id: `freebuff-user-${now}`, role: "user", text: options.prompt.trim(), timestamp: now },
      { id: `freebuff-assistant-${now}`, role: "assistant", text: response, agent: options.task, model: FREEBUFF_MODEL_LABEL, timestamp: Date.now() },
    ])

    return { response, model: FREEBUFF_MODEL_LABEL, agent: options.task, runState: result }
  } catch (err) {
    const message = errorText(err)
    if (controller.signal.aborted) throw new Error("Tour Freebuff interrompu.")
    throw new Error(`Freebuff : ${message}`)
  } finally {
    try { await Promise.resolve(client?.closeConnection?.()) } catch { /* fermeture best effort */ }
    running.delete(options.chatId)
  }
}

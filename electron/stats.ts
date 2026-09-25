// Statistiques Aven (v8.11.0) : comptage des dictées (persistant, par espace de travail)
// + agrégations pures calculées depuis des données injectées (testable avec Node seul).
// Fichier : .opencode-app/stats.json — même convention que les autres métadonnées.
import { readFileSync } from "node:fs"
import path from "node:path"
import { writeJsonAtomicPretty } from "./atomic-file.js"

const file = (workspace: string) => path.join(workspace, ".opencode-app", "stats.json")

export type DictationStats = { total: number; day: string; dayCount: number }

function todayStr(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

function readStats(workspace: string): DictationStats {
  try {
    const raw = JSON.parse(readFileSync(file(workspace), "utf8")) as Partial<DictationStats>
    return {
      total: typeof raw.total === "number" && raw.total >= 0 ? raw.total : 0,
      day: typeof raw.day === "string" ? raw.day : "",
      dayCount: typeof raw.dayCount === "number" && raw.dayCount >= 0 ? raw.dayCount : 0,
    }
  } catch {
    return { total: 0, day: "", dayCount: 0 }
  }
}

/** Incrémente le compteur de dictées (reset automatique du compteur journalier). */
export function countDictation(workspace: string, now: Date = new Date()): DictationStats {
  const stats = readStats(workspace)
  const day = todayStr(now)
  stats.total += 1
  if (stats.day === day) stats.dayCount += 1
  else {
    stats.day = day
    stats.dayCount = 1
  }
  writeJsonAtomicPretty(file(workspace), stats)
  return stats
}

/** Lecture pure (pour l'affichage). */
export function readDictationStats(workspace: string): DictationStats {
  return readStats(workspace)
}

// ── Agrégations pures (injectées par l'appelant : jamais d'I/O dans ces fonctions) ──

export type ChatLite = { id: string; agent?: string; archived?: boolean }
export type StatsPayload = {
  chats: ChatLite[]
  dictations: DictationStats
  modelCounters: Record<string, number>
}

export type AggregatedStats = {
  totalChats: number
  archivedChats: number
  perAgent: { agent: string; count: number }[]
  dictationsTotal: number
  dictationsToday: number
  topModels: { model: string; count: number }[]
}

/** Agrège les données brutes en chiffres affichables. Pure : testée sans disque ni Electron. */
export function aggregateStats(payload: StatsPayload, agentIds: string[]): AggregatedStats {
  const active = payload.chats.filter((c) => !c.archived)
  const perAgent = agentIds
    .map((agent) => ({ agent, count: active.filter((c) => (c.agent ?? "") === agent).length }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count)
  const other = active.length - perAgent.reduce((sum, e) => sum + e.count, 0)
  if (other > 0) perAgent.push({ agent: "autre", count: other })

  const topModels = Object.entries(payload.modelCounters)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([model, count]) => ({ model, count }))

  return {
    totalChats: active.length,
    archivedChats: payload.chats.length - active.length,
    perAgent,
    dictationsTotal: payload.dictations.total,
    dictationsToday: payload.dictations.dayCount,
    topModels,
  }
}

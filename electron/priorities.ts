import { readFileSync } from "node:fs"

export const TASKS = ["code", "analyse", "recherche"] as const
export type Task = (typeof TASKS)[number]
export type Limit = { perMinute?: number; perDay?: number; shared?: string }
export type Entry = { label: string; priority: Partial<Record<Task, number>>; limit?: Limit }
export type Table = Record<string, Entry>
export type Chain = { ref: string; label: string; priority: number }[]

/**
 * Aven est volontairement « free only ».
 * Les modèles OpenCode explicitement gratuits et les variantes :free d'OpenRouter
 * sont autorisés. Tout le reste est rejeté, même s'il est présent dans un ancien
 * fichier model-priorities.json d'un espace de travail.
 */
const OPEN_CODE_FREE_IDS = new Set([
  "deepseek-v4-flash-free",
  "mimo-v2.5-free",
  "laguna-s-2.1-free",
  "ling-3.0-tiny-free",
  "longcat-2.0-free",
  "north-mini-code-free",
  "nemotron-3-ultra-free",
  "nemotron-3.5-lightning-free",
  "mimo-v2.6-flash-free",
  "space-bunny-free",
  "muse-spark-1.3-contributor-free",
  "jev-1.13-free",
  "big-pickle",
])

/**
 * Aven est volontairement « free only ». La liste ci-dessus n'est pas la seule porte
 * d'entrée : elle reste le socle éprouvé, et un modèle OpenCode inconnu portant le
 * suffixe « -free » est accepté aussi (OpenCode publie et retire des modèles gratuits
 * sans prévenir — voir NOTES-VERIFIEES.md). Les modèles payants restent interdits.
 */
export function isFreeModelRef(ref: string): boolean {
  if (ref.startsWith("openrouter/") && ref.endsWith(":free")) return true
  if (!ref.startsWith("opencode/")) return false
  const id = ref.slice("opencode/".length)
  return OPEN_CODE_FREE_IDS.has(id) || id.endsWith("-free")
}

function validate(raw: unknown): Table {
  const models = (raw as { models?: Record<string, Entry> })?.models
  if (!models || typeof models !== "object") throw new Error('clé "models" absente')
  for (const [ref, e] of Object.entries(models)) {
    if (!ref.includes("/")) throw new Error(`« ${ref} » : la référence doit être fournisseur/modèle`)
    if (typeof e?.label !== "string") throw new Error(`« ${ref} » : "label" manquant`)
    for (const [t, v] of Object.entries(e.priority ?? {})) {
      if (!(TASKS as readonly string[]).includes(t)) throw new Error(`« ${ref} » : tâche inconnue « ${t} »`)
      if (typeof v !== "number") throw new Error(`« ${ref} » : priorité de « ${t} » non numérique`)
    }
  }
  return Object.fromEntries(Object.entries(models).filter(([ref]) => isFreeModelRef(ref)))
}

export function loadTable(...files: string[]): { table: Table; source: string; warning?: string } {
  let warning: string | undefined
  for (const f of files) {
    try {
      return { table: validate(JSON.parse(readFileSync(f, "utf8"))), source: f, warning }
    } catch (err) {
      warning = `${f} : ${err instanceof Error ? err.message : String(err)}`
    }
  }
  throw new Error(`Aucune table de priorités valide. ${warning ?? ""}`)
}

/**
 * Répare les catalogues périmés : OpenCode peut publier/retirer des modèles
 * gratuits sans que le fichier local soit modifié. On ajoute donc uniquement
 * les modèles réellement renvoyés par model.list(), et uniquement s'ils sont
 * explicitement gratuits selon isFreeModelRef().
 */
export function addDiscoveredFreeModels(
  table: Table,
  available: Array<{ ref: string; label?: string }>,
): { table: Table; added: string[] } {
  const next: Table = { ...table }
  const added: string[] = []
  const base = 60
  for (const model of available) {
    if (!isFreeModelRef(model.ref) || next[model.ref]) continue
    const label = model.label?.trim() || model.ref
    next[model.ref] = {
      label,
      priority: { code: base + added.length, analyse: base + added.length, recherche: base + added.length },
    }
    added.push(model.ref)
  }
  return { table: next, added }
}

/** Pour chaque tâche : modèles DISPONIBLES triés par priorité croissante. */
export function buildChains(table: Table, available: Set<string>): Record<Task, Chain> {
  const out = {} as Record<Task, Chain>
  for (const task of TASKS) {
    out[task] = Object.entries(table)
      .map(([ref, e], i) => ({ ref, label: e.label, priority: e.priority?.[task], i }))
      .filter((m): m is { ref: string; label: string; priority: number; i: number } => m.priority !== undefined && available.has(m.ref))
      .sort((a, b) => a.priority - b.priority || a.i - b.i)
      .map(({ ref, label, priority }) => ({ ref, label, priority }))
  }
  return out
}

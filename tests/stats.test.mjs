import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { aggregateStats, countDictation, readDictationStats } from "../electron/stats.ts"

const temp = mkdtempSync(path.join(tmpdir(), "aven-stats-"))
process.on("exit", () => { try { rmSync(temp, { recursive: true, force: true }) } catch { /* Windows peut retarder */ } })

test("countDictation : incrémente total et compteur du jour, persiste", () => {
  const d1 = new Date("2026-09-25T10:00:00")
  const s1 = countDictation(temp, d1)
  assert.equal(s1.total, 1)
  assert.equal(s1.dayCount, 1)
  const s2 = countDictation(temp, new Date("2026-09-25T18:00:00"))
  assert.equal(s2.total, 2)
  assert.equal(s2.dayCount, 2) // même jour
  assert.deepEqual(readDictationStats(temp), s2) // relecture = persistance OK
})

test("countDictation : le compteur journalier repart à 1 le lendemain, le total continue", () => {
  const s = countDictation(temp, new Date("2026-09-26T08:00:00"))
  assert.equal(s.total, 3)
  assert.equal(s.dayCount, 1)
})

test("countDictation : fichier absent ou corrompu = compteurs à zéro, sans crash", () => {
  const fresh = mkdtempSync(path.join(tmpdir(), "aven-stats-"))
  const s = readDictationStats(fresh)
  assert.deepEqual(s, { total: 0, day: "", dayCount: 0 })
})

test("aggregateStats : répartition par agent, archivées exclues du total actif", () => {
  const chats = [
    { id: "1", agent: "code" },
    { id: "2", agent: "code" },
    { id: "3", agent: "recherche" },
    { id: "4", agent: "code", archived: true },
    { id: "5" }, // sans agent
  ]
  const stats = aggregateStats(
    { chats, dictations: { total: 12, day: "2026-09-25", dayCount: 3 }, modelCounters: { "deepseek-v4-flash-free": 9, "gpt-oss-20b": 4 } },
    ["code", "recherche", "analyse"],
  )
  assert.equal(stats.totalChats, 4) // l'archivée ne compte pas
  assert.equal(stats.archivedChats, 1)
  assert.deepEqual(stats.perAgent[0], { agent: "code", count: 2 })
  assert.deepEqual(stats.perAgent[1], { agent: "recherche", count: 1 })
  assert.deepEqual(stats.perAgent[2], { agent: "autre", count: 1 }) // celle sans agent
  assert.equal(stats.dictationsTotal, 12)
  assert.equal(stats.dictationsToday, 3)
  assert.deepEqual(stats.topModels[0], { model: "deepseek-v4-flash-free", count: 9 })
  assert.equal(stats.topModels.length, 2)
})

test("aggregateStats : aucune donnée = zéros propres (jamais de NaN)", () => {
  const stats = aggregateStats({ chats: [], dictations: { total: 0, day: "", dayCount: 0 }, modelCounters: {} }, ["code"])
  assert.equal(stats.totalChats, 0)
  assert.equal(stats.archivedChats, 0)
  assert.deepEqual(stats.perAgent, [])
  assert.deepEqual(stats.topModels, [])
})

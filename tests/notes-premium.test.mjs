import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { loadPinned, matchQuery, normalizeForSearch, togglePin } from "../electron/notes-meta.ts"

const temp = mkdtempSync(path.join(tmpdir(), "aven-notes-"))
process.on("exit", () => { try { rmSync(temp, { recursive: true, force: true }) } catch { /* Windows peut retarder */ } })

test("togglePin : épingle puis détache une note (persisté)", () => {
  mkdirSync(path.join(temp, ".opencode-app"), { recursive: true })
  assert.deepEqual(loadPinned(temp), [])
  const afterPin = togglePin(temp, "budget.md")
  assert.deepEqual(afterPin, ["budget.md"])
  assert.deepEqual(loadPinned(temp), ["budget.md"]) // relecture = persistance OK
  const afterUnpin = togglePin(temp, "budget.md")
  assert.deepEqual(afterUnpin, [])
  assert.deepEqual(loadPinned(temp), [])
})

test("togglePin : id avec chemin = basename uniquement (anti-traversée)", () => {
  const pinned = togglePin(temp, "..\\evil\\note.md")
  assert.deepEqual(pinned, ["note.md"])
  togglePin(temp, "note.md") // nettoyage
})

test("togglePin : au-delà du maximum, l'épinglage est refusé", () => {
  for (let i = 0; i < 20; i++) togglePin(temp, `note-${i}.md`)
  assert.throws(() => togglePin(temp, "note-20.md"), /Maximum/)
  for (let i = 0; i < 20; i++) togglePin(temp, `note-${i}.md`) // nettoyage
})

test("normalizeForSearch : accents, casse et ponctuation neutralisés", () => {
  assert.equal(normalizeForSearch("Réunion Déploiement ! 2026"), "reunion deploiement 2026")
  assert.equal(normalizeForSearch("ÉCOLE — été"), "ecole ete")
})

test("matchQuery : tous les termes doivent être présents", () => {
  const text = normalizeForSearch("Réunion du déploiement, budget et planning")
  assert.equal(matchQuery(text, normalizeForSearch("budget planning")), true)
  assert.equal(matchQuery(text, normalizeForSearch("budget absent")), false)
  assert.equal(matchQuery(text, ""), true) // requête vide = tout passe
})

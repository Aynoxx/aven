import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DEFAULT_TASK_MODE, isTaskMode, loadTaskMode, saveTaskMode, taskModeInstruction } from "../host/task-mode.ts"

const temp = mkdtempSync(path.join(tmpdir(), "aven-task-mode-"))
process.on("exit", () => { try { rmSync(temp, { recursive: true, force: true }) } catch { /* Windows peut retarder */ } })

test("mode par défaut : auto (l'orchestrateur choisit)", () => {
  assert.equal(loadTaskMode(temp), DEFAULT_TASK_MODE)
  assert.equal(loadTaskMode(temp), "auto")
})

test("persistance : saveTaskMode puis relecture", () => {
  assert.equal(saveTaskMode(temp, "code"), "code")
  assert.equal(loadTaskMode(temp), "code")
  assert.equal(saveTaskMode(temp, "analyse"), "analyse")
  assert.equal(loadTaskMode(temp), "analyse")
})

test("mode invalide : refusé à l'écriture (retour à auto) et ignoré à la lecture", () => {
  assert.equal(saveTaskMode(temp, "pirate"), "auto")
  assert.equal(isTaskMode("recherche"), true)
  assert.equal(isTaskMode("musique"), false)
})

test("instructions : auto = l'orchestrateur choisit le sous-agent", () => {
  const text = taskModeInstruction("auto")
  assert.match(text, /AUTO/)
  assert.match(text, /choisis/i)
  assert.match(text, /sous-agent/)
})

test("instructions : mode manuel = délégation imposée au spécialiste", () => {
  for (const mode of ["code", "analyse", "recherche"]) {
    const text = taskModeInstruction(mode)
    assert.match(text, new RegExp(mode.toUpperCase()))
    assert.match(text, /délègue/i)
    assert.ok(text.includes(`« ${mode} »`), `le sous-agent ${mode} est nommé`)
  }
})

console.log("task-mode: OK")

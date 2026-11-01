import assert from "node:assert/strict"
import { test } from "node:test"
import { agentPhaseFor } from "../web/src/workbench/agent-phase.ts"

// v12.7.4 : `starting` ne couvre que le démarrage ; sans espace la sphère reste
// `muted`, et une erreur garde `error` — la décision est testée ici, pas dans le rendu.
test("agentPhaseFor : la sphère ne prétend jamais démarrer après un échec", () => {
  assert.equal(agentPhaseFor("starting", false, "muted"), "starting")
  assert.equal(agentPhaseFor("ready", false, "listening"), "listening")
  assert.equal(agentPhaseFor("ready", undefined, "listening"), "listening")
  assert.equal(agentPhaseFor("ready", true, "listening"), "muted")
  assert.equal(agentPhaseFor("error", false, "listening"), "error")
  assert.equal(agentPhaseFor("error", true, "listening"), "error")
})

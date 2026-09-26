import assert from "node:assert/strict"
import { test } from "node:test"
import { effectiveBackend, nextManualChoice } from "../web/src/backend-choice.ts"

test("sans clé Codebuff, jamais Freebuff (réglage actif, quel que soit l'agent)", () => {
  for (const tab of ["projet", "code", "recherche", "analyse"]) {
    assert.equal(effectiveBackend({ hasCodebuffKey: false, pref: true, manual: null }), "opencode", tab)
  }
})

test("clé + réglage actif = Freebuff moteur de TOUS les agents (v9.1.0)", () => {
  for (const tab of ["projet", "code", "recherche", "analyse"]) {
    assert.equal(effectiveBackend({ hasCodebuffKey: true, pref: true, manual: null }), "freebuff", tab)
  }
})

test("réglage désactivé = OpenCode gratuit pour tous les agents", () => {
  for (const tab of ["projet", "code", "recherche", "analyse"]) {
    assert.equal(effectiveBackend({ hasCodebuffKey: true, pref: false, manual: null }), "opencode", tab)
  }
})

test("l'override manuel gagne toujours, dans les deux sens et pour tout agent", () => {
  assert.equal(effectiveBackend({ hasCodebuffKey: true, pref: true, manual: true }), "freebuff")
  assert.equal(effectiveBackend({ hasCodebuffKey: false, pref: false, manual: true }), "freebuff")
  assert.equal(effectiveBackend({ hasCodebuffKey: true, pref: true, manual: false }), "opencode")
})

test("le bouton cycle auto → forcé → désactivé → auto", () => {
  assert.equal(nextManualChoice(null), true)
  assert.equal(nextManualChoice(true), false)
  assert.equal(nextManualChoice(false), null)
})

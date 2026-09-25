import assert from "node:assert/strict"
import { test } from "node:test"
import { effectiveBackend, nextManualChoice } from "../web/src/backend-choice.ts"

test("sans clé Codebuff, jamais Freebuff (même sur l'agent code, réglage actif)", () => {
  assert.equal(effectiveBackend({ tab: "code", hasCodebuffKey: false, pref: true, manual: null }), "opencode")
})

test("clé + réglage actif + agent code = Freebuff par défaut", () => {
  assert.equal(effectiveBackend({ tab: "code", hasCodebuffKey: true, pref: true, manual: null }), "freebuff")
})

test("clé + réglage actif mais autre agent = OpenCode gratuit", () => {
  assert.equal(effectiveBackend({ tab: "recherche", hasCodebuffKey: true, pref: true, manual: null }), "opencode")
  assert.equal(effectiveBackend({ tab: "analyse", hasCodebuffKey: true, pref: true, manual: null }), "opencode")
})

test("réglage désactivé = OpenCode même sur code", () => {
  assert.equal(effectiveBackend({ tab: "code", hasCodebuffKey: true, pref: false, manual: null }), "opencode")
})

test("l'override manuel gagne toujours, dans les deux sens", () => {
  assert.equal(effectiveBackend({ tab: "recherche", hasCodebuffKey: true, pref: true, manual: true }), "freebuff")
  assert.equal(effectiveBackend({ tab: "code", hasCodebuffKey: true, pref: true, manual: false }), "opencode")
})

test("le bouton cycle auto → forcé → désactivé → auto", () => {
  assert.equal(nextManualChoice(null), true)
  assert.equal(nextManualChoice(true), false)
  assert.equal(nextManualChoice(false), null)
})

import assert from "node:assert/strict"
import { test } from "node:test"
import { shouldNotify, notifyContent } from "../electron/notify-policy.ts"

const KINDS = ["turn-done", "turn-error", "permission", "form"]

test("jamais de notification quand la fenêtre est au premier plan (toutes sortes d'événements)", () => {
  for (const kind of KINDS) {
    assert.equal(shouldNotify({ windowFocused: true, kind, turnDurationMs: 60_000, enabled: true }), false, kind)
  }
})

test("interrupteur : désactivé = jamais rien, même en arrière-plan", () => {
  assert.equal(shouldNotify({ windowFocused: false, kind: "permission", enabled: false }), false)
})

test("permission et formulaire : toujours notifiés en arrière-plan", () => {
  assert.equal(shouldNotify({ windowFocused: false, kind: "permission", enabled: true }), true)
  assert.equal(shouldNotify({ windowFocused: false, kind: "form", enabled: true }), true)
})

test("tour terminé : notifié seulement au-delà de 8 s", () => {
  assert.equal(shouldNotify({ windowFocused: false, kind: "turn-done", turnDurationMs: 7_999, enabled: true }), false)
  assert.equal(shouldNotify({ windowFocused: false, kind: "turn-done", turnDurationMs: 8_001, enabled: true }), true)
  assert.equal(shouldNotify({ windowFocused: false, kind: "turn-done", enabled: true }), false) // durée inconnue = court
})

test("tour échoué : toujours notifié en arrière-plan, même sans durée", () => {
  assert.equal(shouldNotify({ windowFocused: false, kind: "turn-error", enabled: true }), true)
})

test("libellés : courts, sans contenu de réponse", () => {
  const done = notifyContent("turn-done", 12_400)
  assert.match(done.body, /12 s/)
  assert.match(notifyContent("permission").body, /permission/i)
  assert.match(notifyContent("form").body, /formulaire/i)
  assert.match(notifyContent("turn-error").body, /échoué/i)
})

import assert from "node:assert/strict"
import { test } from "node:test"
import { shouldInterruptSpeech } from "../web/src/voice-agent/barge-in.ts"

// v11.4.2 : une vraie reprise coupe la lecture ; la voix de l'agent ne tronque
// pas sa propre question de confirmation.

test("une reprise de parole coupe la lecture en cours", () => {
  assert.equal(shouldInterruptSpeech({ phase: "speaking", awaitingNote: false }), true)
  assert.equal(shouldInterruptSpeech({ phase: "thinking", awaitingNote: false }), true)
})

test("pendant une question de note, la lecture n'est pas coupée", () => {
  assert.equal(shouldInterruptSpeech({ phase: "speaking", awaitingNote: true }), false)
})

test("hors lecture, il n'y a rien à couper", () => {
  for (const phase of ["listening", "capturing", "transcribing", "muted", "error"]) {
    assert.equal(shouldInterruptSpeech({ phase, awaitingNote: false }), false, phase)
    assert.equal(shouldInterruptSpeech({ phase, awaitingNote: true }), false, phase)
  }
})

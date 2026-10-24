import assert from "node:assert/strict"
import { test } from "node:test"
import {
  FOLLOW_UP_MS,
  acceptsFollowUp,
  initialVoiceSession,
  reduceVoiceSession,
} from "../web/src/voice-agent/session.ts"

// v11.1.0 : l'interruption et l'anti-mélange de demandes vivent dans une
// machine à états pure — testable sans micro, sans TTS, sans Tauri.

test("état initial : écoute, ou micro coupé si la préférence le dit", () => {
  assert.equal(initialVoiceSession(false).phase, "listening")
  assert.equal(initialVoiceSession(true).phase, "muted")
})

test("couper le micro arrête la lecture et invalide la demande en cours", () => {
  let state = { ...initialVoiceSession(false), phase: "speaking", requestId: 4 }
  state = reduceVoiceSession(state, { type: "mic", muted: true })
  assert.equal(state.phase, "muted")
  assert.equal(state.requestId, 5)
  assert.equal(acceptsFollowUp(state, Date.now()), false)
})

test("découper la micro ouvre l'écoute", () => {
  let state = initialVoiceSession(true)
  state = reduceVoiceSession(state, { type: "mic", muted: false })
  assert.equal(state.phase, "listening")
  assert.equal(state.micMuted, false)
})

test("parole détectée puis terminée : capture puis transcription", () => {
  let state = initialVoiceSession(false)
  state = reduceVoiceSession(state, { type: "speech-start" })
  assert.equal(state.phase, "capturing")
  state = reduceVoiceSession(state, { type: "speech-end" })
  assert.equal(state.phase, "transcribing")
})

test("reprendre la parole pendant la lecture interrompt la réponse", () => {
  let state = initialVoiceSession(false)
  state = reduceVoiceSession(state, { type: "thinking", requestId: 2 }, 0)
  const before = state.requestId
  state = reduceVoiceSession(state, { type: "speech-start" }, 100)
  assert.equal(state.phase, "capturing")
  assert.equal(state.requestId, before + 1)
  assert.equal(state.followUpUntil, 0)
})

test("une réponse d'une demande périmée ne prend jamais la parole", () => {
  let state = initialVoiceSession(false)
  state = reduceVoiceSession(state, { type: "thinking", requestId: 3 }, 0)
  const stale = reduceVoiceSession(state, { type: "speaking", requestId: 2, reply: "vieille réponse" }, 10)
  assert.equal(stale.phase, "thinking")
  const fresh = reduceVoiceSession(state, { type: "speaking", requestId: 3, reply: "bonne réponse" }, 10)
  assert.equal(fresh.phase, "speaking")
  assert.equal(fresh.reply, "bonne réponse")
})

test("fin de lecture : fenêtre de suivi de dix secondes", () => {
  let state = initialVoiceSession(false)
  state = reduceVoiceSession(state, { type: "speaking", requestId: 0, reply: "ok" }, 0)
  state = reduceVoiceSession(state, { type: "done" }, 1_000)
  assert.equal(state.phase, "listening")
  assert.equal(state.followUpUntil, 1_000 + FOLLOW_UP_MS)
  assert.equal(acceptsFollowUp(state, 1_000 + FOLLOW_UP_MS - 1), true)
  assert.equal(acceptsFollowUp(state, 1_000 + FOLLOW_UP_MS), false)
})

test("une transcription vide ramène à l'écoute sans réponse", () => {
  let state = { ...initialVoiceSession(false), phase: "transcribing", heard: "ancien" }
  state = reduceVoiceSession(state, { type: "heard", text: "   " })
  assert.equal(state.phase, "listening")
  assert.equal(state.heard, undefined)
})

test("erreur lisible puis reprise par interruption", () => {
  let state = initialVoiceSession(false)
  state = reduceVoiceSession(state, { type: "error", message: "Quota gratuit Groq atteint." })
  assert.equal(state.phase, "error")
  assert.match(state.error ?? "", /Quota gratuit/)
  state = reduceVoiceSession(state, { type: "interrupt" })
  assert.equal(state.phase, "listening")
  assert.equal(state.error, undefined)
})

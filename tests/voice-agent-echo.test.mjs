import assert from "node:assert/strict"
import { test } from "node:test"
import { ECHO_MIN_WORDS, ECHO_WINDOW_MS, isSelfEcho, normalizeSpeech } from "../web/src/voice-agent/echo.ts"

// v11.4.1 : l'agent s'entend lui-même. La règle testée ici est celle qui empêche
// sa propre voix d'annuler une note en attente : un fragment contigu déjà
// prononcé n'est pas une réponse, un mot seul en est une.

const PROMPT = "Je note : « le client rappelle lundi ». Je l’enregistre ?"

test("normalisation : accents, majuscules, ponctuation et apostrophes", () => {
  assert.equal(normalizeSpeech("Le Client, rappelle Lundi !"), "le client rappelle lundi")
  assert.equal(normalizeSpeech("Je l’enregistre ?"), "je l enregistre")
  assert.equal(normalizeSpeech("   "), "")
})

test("un fragment de la phrase prononcée est un écho", () => {
  const now = 10_000
  assert.equal(isSelfEcho({ heard: "je l’enregistre", spoken: PROMPT, endedAt: now - 500, now }), true)
  assert.equal(isSelfEcho({ heard: "le client rappelle lundi", spoken: PROMPT, endedAt: now - 1_200, now }), true)
  assert.equal(isSelfEcho({ heard: "Le Client, rappelle Lundi.", spoken: PROMPT, endedAt: now - 200, now }), true)
})

test("un mot seul n'est jamais un écho : c'est la réponse attendue", () => {
  const now = 10_000
  for (const heard of ["oui", "non", "stop", "enregistre", "confirme"]) {
    assert.equal(isSelfEcho({ heard, spoken: PROMPT, endedAt: now - 200, now }), false, heard)
  }
  assert.equal(ECHO_MIN_WORDS, 3)
})

test("pendant la lecture, un fragment est un écho même sans fin de lecture", () => {
  assert.equal(isSelfEcho({ heard: "je l’enregistre", spoken: PROMPT, speaking: true, endedAt: 0, now: 5 }), true)
})

test("après la fenêtre, la même phrase n'est plus un écho", () => {
  const now = 100_000
  assert.equal(isSelfEcho({ heard: "je l’enregistre", spoken: PROMPT, endedAt: now - ECHO_WINDOW_MS - 1, now }), false)
  assert.equal(isSelfEcho({ heard: "je l’enregistre", spoken: PROMPT, endedAt: now - ECHO_WINDOW_MS, now }), true)
})

test("une vraie demande n'est pas prise pour un écho", () => {
  const now = 10_000
  assert.equal(isSelfEcho({ heard: "quelle heure est il", spoken: PROMPT, endedAt: now - 300, now }), false)
  // Mots présents mais NON contigus dans la phrase : ce n'est pas un écho.
  assert.equal(isSelfEcho({ heard: "lundi je note", spoken: PROMPT, endedAt: now - 300, now }), false)
})

test("sans phrase prononcée, rien n'est un écho", () => {
  assert.equal(isSelfEcho({ heard: "je l’enregistre", spoken: "", endedAt: 5_000, now: 5_100 }), false)
})

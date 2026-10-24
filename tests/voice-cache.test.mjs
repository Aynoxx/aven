import assert from "node:assert/strict"
import { test } from "node:test"
import { createVoiceCache } from "../host/voice-cache.ts"

// v11.4.3 : une phrase déjà synthétisée n'est jamais redemandée au service.

test("un texte déjà synthétisé est resservi", () => {
  const cache = createVoiceCache({ now: () => 0 })
  cache.set("denise\u0000C'est fait.", "AUDIO")
  assert.equal(cache.get("denise\u0000C'est fait."), "AUDIO")
  assert.equal(cache.get("denise\u0000Autre chose."), undefined)
})

test("la voix fait partie de la clé : changer de voix ne sert pas l'ancienne", () => {
  const cache = createVoiceCache({ now: () => 0 })
  cache.set("denise\u0000Bonjour", "AUDIO-DENISE")
  assert.equal(cache.get("henri\u0000Bonjour"), undefined)
})

test("au-delà de la durée de vie, l'entrée expire", () => {
  let at = 1_000
  const cache = createVoiceCache({ ttlMs: 500, now: () => at })
  cache.set("k", "AUDIO")
  at = 1_500
  assert.equal(cache.get("k"), "AUDIO")
  at = 1_501
  assert.equal(cache.get("k"), undefined)
  assert.equal(cache.size(), 0)
})

test("la taille est bornée : l'entrée la moins récemment utilisée sort", () => {
  let at = 0
  const cache = createVoiceCache({ maxEntries: 2, now: () => at })
  cache.set("a", "A")
  at = 1
  cache.set("b", "B")
  at = 2
  assert.equal(cache.get("a"), "A") // « a » redevient la plus récente
  at = 3
  cache.set("c", "C")
  assert.equal(cache.size(), 2)
  assert.equal(cache.get("a"), "A")
  assert.equal(cache.get("b"), undefined)
  assert.equal(cache.get("c"), "C")
})

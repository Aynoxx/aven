import assert from "node:assert/strict"
import { test } from "node:test"
import { PAUSE_MAX_MS, PAUSE_TARGET_MS, compressPauses } from "../web/src/voice-agent/pause.ts"

// v11.3.0 : le service marque ~1 s entre deux phrases ; la coupe doit tomber dans
// le silence, jamais dans une consonne, et ne pas toucher les pauses courtes.
const RATE = 24_000
const ms = (duration) => Math.round((duration / 1000) * RATE)

/** Alterne parole (amplitude 0.3) et silence, selon une liste de durées en ms. */
function build(parts) {
  const total = parts.reduce((sum, part) => sum + ms(part.ms), 0)
  const samples = new Float32Array(total)
  let offset = 0
  for (const part of parts) {
    const length = ms(part.ms)
    if (part.speech) for (let i = 0; i < length; i++) samples[offset + i] = Math.sin((2 * Math.PI * 220 * i) / RATE) * 0.3
    offset += length
  }
  return samples
}

test("pause longue : ramenée à la cible, la parole reste intacte", () => {
  const samples = build([
    { ms: 500, speech: true },
    { ms: 1_000 },
    { ms: 500, speech: true },
  ])
  const result = compressPauses(samples, RATE)
  assert.equal(result.cuts, 1)
  // ±2 ms : le silence détecté commence au dernier passage à zéro de la sinusoïde.
  assert.ok(Math.abs(result.removedMs - (1_000 - PAUSE_TARGET_MS)) <= 2, `retiré ${result.removedMs} ms`)
  const expected = samples.length - (ms(1_000) - ms(PAUSE_TARGET_MS))
  assert.ok(Math.abs(result.samples.length - expected) <= 2)
  // Aucune parole perdue : les deux zones de voix sont toujours là (crête sur 20 ms,
  // une sinusoïde passant par zéro à certains instants).
  const peakAt = (startMs) => {
    let peak = 0
    for (let i = ms(startMs); i < ms(startMs + 20); i++) peak = Math.max(peak, Math.abs(result.samples[i]))
    return peak
  }
  assert.ok(peakAt(400) > 0.1, "la première phrase reste audible")
  assert.ok(peakAt(500 + PAUSE_TARGET_MS + 400) > 0.1, "la seconde phrase reste audible")
})

test("pause courte : non touchée (une virgule respire)", () => {
  const samples = build([
    { ms: 400, speech: true },
    { ms: 340 },
    { ms: 400, speech: true },
  ])
  const result = compressPauses(samples, RATE)
  assert.equal(result.cuts, 0)
  assert.equal(result.samples.length, samples.length)
  assert.equal(result.removedMs, 0)
})

test("plusieurs pauses : chacune ramenée, jamais davantage", () => {
  const samples = build([
    { ms: 300, speech: true },
    { ms: 1_200 },
    { ms: 300, speech: true },
    { ms: 2_000 },
    { ms: 300, speech: true },
  ])
  const result = compressPauses(samples, RATE)
  assert.equal(result.cuts, 2)
  assert.ok(Math.abs(result.removedMs - (1_200 - PAUSE_TARGET_MS + (2_000 - PAUSE_TARGET_MS))) <= 3, `retiré ${result.removedMs} ms`)
})

test("bords : les silences de tête et de queue ne sont pas du ressort de ce module", () => {
  const samples = build([
    { ms: 900 },
    { ms: 500, speech: true },
    { ms: 900 },
  ])
  const result = compressPauses(samples, RATE)
  assert.equal(result.cuts, 0)
  assert.equal(result.samples.length, samples.length)
})

test("seuil : une pause à peine plus longue que le maximum est ramenée", () => {
  const samples = build([
    { ms: 300, speech: true },
    { ms: PAUSE_MAX_MS + 20 },
    { ms: 300, speech: true },
  ])
  const result = compressPauses(samples, RATE)
  assert.equal(result.cuts, 1)
  assert.ok(result.removedMs > 0)
})

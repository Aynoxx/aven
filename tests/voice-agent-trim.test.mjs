import assert from "node:assert/strict"
import { test } from "node:test"
import { TRIM_MARGIN_MS, TRIM_THRESHOLD, trimRange } from "../web/src/voice-agent/trim.ts"

// v11.3.0 : le service laisse du silence avant et après chaque réponse (mesuré :
// ~150 ms et ~900 ms). La coupe est une décision pure, donc testée sans audio réel.

const RATE = 24_000

function buffer({ leadMs = 0, signalMs = 1_000, tailMs = 0, amplitude = 0.3 }) {
  const lead = Math.round((leadMs / 1000) * RATE)
  const signal = Math.round((signalMs / 1000) * RATE)
  const tail = Math.round((tailMs / 1000) * RATE)
  const samples = new Float32Array(lead + signal + tail)
  for (let index = 0; index < signal; index++) {
    samples[lead + index] = Math.sin((2 * Math.PI * 220 * index) / RATE) * amplitude
  }
  return { samples, lead, signal }
}

test("coupe : le silence de tête et de queue disparaît, la voix reste entière", () => {
  const { samples, lead, signal } = buffer({ leadMs: 150, signalMs: 1_000, tailMs: 900 })
  const range = trimRange(samples, RATE)
  const margin = Math.round((TRIM_MARGIN_MS / 1000) * RATE)
  // ±1 échantillon : le premier échantillon d'une sinusoïde vaut zéro.
  assert.ok(Math.abs(range.start - (lead - margin)) <= 1, "la marge d'attaque est conservée")
  assert.equal(range.end, lead + signal + margin, "la marge de queue est conservée")
  assert.ok(range.end - range.start > signal, "aucun échantillon de voix n'est coupé")
})

test("coupe : une réponse sans silence n'est pas rognée", () => {
  const { samples, signal } = buffer({ signalMs: 500 })
  const range = trimRange(samples, RATE)
  assert.equal(range.start, 0)
  assert.equal(range.end, signal)
})

test("coupe : un silence intégral ne déclenche aucune lecture", () => {
  const range = trimRange(new Float32Array(RATE), RATE)
  assert.deepEqual(range, { start: 0, end: 0 })
})

test("coupe : un bruit sous le seuil ne rallonge pas la plage", () => {
  const samples = new Float32Array(RATE)
  samples[10] = TRIM_THRESHOLD / 2
  samples[RATE - 10] = TRIM_THRESHOLD / 2
  samples[12_000] = 0.2
  const range = trimRange(samples, RATE)
  const margin = Math.round((TRIM_MARGIN_MS / 1000) * RATE)
  assert.equal(range.start, 12_000 - margin)
  assert.equal(range.end, 12_001 + margin)
})

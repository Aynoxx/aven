import assert from "node:assert/strict"
import { test } from "node:test"
import { DEFAULT_VAD_CONFIG, initialVadState, vadStep } from "../web/src/voice-agent/vad.ts"

// v11.1.0 : la segmentation décide ce qui part chez le STT distant. Ces tests
// bornent le comportement : pas de segment sur du bruit, un début franc, une fin
// après un silence court, et une durée maximale.

const LOUD = 0.05
const QUIET = 0.001

function feed(frames) {
  let state = initialVadState()
  const events = []
  for (const [now, rms] of frames) {
    const step = vadStep(state, rms, now)
    state = step.state
    if (step.event) events.push([now, step.event])
  }
  return { state, events }
}

test("du bruit continu ne produit aucun segment", () => {
  const frames = Array.from({ length: 30 }, (_, i) => [i * 50, QUIET])
  assert.deepEqual(feed(frames).events, [])
})

test("un pic bref sous la durée de départ ne réveille pas le VAD", () => {
  const { events } = feed([[0, LOUD], [100, LOUD], [200, QUIET], [300, QUIET]])
  assert.deepEqual(events, [])
})

test("parole franche puis silence : un segment, début et fin corrects", () => {
  const { events } = feed([
    [0, LOUD],
    [100, LOUD],
    [250, LOUD],
    [400, LOUD],
    [500, QUIET],
    [600, QUIET],
    [1_250, QUIET],
  ])
  assert.deepEqual(events, [[250, "speech-start"], [1_250, "speech-end"]])
})

test("un monologue est coupé à la durée maximale", () => {
  // Le segment s'ouvre à 250 ms : la fin forcée tombe à 250 + maxMs.
  const end = 250 + DEFAULT_VAD_CONFIG.maxMs
  const { events } = feed([
    [0, LOUD],
    [250, LOUD],
    [end - 1, LOUD],
    [end, LOUD],
  ])
  assert.deepEqual(events, [[250, "speech-start"], [end, "speech-end"]])
})

test("après une fin, un nouveau segment peut commencer", () => {
  const { events } = feed([
    [0, LOUD],
    [250, LOUD],
    [1_000, QUIET],
    [1_800, QUIET],
    [2_000, LOUD],
    [2_300, LOUD],
    [3_000, QUIET],
    [3_800, QUIET],
  ])
  assert.deepEqual(events, [
    [250, "speech-start"],
    [1_800, "speech-end"],
    [2_300, "speech-start"],
    [3_800, "speech-end"],
  ])
})

test("les valeurs non finies sont traitées comme du silence", () => {
  const { events } = feed([[0, Number.NaN], [100, Number.POSITIVE_INFINITY], [200, LOUD], [500, LOUD]])
  assert.deepEqual(events, [[500, "speech-start"]])
})

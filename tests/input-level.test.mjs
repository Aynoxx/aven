import test from "node:test"
import assert from "node:assert/strict"
import { normalizeLevel, pushLevel, readLevel, resetLevel } from "../web/src/voice-agent/level.ts"

// v12.6.0 : le niveau d'entrée est une MESURE. Ces tests fixent deux propriétés
// dont dépend la sphère : le silence vaut zéro (elle ne simule pas d'écoute) et
// l'attaque est immédiate (le premier mot s'entend tout de suite).

test("le silence et le bruit de fond valent zéro", () => {
  assert.equal(normalizeLevel(0), 0)
  assert.equal(normalizeLevel(0.001), 0)
  assert.equal(normalizeLevel(-3), 0)
  assert.equal(normalizeLevel(Number.NaN), 0)
  assert.equal(normalizeLevel(Number.POSITIVE_INFINITY), 0, "une mesure absurde ne devient pas un maximum")
})

test("une voix pleine atteint 1, sans dépasser", () => {
  assert.equal(normalizeLevel(0.09), 1)
  assert.equal(normalizeLevel(0.4), 1)
  assert.ok(normalizeLevel(0.05) > 0.5, "une voix parlée normale doit peser plus de la moitié")
})

test("l'attaque est immédiate, la retombée amortie", () => {
  resetLevel()
  assert.equal(pushLevel(0.09), 1, "la première trame forte s'applique tout de suite")
  const first = pushLevel(0)
  assert.ok(first > 0.7 && first < 1, `la retombée ne doit pas couper net (${first})`)
  let previous = first
  for (let i = 0; i < 20; i += 1) {
    const next = pushLevel(0)
    assert.ok(next <= previous, "la retombée est monotone")
    previous = next
  }
  assert.ok(previous < 0.05, "après une seconde de silence, la sphère est revenue au repos")
})

test("resetLevel rend le repos", () => {
  pushLevel(0.09)
  resetLevel()
  assert.equal(readLevel(), 0)
})

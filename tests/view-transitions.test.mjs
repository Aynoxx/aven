import assert from "node:assert/strict"

// ── Fallback sans DOM (Node nu) : update() exécuté directement, aucun throw ────
const { withViewTransition } = await import("../web/src/view-transitions.ts")
let called = 0
withViewTransition(() => { called++ })
assert.equal(called, 1, "sans API : update exécuté directement")

// ── Séquence complète avec DOM simulé ──────────────────────────────────────────
// data-vt-source posé AVANT la capture (visible de update()), retiré APRÈS finished.
const g = globalThis
const dataset = {}
g.document = {
  documentElement: { dataset },
  startViewTransition(update) {
    return {
      finished: (async () => {
        update()
        await new Promise((r) => setTimeout(r, 0))
      })(),
    }
  },
}
g.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0)
try {
  const seenDuringUpdate = []
  withViewTransition(() => { seenDuringUpdate.push(dataset.vtSource) }, "project")
  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(seenDuringUpdate, ["project"], "source posée pendant la capture")
  assert.equal("vtSource" in dataset, false, "source retirée après finished")
  withViewTransition(() => {}, undefined)
  await new Promise((r) => setTimeout(r, 20))
  assert.equal("vtSource" in dataset, false, "aucun attribut sans source")
} finally {
  delete g.document
  g.requestAnimationFrame = undefined
}

console.log("view-transitions: OK")

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

  // ── v10.0.1 : filets — un changement d'état ne se perd jamais ────────────────
  // 1) startViewTransition qui LÈVE → update() exécuté quand même.
  g.document = { documentElement: { dataset }, startViewTransition() { throw new Error("capture refusée") } }
  let leve = 0
  withViewTransition(() => { leve++ }, "agents")
  assert.equal(leve, 1, "API qui lève : update appliqué quand même")
  assert.equal(dataset.vtSource, "agents", "API qui lève : source posée avant")
  await new Promise((r) => setTimeout(r, 30))
  assert.equal("vtSource" in dataset, false, "API qui lève : source libérée")

  // 2) Callback navigateur jamais invoqué (fenêtre gelée) → filet de 1 s.
  g.document = { documentElement: { dataset }, startViewTransition() { return { finished: new Promise(() => {}) } } }
  let gele = 0
  withViewTransition(() => { gele++ }, "notes")
  assert.equal(gele, 0, "gel : rien avant le filet (la capture n'arrive pas)")
  await new Promise((r) => setTimeout(r, 1150))
  assert.equal(gele, 1, "gel : le filet de 1 s applique la mise à jour")
  assert.equal("vtSource" in dataset, false, "gel : source libérée par le filet")

  // 3) update() appelé UNE seule fois : même si le navigateur invoque le callback
  //    longtemps après le filet, apply est idempotent.
  let une = 0
  let lateResolve
  g.document = {
    documentElement: { dataset },
    startViewTransition(update) {
      setTimeout(() => update(), 1100) // capture tardive (au-delà du filet)
      return { finished: new Promise((r) => { lateResolve = r }) }
    },
  }
  withViewTransition(() => { une++ }, "files")
  await new Promise((r) => setTimeout(r, 1300))
  assert.equal(une, 1, "filet puis callback tardif : update exécuté exactement une fois")
  lateResolve()
  await new Promise((r) => setTimeout(r, 20))
  assert.equal("vtSource" in dataset, false, "filet puis callback tardif : source libérée")

  // 4) finished REJETÉE (transition annulée par le navigateur) : pas de crash,
  //    pas d'unhandledRejection (le process survivrait de toute façon à l'assert).
  const erreurs = []
  const consoleErreur = console.error
  console.error = (...a) => erreurs.push(a.join(" "))
  try {
    g.document = {
      documentElement: { dataset },
      startViewTransition(update) { update(); return { finished: Promise.reject(new Error("annulée")) } },
    }
    let rejete = 0
    withViewTransition(() => { rejete++ }, "project")
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(rejete, 1, "finished rejetée : update déjà appliqué par le callback")
    assert.equal("vtSource" in dataset, false, "finished rejetée : source libérée")
  } finally {
    console.error = consoleErreur
  }
} finally {
  delete g.document
  g.requestAnimationFrame = undefined
}

console.log("view-transitions: OK")

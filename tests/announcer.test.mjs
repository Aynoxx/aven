import assert from "node:assert/strict"
import { test } from "node:test"
import { Announcer, phraseFor } from "../electron/announcer.ts"

// ── Grammaire pure (phraseFor) ───────────────────────────────────────────────
test("phraseFor : démarrage, succès et échec sont traduits", () => {
  assert.equal(phraseFor({ type: "session.execution.started", data: {} }).text, "C'est parti.")
  const done = phraseFor({ type: "session.execution.succeeded", data: { tools: [{ name: "edit" }, { name: "read" }, { name: "write" }] } })
  assert.match(done.text, /Terminé — 2 fichiers modifiés/)
  assert.equal(phraseFor({ type: "session.execution.succeeded", data: { tools: [{ name: "read" }] } }).text, "Terminé.")
  assert.match(phraseFor({ type: "session.execution.failed", data: { error: { message: "Rate limit exceeded. Retrying." } } }).text, /Échec : Rate limit exceeded/)
  assert.equal(phraseFor({ type: "session.execution.interrupted", data: {} }).text, "Interrompu.")
})

test("phraseFor : permission → phrase courte qui renvoie au dialog, pas à la voix", () => {
  const p = phraseFor({ type: "permission.asked", data: { action: "write" } })
  assert.match(p.text, /permission d’écrire un fichier/)
  assert.match(p.text, /à l’écran/)
})

test("phraseFor : bascule de modèle et saturation (router.notice)", () => {
  assert.match(phraseFor({ type: "router.notice", data: { text: "Modèle A indisponible → bascule sur Modèle B" } }).text, /passage sur le suivant/)
  assert.match(phraseFor({ type: "router.notice", data: { text: "indisponible et aucun autre modèle disponible" } }).text, /saturés/)
  // notice purement informative (changement de modèle par priorité, sans saturation) : rien à dire
  assert.equal(phraseFor({ type: "router.notice", data: { text: "Modèle : A → B (priorité code)" } }), null)
})

test("phraseFor : événements non pertinents ignorés (text delta, tools, etc.)", () => {
  assert.equal(phraseFor({ type: "session.text.delta", data: { delta: "hello" } }), null)
  assert.equal(phraseFor({ type: "session.tool.success", data: { id: "t" } }), null)
  assert.equal(phraseFor({ type: "unknown.event", data: {} }), null)
})

// ── Comportement de la file (coalescence, mute) ──────────────────────────────
function makeAnnouncer(over = {}) {
  const spoken = []
  const announcer = new Announcer({
    speak: async (text) => { spoken.push(text) },
    isMuted: () => false,
    ...over,
  })
  return { announcer, spoken }
}

test("les phrases sont parlées dans l'ordre, une par une", async () => {
  const { announcer, spoken } = makeAnnouncer()
  announcer.handle({ type: "session.execution.started", data: {} })
  await new Promise((r) => setTimeout(r, 5))
  announcer.handle({ type: "session.execution.succeeded", data: { tools: [] } })
  await new Promise((r) => setTimeout(r, 5))
  assert.deepEqual(spoken, ["C'est parti.", "Terminé."])
})

test("coalescence : deux succès rapprochés ne laissent qu'une annonce (fenêtre de stabilisation)", async () => {
  const spoken = []
  const slow = new Announcer({
    speak: async (t) => { await new Promise((r) => setTimeout(r, 15)); spoken.push(t) },
    isMuted: () => false,
    settleMs: 25, // fenêtre pendant laquelle la 2e annonce remplace la 1re
  })
  slow.handle({ type: "session.execution.succeeded", data: { tools: [] } }) // "Terminé."
  slow.handle({ type: "session.execution.succeeded", data: { tools: [{ name: "edit" }] } }) // "Terminé — 1 fichier modifié."
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(spoken.length, 1)
  assert.match(spoken[0], /Terminé/)
})

test("mute : une frappe coupe la voix et vide la file", async () => {
  let muted = false
  const spoken = []
  const slow = new Announcer({
    speak: async (t) => { await new Promise((r) => setTimeout(r, 15)); spoken.push(t) },
    isMuted: () => muted,
    settleMs: 20,
  })
  slow.handle({ type: "session.execution.succeeded", data: { tools: [] } })
  muted = true // l'utilisateur tape pendant la fenêtre de stabilisation
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(spoken.length, 0) // rien n'a été prononcé : coupé par le mute
  muted = false
  slow.handle({ type: "session.execution.started", data: {} }) // le mute levé, on reprend
  await new Promise((r) => setTimeout(r, 60))
  assert.deepEqual(spoken, ["C'est parti."])
})

test("mute forcé : mute() vide la file immédiatement", async () => {
  const { announcer, spoken } = makeAnnouncer()
  announcer.mute()
  announcer.handle({ type: "session.execution.started", data: {} })
  await new Promise((r) => setTimeout(r, 5))
  assert.deepEqual(spoken, [])
})

test("désactivé : plus rien n'est parlé, même si des événements arrivent", async () => {
  const { announcer, spoken } = makeAnnouncer()
  announcer.setEnabled(false)
  announcer.handle({ type: "session.execution.started", data: {} })
  announcer.handle({ type: "session.execution.succeeded", data: {} })
  await new Promise((r) => setTimeout(r, 5))
  assert.deepEqual(spoken, [])
  announcer.setEnabled(true)
  announcer.handle({ type: "session.execution.started", data: {} })
  await new Promise((r) => setTimeout(r, 5))
  assert.deepEqual(spoken, ["C'est parti."])
})

test("échec de la voix (SAPI absent) : erreur avalée, pas de crash, plus de discours", async () => {
  const failing = new Announcer({ speak: async () => { throw new Error("SAPI indisponible") }, isMuted: () => false })
  failing.handle({ type: "session.execution.started", data: {} })
  await new Promise((r) => setTimeout(r, 10)) // ne doit pas lever
  failing.handle({ type: "session.execution.succeeded", data: {} })
  await new Promise((r) => setTimeout(r, 10)) // non plus
})

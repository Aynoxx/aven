import assert from "node:assert/strict"
import { test } from "node:test"
import { ageLabel, resumeItems } from "../web/src/workbench/resume.ts"

// v12.1.0 : l'accueil ne reprend que du travail RÉEL. Ces tests fixent les trois
// refus : pas de ligne sans titre, pas d'âge négatif, pas de troisième entrée.

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0)
const min = (n) => n * 60_000
const hour = (n) => n * 3_600_000
const day = (n) => n * 86_400_000

test("resumeItems : la plus récente d'abord, tous types mêlés", () => {
  const items = resumeItems(
    {
      chats: [{ id: "c1", title: "Refonte du Poste", updated: NOW - hour(3) }],
      notes: [{ id: "n1", title: "Voix Pocket", updated: NOW - min(5) }],
    },
  ).map((item) => item.kind)
  assert.deepEqual(items, ["note", "conversation"])
})

test("resumeItems : deux entrées au maximum", () => {
  const items = resumeItems({
    chats: [
      { id: "c1", title: "Une", updated: NOW },
      { id: "c2", title: "Deux", updated: NOW - 1 },
      { id: "c3", title: "Trois", updated: NOW - 2 },
    ],
    notes: [{ id: "n1", title: "Note", updated: NOW - 3 }],
  })
  assert.equal(items.length, 2)
  assert.deepEqual(items.map((i) => i.id), ["c1", "c2"])
})

test("resumeItems : à âge égal, la conversation passe avant la note", () => {
  const items = resumeItems({
    chats: [{ id: "c1", title: "Conversation", updated: NOW }],
    notes: [{ id: "n1", title: "Note", updated: NOW }],
  })
  assert.equal(items[0].kind, "conversation")
})

test("resumeItems : une entrée sans titre ou sans identifiant n'est jamais reprise", () => {
  const items = resumeItems({
    chats: [{ id: "c1", title: "   ", updated: NOW }],
    notes: [{ id: "", title: "Sans identifiant", updated: NOW }],
  })
  assert.deepEqual(items, [])
})

test("resumeItems : une date absente ne classe pas l'entrée en tête", () => {
  const items = resumeItems({
    chats: [{ id: "ancienne", title: "Sans date" }],
    notes: [{ id: "n1", title: "Datée", updated: NOW - day(2) }],
  })
  assert.deepEqual(items.map((i) => i.id), ["n1", "ancienne"])
})

test("ageLabel : minutes, heures, hier, jours, date absolue", () => {
  assert.equal(ageLabel(NOW - 30_000, NOW), "à l’instant")
  assert.equal(ageLabel(NOW - min(12), NOW), "il y a 12 min")
  assert.equal(ageLabel(NOW - hour(3), NOW), "il y a 3 h")
  assert.equal(ageLabel(NOW - day(1), NOW), "hier")
  assert.equal(ageLabel(NOW - day(4), NOW), "il y a 4 j")
  assert.equal(ageLabel(Date.UTC(2026, 8, 12), NOW), "le 12/09")
})

test("ageLabel : une horloge en avance ne produit jamais un âge négatif", () => {
  assert.equal(ageLabel(NOW + hour(2), NOW), "à l’instant")
})

test("ageLabel : une date absente est dite, pas devinée", () => {
  assert.equal(ageLabel(0, NOW), "date inconnue")
  assert.equal(ageLabel(Number.NaN, NOW), "date inconnue")
})

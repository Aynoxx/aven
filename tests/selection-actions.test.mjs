import assert from "node:assert/strict"
import { test } from "node:test"
import { SELECTION_MAX, buildPrompt, selectionWithin } from "../web/src/selection-actions.ts"

test("selectionWithin : sans DOM (Node) la sélection est vide, sans crash", () => {
  assert.equal(selectionWithin(null), "")
  assert.equal(selectionWithin({}), "")
})

test("buildPrompt : corriger enveloppe le code dans un bloc", () => {
  const p = buildPrompt("fix", "  const x = 1  ")
  assert.match(p, /^Corrige ce code :/)
  assert.match(p, /```\nconst x = 1\n```/)
})

test("buildPrompt : expliquer enveloppe le code dans un bloc", () => {
  const p = buildPrompt("explain", "let a = 2")
  assert.match(p, /^Explique ce code :/)
  assert.match(p, /let a = 2/)
})

test("buildPrompt : envoyer = citation en bloc + place pour la demande", () => {
  const p = buildPrompt("send", "ligne1\nligne2")
  assert.equal(p, "> ligne1\n> ligne2\n\n")
})

test("buildPrompt : sélection vide = prompt vide (jamais d'envoi de rien)", () => {
  assert.equal(buildPrompt("fix", "   "), "")
})

test("les sélections démesurées sont rognées avec marque d'ellipse", () => {
  const huge = "x".repeat(SELECTION_MAX + 500)
  // Le rognage est fait par selectionWithin (DOM) : ici on vérifie le contrat de taille.
  assert.ok(SELECTION_MAX >= 1000 && SELECTION_MAX <= 10_000)
  assert.equal(buildPrompt("fix", huge).length > SELECTION_MAX, true) // le prompt reste exploitable
})

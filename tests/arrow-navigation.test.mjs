import assert from "node:assert/strict"
import { test } from "node:test"
import { nextArrowIndex, initialArrowIndex } from "../web/src/arrow-navigation.ts"

// Contrat de navigation clavier (RULES.md §12.2) : flèches avec bouclage, Home/End,
// toute autre touche = aucun changement (null), liste vide = null aussi.

test("nextArrowIndex : ArrowDown avance et boucle vers le premier", () => {
  assert.equal(nextArrowIndex("ArrowDown", -1, 4), 0) // rien de sélectionné → premier
  assert.equal(nextArrowIndex("ArrowDown", 0, 4), 1)
  assert.equal(nextArrowIndex("ArrowDown", 2, 4), 3)
  assert.equal(nextArrowIndex("ArrowDown", 3, 4), 0) // bouclage
})

test("nextArrowIndex : ArrowUp recule et boucle vers le dernier", () => {
  assert.equal(nextArrowIndex("ArrowUp", -1, 4), 3) // rien de sélectionné → dernier
  assert.equal(nextArrowIndex("ArrowUp", 2, 4), 1)
  assert.equal(nextArrowIndex("ArrowUp", 0, 4), 3) // bouclage
})

test("nextArrowIndex : Home et End sautent aux extrémités", () => {
  assert.equal(nextArrowIndex("Home", 2, 4), 0)
  assert.equal(nextArrowIndex("End", 1, 4), 3)
})

test("nextArrowIndex : autre touche ou liste vide = aucun changement", () => {
  assert.equal(nextArrowIndex("ArrowLeft", 1, 4), null)
  assert.equal(nextArrowIndex("Enter", 1, 4), null)
  assert.equal(nextArrowIndex("ArrowDown", 0, 0), null)
  assert.equal(nextArrowIndex("ArrowUp", -1, 0), null)
})

test("initialArrowIndex : premier item par défaut, item préféré sinon", () => {
  assert.equal(initialArrowIndex(4), 0)
  assert.equal(initialArrowIndex(4, 2), 2) // ex. projet actif présélectionné
  assert.equal(initialArrowIndex(0), -1)
  assert.equal(initialArrowIndex(2, 9), 0) // préféré hors bornes → premier
  assert.equal(initialArrowIndex(2, -1), 0)
})

// Tests v10.2.2 : affichage de l'aperçu d'une note (web/src/note-display.ts).
// Node pur : le helper ne touche ni au DOM ni à Tauri.
import assert from "node:assert/strict"
import { test } from "node:test"
import { stripLeadingTitle } from "../web/src/note-display.ts"

test("stripLeadingTitle retire le H1 qui répète le titre affiché", () => {
  assert.equal(stripLeadingTitle("# Idée\n\nCorps de la note.\n", "Idée"), "Corps de la note.\n")
  assert.equal(stripLeadingTitle("# IDÉE\nCorps\n", "idée"), "Corps\n") // casse ignorée
})

test("stripLeadingTitle ne touche pas un H1 différent", () => {
  const md = "# Un autre titre\n\nCorps"
  assert.equal(stripLeadingTitle(md, "Idée"), md)
  assert.equal(stripLeadingTitle("Corps sans titre", "Idée"), "Corps sans titre")
})

test("stripLeadingTitle gère un H1 sans corps", () => {
  assert.equal(stripLeadingTitle("# Idée", "Idée"), "")
})

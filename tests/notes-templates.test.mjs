import assert from "node:assert/strict"
import { test } from "node:test"
import { NOTE_TEMPLATES, templateById } from "../web/src/notes-templates.ts"

test("modèles : six documents réels, identifiants uniques", () => {
  assert.equal(NOTE_TEMPLATES.length, 6)
  assert.equal(new Set(NOTE_TEMPLATES.map((template) => template.id)).size, 6)
  for (const template of NOTE_TEMPLATES) {
    assert.ok(template.name.trim(), "un nom lisible")
    assert.ok(template.description.trim(), "une description")
    assert.match(template.markdown, new RegExp(`^# ${template.title}\\n`), `le modèle ${template.id} porte son titre`)
    assert.match(template.markdown, /^## /m, `le modèle ${template.id} propose une structure`)
    assert.ok(!/lorem|ipsum/i.test(template.markdown), "aucune fausse donnée")
  }
})

test("modèle : un identifiant inconnu ne devine rien", () => {
  assert.equal(templateById("idee")?.title, "Idée")
  assert.equal(templateById("inconnu"), undefined)
})

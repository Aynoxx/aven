import test from "node:test"
import assert from "node:assert/strict"
import { buildNoteTemplate, NOTE_TEMPLATES } from "../web/src/note-templates.ts"

test("les modèles sont disponibles et ont chacun un titre et un corps Markdown", () => {
  assert.deepEqual(NOTE_TEMPLATES.map((item) => item.id), ["idee", "reunion", "recherche", "journal", "projet", "article"])
  for (const template of NOTE_TEMPLATES) {
    const note = buildNoteTemplate(template.id, "31/10/2026")
    assert.ok(note)
    assert.ok(note.title.length > 0)
    assert.ok(note.markdown.startsWith("# " + note.title + "\n\n"))
    assert.ok(note.markdown.length > note.title.length + 5)
  }
})

test("les modèles datés remplacent la date au moment de la création", () => {
  const note = buildNoteTemplate("reunion", "31/10/2026")
  assert.equal(note.title, "Réunion du 31/10/2026")
  assert.ok(note.markdown.includes("Réunion du 31/10/2026"))
})

test("un modèle inconnu ne crée aucun document", () => {
  assert.equal(buildNoteTemplate("inconnu"), null)
})

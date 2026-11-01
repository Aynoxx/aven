// v12.8.0 : les repères sont des métadonnées locales indépendantes des notes.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { addHighlight, deleteHighlight, forgetHighlightsForNote, listHighlights, remapHighlightNote, remapHighlightPrefix } from "../host/notes-highlights.ts"
import { createFolder, getNote, saveNote } from "../host/notes.ts"

const makeWs = () => mkdtempSync(path.join(tmpdir(), "aven-highlights-"))

{
  const ws = makeWs()
  try {
    const note = saveNote(ws, "", "Unity", "Le maillage suit la phase.\n\nUne seconde phrase.")
    const highlight = addHighlight(ws, note.id, "  Le maillage\n suit la phase.  ")
    assert.equal(highlight.noteId, note.id)
    assert.equal(highlight.noteTitle, "Unity")
    assert.equal(highlight.quote, "Le maillage suit la phase.")
    assert.equal(listHighlights(ws).length, 1)
    assert.equal(deleteHighlight(ws, highlight.id), highlight.id)
    assert.deepEqual(listHighlights(ws), [])
    assert.equal(getNote(ws, note.id).title, "Unity", "supprimer le repère ne touche pas la note")
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

{
  const ws = makeWs()
  try {
    const note = saveNote(ws, "", "Projet", "Corps")
    const highlight = addHighlight(ws, note.id, "Corps")
    remapHighlightNote(ws, note.id, "projets/projet.md")
    const [moved] = listHighlights(ws)
    assert.equal(moved.id, highlight.id)
    assert.equal(moved.noteId, "projets/projet.md")
    assert.equal(moved.folder, "projets")
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

{
  const ws = makeWs()
  try {
    createFolder(ws, "projets")
    const note = saveNote(ws, "", "Projet", "Corps", "projets")
    addHighlight(ws, note.id, "Corps")
    remapHighlightPrefix(ws, "projets", "projets-2026")
    const [moved] = listHighlights(ws)
    assert.equal(moved.noteId, "projets-2026/projet.md")
    assert.equal(moved.folder, "projets-2026")
    assert.equal(listHighlights(ws).length, 1)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

{
  const ws = makeWs()
  try {
    const note = saveNote(ws, "", "À purger", "Corps")
    addHighlight(ws, note.id, "Corps")
    forgetHighlightsForNote(ws, `.trash/${note.id}`)
    assert.deepEqual(listHighlights(ws), [])
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

{
  const ws = makeWs()
  try {
    const note = saveNote(ws, "", "Valide", "Corps")
    assert.throws(() => addHighlight(ws, note.id, "   "), /Sélection vide/)
    assert.throws(() => addHighlight(ws, "inconnue.md", "x"), /introuvable/)
    assert.throws(() => deleteHighlight(ws, "absent"), /introuvable/)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { addHighlight, loadHighlights, removeHighlight, forgetNote } from "../host/notes-meta.ts"

const workspace = mkdtempSync(path.join(tmpdir(), "aven-highlights-"))
process.on("exit", () => { try { rmSync(workspace, { recursive: true, force: true }) } catch { /* Windows peut retarder */ } })

test("un highlight garde l'extrait, sa note source et sa date", () => {
  const saved = addHighlight(workspace, "recherche/notes.md", "Recherche", "Une phrase importante à conserver.")
  assert.equal(saved.noteId, "recherche/notes.md")
  assert.equal(saved.noteTitle, "Recherche")
  assert.equal(saved.quote, "Une phrase importante à conserver.")
  assert.ok(saved.createdAt > 0)
  assert.deepEqual(loadHighlights(workspace).map((item) => item.id), [saved.id])
})

test("un highlight vide ou avec un chemin invalide est refusé", () => {
  assert.throws(() => addHighlight(workspace, "../dehors.md", "Note", "Extrait"), /Note invalide/)
  assert.throws(() => addHighlight(workspace, "note.md", "Note", "   "), /Sélectionnez un extrait/)
})

test("un highlight peut être supprimé sans supprimer sa note", () => {
  const first = addHighlight(workspace, "note.md", "Note", "Premier extrait")
  addHighlight(workspace, "note.md", "Note", "Deuxième extrait")
  removeHighlight(workspace, first.id)
  assert.deepEqual(loadHighlights(workspace).map((item) => item.quote), ["Deuxième extrait"])
})

test("la purge d'une note supprime ses highlights de la bibliothèque", () => {
  addHighlight(workspace, "note-a.md", "A", "Citation A")
  addHighlight(workspace, "note-b.md", "B", "Citation B")
  forgetNote(workspace, ".trash/note-a.md")
  assert.deepEqual(loadHighlights(workspace).map((item) => item.noteId), ["note-b.md"])
})

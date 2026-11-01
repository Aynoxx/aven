// v12.8.0 : étiquettes libres et remappage des métadonnées au déplacement.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  forgetNote, loadAllLabels, loadAllTags, loadLabels, loadPinned, loadTags, normalizeLabels,
  remapNoteIds, remapNotePrefix, setLabels, setTags, togglePin,
} from "../host/notes-meta.ts"

const makeWs = () => mkdtempSync(path.join(tmpdir(), "aven-notes-labels-"))

{
  const labels = normalizeLabels([" Projet ", "projet", "Idée & suite", "  ", "Recherche", "A", "B", "C", "D", "E", "F"])
  assert.deepEqual(labels, ["Projet", "Idée & suite", "Recherche", "A", "B", "C", "D", "E"])
}

{
  const ws = makeWs()
  try {
    assert.deepEqual(loadLabels(ws, "note.md"), [])
    assert.deepEqual(setLabels(ws, "note.md", ["Projet", "projet", "Idée"]), ["Projet", "Idée"])
    assert.deepEqual(loadLabels(ws, "note.md"), ["Projet", "Idée"])
    assert.deepEqual(loadAllLabels(ws), { "note.md": ["Projet", "Idée"] })
    // Les deux systèmes restent séparés : un tag d'agent n'est pas une étiquette libre.
    setTags(ws, "note.md", ["code"])
    assert.deepEqual(loadTags(ws, "note.md"), ["code"])
    assert.deepEqual(loadLabels(ws, "note.md"), ["Projet", "Idée"])
    assert.deepEqual(loadAllTags(ws), { "note.md": ["code"] })
    // Une autre écriture de métadonnées ne perd pas les étiquettes.
    togglePin(ws, "note.md")
    assert.deepEqual(loadLabels(ws, "note.md"), ["Projet", "Idée"])
    setTags(ws, "note.md", ["projet"])
    assert.deepEqual(loadLabels(ws, "note.md"), ["Projet", "Idée"])
    setLabels(ws, "note.md", [])
    assert.deepEqual(loadLabels(ws, "note.md"), [])
    assert.throws(() => setLabels(ws, "../evil.md", ["x"]), /Note invalide/)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

{
  const ws = makeWs()
  try {
    setTags(ws, "ancien.md", ["code"])
    setLabels(ws, "ancien.md", ["Projet"])
    togglePin(ws, "ancien.md")
    remapNoteIds(ws, "ancien.md", "projets/ancien.md")
    assert.deepEqual(loadTags(ws, "ancien.md"), [])
    assert.deepEqual(loadLabels(ws, "ancien.md"), [])
    assert.deepEqual(loadTags(ws, "projets/ancien.md"), ["code"])
    assert.deepEqual(loadLabels(ws, "projets/ancien.md"), ["Projet"])
    assert.deepEqual(loadPinned(ws), ["projets/ancien.md"])
    forgetNote(ws, ".trash/projets/ancien.md")
    assert.deepEqual(loadTags(ws, "projets/ancien.md"), [])
    assert.deepEqual(loadLabels(ws, "projets/ancien.md"), [])
    assert.deepEqual(loadPinned(ws), [])
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

{
  const ws = makeWs()
  try {
    setTags(ws, "projets/a.md", ["code"])
    setLabels(ws, "projets/a.md", ["Projet"])
    togglePin(ws, "projets/a.md")
    setTags(ws, "projets/b.md", ["analyse"])
    setTags(ws, "autre.md", ["code"])
    remapNotePrefix(ws, "projets", "projets-2026")
    assert.deepEqual(loadTags(ws, "projets-2026/a.md"), ["code"])
    assert.deepEqual(loadLabels(ws, "projets-2026/a.md"), ["Projet"])
    assert.deepEqual(loadTags(ws, "projets-2026/b.md"), ["analyse"])
    assert.deepEqual(loadPinned(ws), ["projets-2026/a.md"])
    assert.deepEqual(loadTags(ws, "projets/a.md"), [])
    assert.deepEqual(loadTags(ws, "autre.md"), ["code"], "les ids hors préfixe ne bougent pas")
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

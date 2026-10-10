// Tests v9.3.0 : tags par agent des notes (host/notes-meta.ts).
// Node pur : pas de syntaxe TS dans les .mjs (piège connu), pas d'I/O partagées —
// chaque cas travaille dans son propre répertoire temporaire.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { loadTags, normalizeTags, setTags } from "../host/notes-meta.ts"

const makeWs = () => mkdtempSync(path.join(tmpdir(), "aven-notes-tags-"))

// normalizeTags : minuscules, sans accents, dédoublonné, borné.
{
  const out = normalizeTags(["Projet", " CODE ", "projet", "Recherche & veille", "", "  "])
  assert.deepEqual(out, ["projet", "code", "recherche-veille"])
}
{
  // Maximum 6 tags : le reste est silencieusement tronqué (défense côté main).
  const many = ["a", "b", "c", "d", "e", "f", "g", "h"]
  assert.equal(normalizeTags(many).length, 6)
}

// setTags + loadTags : cycle complet, bornes, écrasement, suppression.
{
  const ws = makeWs()
  try {
    assert.deepEqual(loadTags(ws, "note.md"), [])
    const saved = setTags(ws, "note.md", ["Projet", "code"])
    assert.deepEqual(saved, ["projet", "code"])
    assert.deepEqual(loadTags(ws, "note.md"), ["projet", "code"])
    // Écrasement complet.
    assert.deepEqual(setTags(ws, "note.md", ["analyse"]), ["analyse"])
    assert.deepEqual(loadTags(ws, "note.md"), ["analyse"])
    // Liste vide = tags supprimés.
    setTags(ws, "note.md", [])
    assert.deepEqual(loadTags(ws, "note.md"), [])
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

// Défense : identifiant avec traversée de chemin refusé ; le sous-dossier
// légitime est accepté (v10.1.0 : ids = chemins relatifs sûrs).
{
  const ws = makeWs()
  try {
    assert.throws(() => setTags(ws, "../evil.md", ["code"]), /Note invalide/)
    assert.deepEqual(setTags(ws, "dossier/note.md", ["code"]), ["code"])
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

console.log("notes-tags: OK")

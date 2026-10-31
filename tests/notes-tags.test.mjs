// Tests v9.3.0 : tags par agent des notes (host/notes-meta.ts).
// Node pur : pas de syntaxe TS dans les .mjs (piège connu), pas d'I/O partagées —
// chaque cas travaille dans son propre répertoire temporaire.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { forgetNote, loadAllLabels, loadAllTags, loadHighlights, loadLabels, loadPinned, loadTags, normalizeLabels, normalizeTags, rekeyNoteMetadata, setLabels, setTags, togglePin, addHighlight } from "../host/notes-meta.ts"

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
    assert.deepEqual(loadAllTags(ws), { "note.md": ["projet", "code"] })
    // v10.5.0 : le résultat en lot est copié et n'expose pas l'état interne.
    const all = loadAllTags(ws)
    all["note.md"].push("externe")
    assert.deepEqual(loadAllTags(ws), { "note.md": ["projet", "code"] })
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

// v10.2.2 : une note purgée quittait le disque mais gardait épinglage + tags dans
// notes-meta.json — le fichier devenait une liste d'ids fantômes.
{
  const ws = makeWs()
  try {
    setTags(ws, "ancienne.md", ["projet"])
    togglePin(ws, "ancienne.md")
    assert.deepEqual(loadTags(ws, "ancienne.md"), ["projet"])
    assert.ok(loadPinned(ws).includes("ancienne.md"))
    // La purge transmet l'id de la poubelle : l'oubli doit viser le chemin d'origine.
    forgetNote(ws, ".trash/ancienne.md")
    assert.deepEqual(loadTags(ws, "ancienne.md"), [])
    assert.ok(!loadPinned(ws).includes("ancienne.md"))
    // Les autres notes ne sont pas touchées par l'oubli.
    setTags(ws, "gardee.md", ["code"])
    togglePin(ws, "gardee.md")
    forgetNote(ws, "ancienne.md")
    assert.deepEqual(loadTags(ws, "gardee.md"), ["code"])
    assert.ok(loadPinned(ws).includes("gardee.md"))
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}


// v12.8.0 : les étiquettes libres restent indépendantes des tags d'agents.
{
  const ws = makeWs()
  try {
    const { loadAllLabels, loadLabels, normalizeLabels, setLabels } = await import("../host/notes-meta.ts")
    assert.deepEqual(normalizeLabels([" Projet personnel ", "Été", "projet personnel", "Recherche & veille", "", "!!!"]), [
      "projet-personnel", "ete", "recherche-veille",
    ])
    assert.equal(normalizeLabels(Array.from({ length: 20 }, (_, i) => "tag-" + i)).length, 12)
    setTags(ws, "note.md", ["recherche"])
    assert.deepEqual(setLabels(ws, "note.md", ["Projet", "personnel"]), ["projet", "personnel"])
    assert.deepEqual(loadTags(ws, "note.md"), ["recherche"], "les labels ne remplacent pas l'affectation agent")
    assert.deepEqual(loadLabels(ws, "note.md"), ["projet", "personnel"])
    const all = loadAllLabels(ws)
    all["note.md"].push("mutation externe")
    assert.deepEqual(loadAllLabels(ws), { "note.md": ["projet", "personnel"] })
    setLabels(ws, "autre.md", ["recherche"])
    assert.deepEqual(loadAllLabels(ws), { "note.md": ["projet", "personnel"], "autre.md": ["recherche"] })
    assert.throws(() => setLabels(ws, "../evil.md", ["code"]), /Note invalide/)
    forgetNote(ws, ".trash/note.md")
    assert.deepEqual(loadLabels(ws, "note.md"), [])
    assert.deepEqual(loadLabels(ws, "autre.md"), ["recherche"])
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}


{
  const ws = makeWs()
  try {
    setTags(ws, "projets/idee.md", ["recherche"])
    setLabels(ws, "projets/idee.md", ["important"])
    togglePin(ws, "projets/idee.md")
    addHighlight(ws, "projets/idee.md", "Idée", "À retenir")
    rekeyNoteMetadata(ws, "projets", ".trash/projets")
    assert.deepEqual(loadTags(ws, ".trash/projets/idee.md"), ["recherche"])
    assert.deepEqual(loadLabels(ws, ".trash/projets/idee.md"), ["important"])
    assert.ok(loadPinned(ws).includes(".trash/projets/idee.md"))
    assert.equal(loadHighlights(ws)[0].noteId, ".trash/projets/idee.md")
    rekeyNoteMetadata(ws, ".trash/projets", "archives/projets")
    assert.deepEqual(loadAllLabels(ws), { "archives/projets/idee.md": ["important"] })
    assert.deepEqual(loadAllTags(ws), { "archives/projets/idee.md": ["recherche"] })
    assert.equal(loadHighlights(ws)[0].noteId, "archives/projets/idee.md")
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

console.log("notes-tags: OK")

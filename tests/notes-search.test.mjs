import assert from "node:assert/strict"
import { test } from "node:test"
import { flattenTreeNotes, localSearchHits, mergeLibraryHits, noteFolder } from "../web/src/notes-search.ts"

const tree = [
  {
    type: "folder", id: "projets", name: "projets", children: [
      { type: "note", id: "projets/unity.md", name: "unity.md", title: "Unity", updated: 3 },
      { type: "note", id: "projets/montage.md", name: "montage.md", title: "Montage", updated: 2 },
    ],
  },
  { type: "note", id: "racine.md", name: "racine.md", title: "Racine", updated: 1 },
]

test("arbre : les notes gardent leur dossier et leur ordre", () => {
  assert.deepEqual(flattenTreeNotes(tree).map((note) => [note.id, note.folder]), [
    ["projets/unity.md", "projets"],
    ["projets/montage.md", "projets"],
    ["racine.md", ""],
  ])
  assert.equal(noteFolder("projets/unity.md"), "projets")
  assert.equal(noteFolder("racine.md"), "")
})

test("local : étiquettes, agents et repères réels", () => {
  const notes = flattenTreeNotes(tree)
  const hits = localSearchHits({
    query: "projet",
    notes,
    labels: { "projets/unity.md": ["Projet", "Scène"] },
    agentTags: { "projets/unity.md": ["code"] },
    agentNames: { code: "Code" },
    highlights: [{ id: "h1", noteId: "projets/unity.md", noteTitle: "Unity", folder: "projets", quote: "Le projet avance", createdAt: 1 }],
  })
  assert.equal(hits.filter((h) => h.kind === "label").length, 1)
  assert.equal(hits.filter((h) => h.kind === "agent").length, 0)
  assert.equal(hits.filter((h) => h.kind === "highlight").length, 1)
  assert.equal(hits.find((h) => h.kind === "label").title, "Unity")
})

test("fusion : filtre par nature, sans doublon et avec le dossier", () => {
  const notes = flattenTreeNotes(tree)
  const local = localSearchHits({
    query: "unity",
    notes,
    labels: {},
    agentTags: {},
    agentNames: {},
    highlights: [{ id: "h1", noteId: "projets/unity.md", noteTitle: "Unity", folder: "projets", quote: "Le projet avance", createdAt: 1 }],
  })
  const merged = mergeLibraryHits([{ id: "projets/unity.md", title: "Unity", snippet: "contenu", folder: "projets" }], local, "all")
  assert.equal(merged.filter((h) => h.kind === "note").length, 1)
  assert.equal(merged.filter((h) => h.kind === "highlight").length, 1)
  assert.equal(merged[0].kind, "note")
  assert.equal(mergeLibraryHits([{ id: "a.md", title: "A", snippet: "" }], [], "highlight").length, 0)
  assert.equal(mergeLibraryHits([{ id: "a.md", title: "A", snippet: "" }], [], "note")[0].folder, "")
})

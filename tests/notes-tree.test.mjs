import test from "node:test"
import assert from "node:assert/strict"
import { pruneNote } from "../web/src/notes-tree.ts"

// v12.6.0 : supprimer une note la retire de la vue immédiatement — l'arbre rendu
// ne doit plus la contenir, quel que soit son dossier.

const tree = () => [
  { type: "note", id: "a" },
  {
    type: "folder",
    id: "projets",
    children: [
      { type: "note", id: "b" },
      { type: "folder", id: "2026", children: [{ type: "note", id: "c" }, { type: "note", id: "d" }] },
    ],
  },
  { type: "folder", id: "inbox", children: [{ type: "note", id: "e" }] },
]

const ids = (nodes) => nodes.flatMap((n) => (n.type === "note" ? [n.id] : ids(n.children)))

test("pruneNote retire la note à la racine", () => {
  assert.deepEqual(ids(pruneNote(tree(), "a")), ["b", "c", "d", "e"])
})

test("pruneNote retire la note imbriquée, le dossier reste", () => {
  const pruned = pruneNote(tree(), "c")
  assert.deepEqual(ids(pruned), ["a", "b", "d", "e"])
  const year = pruned[1].children[1]
  assert.equal(year.type, "folder")
  assert.equal(year.id, "2026")
  assert.deepEqual(ids(year.children), ["d"])
})

test("pruneNote ne modifie pas l'arbre d'entrée", () => {
  const before = tree()
  const snapshot = JSON.stringify(before)
  pruneNote(before, "b")
  assert.equal(JSON.stringify(before), snapshot)
})

test("pruneNote ignore une note absente et garde les dossiers vides", () => {
  const pruned = pruneNote(tree(), "inconnue")
  assert.deepEqual(ids(pruned), ids(tree()))
  assert.equal(pruned.length, 3)
  assert.deepEqual(pruneNote(tree(), "e")[2].children, [])
})

import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  backlinks, cleanFolder, cleanNoteId, createFolder, deleteFolder, deleteNote, listArchived,
  listNotes, listTrash, moveNote, noteLinks, notesDir, notesTree, purgeNote, quickCapture,
  renameFolder, resolveWikilink, restoreNote, saveNote, archiveNote, unarchiveNote, searchNotes,
} from "../host/notes.ts"

const temp = mkdtempSync(path.join(tmpdir(), "aven-notes-v2-"))
process.on("exit", () => { try { rmSync(temp, { recursive: true, force: true }) } catch { /* Windows peut retarder */ } })

test("cleanNoteId : chemins relatifs sûrs uniquement", () => {
  assert.equal(cleanNoteId("idee.md"), "idee.md")
  assert.equal(cleanNoteId("projets/idee.md"), "projets/idee.md")
  assert.equal(cleanNoteId("projets\\idee.md"), "projets/idee.md")
  assert.equal(cleanNoteId("../evil.md"), null)
  assert.equal(cleanNoteId("a/../../b.md"), null)
  assert.equal(cleanNoteId("C:/absolu.md"), null)
  assert.equal(cleanNoteId("pas-de-md.txt"), null)
  assert.equal(cleanFolder(".."), "")
})

test("sous-dossiers : création dans un dossier + titre depuis le H1", () => {
  const racine = saveNote(temp, "", "Racine", "contenu racine")
  assert.equal(racine.id, "racine.md") // id dérivé du titre
  assert.equal(racine.title, "Racine")
  const dansDossier = saveNote(temp, "", "Idée brillante", "brouillon", "projets")
  assert.equal(dansDossier.id, "projets/idee-brillante.md")
  const ids = listNotes(temp).map((n) => n.id)
  assert.ok(ids.includes("racine.md") && ids.includes("projets/idee-brillante.md")) // récursif
})

test("arbre : dossiers et notes structurés façon Kortex", () => {
  const tree = notesTree(temp)
  const names = tree.map((n) => `${n.type}:${n.name}`).sort()
  assert.deepEqual(names, ["folder:projets", "note:racine.md"])
  const projets = tree.find((n) => n.type === "folder" && n.id === "projets")
  assert.equal(projets.children.length, 1)
  assert.equal(projets.children[0].type, "note")
  assert.equal(projets.children[0].title, "Idée brillante")
})

test("déplacement d'une note vers un dossier", () => {
  const moved = moveNote(temp, "racine.md", "projets")
  assert.equal(moved, "projets/racine.md")
  assert.ok(!existsSync(path.join(notesDir(temp), "racine.md")))
  const back = moveNote(temp, "projets/racine.md", "")
  assert.equal(back, "racine.md")
})

test("poubelle : delete → liste → restore conserve le chemin", () => {
  deleteNote(temp, "projets/idee-brillante.md")
  assert.ok(!existsSync(path.join(notesDir(temp), "projets/idee-brillante.md")))
  const trash = listTrash(temp)
  assert.equal(trash.length, 1)
  assert.ok(trash[0].id.startsWith(".trash/"))
  const restored = restoreNote(temp, trash[0].id)
  assert.equal(restored, "projets/idee-brillante.md")
  assert.deepEqual(listTrash(temp), [])
})

test("dossiers : renommage + suppression (contenu) vers la poubelle", () => {
  createFolder(temp, "projets/actuel")
  saveNote(temp, "", "Dans le dossier", "x", "projets/actuel")
  renameFolder(temp, "projets/actuel", "projets/nouveau")
  assert.ok(existsSync(path.join(notesDir(temp), "projets/nouveau")))
  deleteFolder(temp, "projets/nouveau")
  assert.ok(!existsSync(path.join(notesDir(temp), "projets/nouveau")))
  const trashed = listTrash(temp).filter((n) => n.id.includes("nouveau"))
  assert.equal(trashed.length, 1) // la note du dossier suit
  purgeNote(temp, trashed[0].id) // nettoyage définitif
})

test("archive : archiver puis restaurer", () => {
  archiveNote(temp, "racine.md")
  const archived = listArchived(temp).find((n) => n.id.includes("racine.md"))
  assert.ok(archived)
  assert.ok(!listNotes(temp).some((n) => n.id === "racine.md"))
  const back = unarchiveNote(temp, archived.id)
  assert.equal(back, "racine.md")
})

test("liens [[note]] : sortants résolus et backlinks", () => {
  saveNote(temp, "racine.md", "Racine", "# Racine\n\nVoir [[projets/idee-brillante]] pour le détail.\n")
  const links = noteLinks(temp, "racine.md")
  assert.equal(links.length, 1)
  assert.equal(links[0].resolved, "projets/idee-brillante.md")
  const backs = backlinks(temp, "projets/idee-brillante.md")
  assert.deepEqual(backs, ["racine.md"])
  assert.equal(resolveWikilink(temp, "Idée brillante"), "projets/idee-brillante.md")
  assert.equal(resolveWikilink(temp, "inexistante"), null)
})

test("recherche globale : titre + corps, accents neutralisés", () => {
  const hits = searchNotes(temp, "brouillon")
  assert.ok(hits.some((h) => h.id === "projets/idee-brillante.md"))
  assert.deepEqual(searchNotes(temp, "zzz-rien"), [])
})

test("quick capture : note datée dans Inbox/", () => {
  const note = quickCapture(temp, "", "pensée de passage")
  assert.ok(note.id.startsWith("Inbox/"))
  assert.match(note.markdown, /pensée de passage/)
})

test("sécurité : traversée refusée partout", () => {
  assert.throws(() => saveNote(temp, "../../evil.md", "x", "y"), /invalide/)
  assert.throws(() => deleteNote(temp, "../autre.md"), /invalide/)
  assert.throws(() => moveNote(temp, "racine.md", ".."), /invalide/)
})

console.log("notes-v2: OK")

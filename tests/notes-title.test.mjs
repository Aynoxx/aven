// v12.8.0 : le titre de la note est éditable dans la page. Le host doit donc
// écrire le H1 de tête depuis le champ titre, même quand le Markdown en contenait
// déjà un — sinon le titre affiché et le fichier divergent.
import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getNote, saveNote } from "../host/notes.ts"

const ws = mkdtempSync(path.join(tmpdir(), "aven-note-title-"))
process.on("exit", () => { try { rmSync(ws, { recursive: true, force: true }) } catch { /* Windows peut retarder */ } })

test("saveNote : le titre fourni remplace le H1 de tête", () => {
  const created = saveNote(ws, "", "Ancien titre", "Corps initial.")
  const updated = saveNote(ws, created.id, "Nouveau titre", "# Ancien titre\n\nCorps mis à jour.")
  assert.equal(updated.title, "Nouveau titre")
  assert.match(updated.markdown, /^# Nouveau titre\n\nCorps mis à jour\.\n$/)
  assert.ok(!updated.markdown.includes("# Ancien titre"), "le titre précédent ne reste pas dans le corps")
  assert.equal(getNote(ws, created.id).title, "Nouveau titre")
})

test("saveNote : un H1 interne ne remplace pas le titre de la note", () => {
  const note = saveNote(ws, "", "Titre", "Introduction.\n\n# Section\n\nSuite.")
  assert.match(note.markdown, /^# Titre\n\nIntroduction\./)
  assert.match(note.markdown, /# Section/)
  assert.equal(note.title, "Titre")
})

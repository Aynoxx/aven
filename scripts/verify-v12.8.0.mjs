// v12.8.0 : la refonte Notes est une convention durable, pas un écran jetable.
// La sonde fige les invariants qui font la différence : document édité directement,
// autosave, bibliothèque réelle, étiquettes libres, repères locaux, menus purs,
// wikilinks cliquables, focus de concentration et styles tokenisés.
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (file) => readFileSync(path.join(root, file), "utf8")
const pkg = JSON.parse(read("package.json"))
const readme = read("README.md")
const rules = read("AGENTS.md")
const appCss = read("web/src/App.css")
const notesCss = read("web/src/styles/notes.css")
const notesView = read("web/src/NotesView.tsx")
const noteDocument = read("web/src/notes/NoteDocument.tsx")
const templatePicker = read("web/src/notes/TemplatePicker.tsx")
const noteEditor = read("web/src/NoteEditor.tsx")
const notesMenu = read("web/src/notes-menu.ts")
const notesSearch = read("web/src/notes-search.ts")
const notesTemplates = read("web/src/notes-templates.ts")
const host = read("host/aven-app-host.ts")
const highlights = read("host/notes-highlights.ts")
const notesMeta = read("host/notes-meta.ts")
const types = read("web/src/types.ts")

assert.ok(pkg.scripts["verify:v12.8.0"] === "node scripts/verify-v12.8.0.mjs", "sonde v12.8.0 exposée")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v12.8.0.mjs"), "sonde v12.8.0 branchée dans npm run verify")
// AMENDEMENT v12.8.1 : la version courante vient de package.json ; la note v12.8.0,
// elle, reste vérifiée juste en dessous.
assert.ok(readme.startsWith(`# Aven v${pkg.version}`), "README annonce la version courante")
assert.match(readme, /v12\.8\.0 — Notes devient une bibliothèque et un document/, "note README présente")
assert.match(readme, /scripts\/verify-v12\.8\.0\.mjs/, "README cite la sonde")
assert.match(rules, /Notes est une bibliothèque et un document \(v12\.8\.0\)/, "AGENTS.md fixe la convention Notes")

for (const file of [
  "web/src/notes/NoteDocument.tsx",
  "web/src/notes/TemplatePicker.tsx",
  "web/src/notes-menu.ts",
  "web/src/notes-search.ts",
  "web/src/notes-templates.ts",
  "web/src/styles/notes.css",
  "host/notes-highlights.ts",
  "tests/notes-highlights.test.mjs",
  "tests/notes-meta-labels.test.mjs",
  "tests/notes-title.test.mjs",
  "tests/notes-templates.test.mjs",
  "tests/notes-menu.test.mjs",
  "tests/notes-search.test.mjs",
]) assert.ok(existsSync(path.join(root, file)), `${file} existe`)

assert.match(appCss, /@import "\.\/styles\/notes\.css";/, "notes.css entre dans la cascade")
assert.match(notesView, /from "\.\/notes\/NoteDocument"/, "NotesView ouvre le document")
assert.match(notesView, /from "\.\/notes\/TemplatePicker"/, "NotesView propose les modèles")
assert.match(notesView, /const AUTOSAVE_MS = 650/, "autosave court et nommé")
assert.match(notesView, /const flushDraft = useCallback/, "une seule sortie d'écriture")
assert.match(notesView, /api\.noteSave\(snapshot\.id, snapshot\.title, snapshot\.body\)/, "l'autosave écrit le vrai fichier")
assert.match(notesView, /api\.noteLabelsAll\(\)/, "les étiquettes sont chargées en lot")
assert.match(notesView, /api\.noteHighlights\(\)/, "les repères sont chargés avec la bibliothèque")
assert.match(noteDocument, /onTitleChange/, "le titre est éditable dans le document")
assert.match(noteDocument, /onHighlight/, "le document peut enregistrer un repère")
assert.match(noteDocument, /role="status"/, "l'état de sauvegarde est annoncé")
assert.match(noteDocument, /aria-label="Titre de la note"/, "le titre a un nom accessible")
assert.match(noteDocument, /attachTargetName/, "les actions de transfert nomment l'agent")
assert.match(templatePicker, /role="dialog"/, "le choix de modèle est un dialogue")
assert.match(templatePicker, /aria-modal="true"/, "le dialogue est modal")
assert.match(templatePicker, /aria-label="Créer depuis un modèle"/, "le dialogue est nommé")
assert.match(noteEditor, /Placeholder\.configure/, "le placeholder de commande est réel")
assert.match(noteEditor, /insertTable/, "les tableaux sont disponibles")
assert.match(noteEditor, /toggleTaskList/, "les listes de tâches sont disponibles")
assert.match(noteEditor, /WikilinkDecorations/, "les wikilinks sont décorés")
assert.match(noteEditor, /handleClick\(view, pos/, "les wikilinks sont cliquables")
assert.match(notesMenu, /export function slashQueryBefore/, "la requête / est pure et testée")
assert.match(notesMenu, /export function mentionQueryBefore/, "la requête @ est pure et testée")
assert.match(notesSearch, /export function localSearchHits/, "la recherche locale est pure")
assert.match(notesSearch, /export function mergeLibraryHits/, "la recherche fusionne sans doublon")
assert.match(notesTemplates, /export const NOTE_TEMPLATES/, "les modèles sont des documents réels")
assert.match(highlights, /export function addHighlight/, "les repères sont écrits atomiquement")
assert.match(highlights, /export function remapHighlightNote/, "les repères suivent un déplacement")
assert.match(notesMeta, /export function setLabels/, "les étiquettes libres sont stockées")
assert.match(notesMeta, /export function remapNoteIds/, "les métadonnées suivent un déplacement")
assert.match(host, /case "noteLabels"/, "le host expose les étiquettes")
assert.match(host, /case "noteHighlightAdd"/, "le host expose l'ajout de repère")
assert.match(host, /case "noteSetLabels"/, "le host expose l'écriture d'étiquettes")
assert.match(types, /export type NoteHighlight/, "le contrat IPC des repères est typé")
assert.match(notesCss, /\.notes-focus \.notes-library/, "le mode concentration masque la bibliothèque")
assert.match(notesCss, /\.note-doc-body/, "le document est une colonne de lecture")
assert.match(notesCss, /\.note-menu/, "les menus / et @ ont leur surface")
assert.doesNotMatch(notesCss, /#[0-9a-fA-F]{3,8}\b/, "notes.css ne code aucune couleur en dur")
assert.doesNotMatch(notesCss, /font-size:\s*\d+px/, "notes.css ne code aucune taille en dur")

console.log("v12.8.0 verification: OK (bibliothèque Notes, document autosauvegardé, repères, modèles, focus)")

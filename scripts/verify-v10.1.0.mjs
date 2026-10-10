import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

// Sondes v10.1.0 : ① mode de tâche de l'orchestrateur (Auto par défaut, délégation
// imposée posée en instruction de session OpenCode) ; ② notes façon Kortex (arbre,
// dossiers, poubelle, liens [[note]], recherche globale côté host, capture rapide) ;
// ③ éditeur TipTap (Markdown bidirectionnel) ; ④ capture rapide globale Ctrl+Shift+N.

const pkg = JSON.parse(read("package.json"))
const [vMaj, vMin, vPatch] = pkg.version.split(".").map(Number)
assert.ok(vMaj * 10000 + vMin * 100 + vPatch >= 100100, `version trop ancienne : ${pkg.version}`)

const taskMode = read("host/task-mode.ts")
const operations = read("host/operations.ts")
const main = read("host/aven-app-host.ts")
const notes = read("host/notes.ts")
const notesMeta = read("host/notes-meta.ts")
const types = read("web/src/types.ts")
const app = read("web/src/App.tsx")
const css = read("web/src/App.css")
const notesView = read("web/src/NotesView.tsx")
const noteEditor = read("web/src/NoteEditor.tsx")
const markdown = read("web/src/Markdown.tsx")
const lib = read("src-tauri/src/lib.rs")
const webPkg = JSON.parse(read("web/package.json"))
const readme = read("README.md")

// ── A. Mode de tâche : module pur + persistance par espace ─────────────────────
assert.match(taskMode, /export type TaskMode = "auto" \| "code" \| "analyse" \| "recherche"/)
assert.match(taskMode, /DEFAULT_TASK_MODE: TaskMode = "auto"/, "Auto par défaut : l'orchestrateur choisit")
assert.match(taskMode, /TASK_MODE_INSTRUCTION_KEY/, "clé d'instruction de session définie")
assert.match(taskMode, /loadTaskMode|saveTaskMode/, "persistance par espace (.opencode-app/task-mode.json)")
assert.match(taskMode, /taskModeInstruction/, "instruction de mode impérative")
assert.ok(existsSync(path.join(root, "tests/task-mode.test.mjs")), "tests du module task-mode attendus")

// ── B. Application du mode : instruction de session + fallback en tête de message ─
assert.match(operations, /async function applyTaskModeInstruction/, "pose du mode en instruction de session")
assert.match(operations, /session\.instructions\.entry\.put/, "API OpenCode instructions.entry.put utilisée")
assert.match(operations, /async taskMode\(\)/, "opération de lecture exposée")
assert.match(operations, /async setTaskMode/, "opération d'écriture exposée")
assert.match(operations, /loadTaskMode\(b\.workspace\)/, "le mode est relu à chaque envoi")
assert.match(operations, /if \(!applied && mode !== "auto"\)/, "fallback : l'instruction précède le message si l'API refuse")
assert.match(main, /case "taskMode"/, "dispatch host : lecture")
assert.match(main, /case "setTaskMode"/, "dispatch host : écriture")
assert.match(types, /taskMode: \(\) => Promise<TaskMode>/, "contrat renderer typé")
assert.match(types, /setTaskMode: \(mode: TaskMode\) => Promise<TaskMode>/)

// ── C. UI : UNE carte orchestrateur + switch segmenté (carte + conversation) ────
assert.match(app, /const TASK_MODES_UI = \[/, "les modes UI dérivent d'une constante unique")
assert.equal((app.match(/tasks-mode-switch/g) ?? []).length >= 2, true, "switch présent sur la carte Tâches ET le bandeau conversation")
assert.match(app, /aria-pressed=\{taskMode === m\.id\}/, "état actif exposé aux technologies d'assistance")
assert.match(app, /api\.taskMode\(\)\.then\(setTaskModeState\)/, "le mode est chargé au boot")
assert.match(css, /\.tasks-mode-switch \{/, "styles du switch")
assert.ok(!app.includes("tasks-mode-card"), "plus de cartes de modes séparées (figé v9.6.0)")

// ── D. Notes v2 : arbre, dossiers, poubelle, liens, recherche host ──────────────
assert.match(notes, /export function notesTree/, "arbre dossier/notes façon Kortex")
assert.match(notes, /TRASH_DIR = "\.trash"/, "poubelle sur disque")
assert.match(notes, /export function restoreNote|export function purgeNote/, "restauration et purge définitive")
assert.match(notes, /export function moveNote/, "déplacement note → dossier")
assert.match(notes, /export function resolveWikilink/, "résolution des liens [[note]]")
assert.match(notes, /export function backlinks/, "backlinks calculés")
assert.match(notes, /export function searchNotes/, "recherche globale côté host")
assert.match(notes, /export function quickCapture/, "capture rapide en écriture directe")
assert.match(notes, /cleanNoteId/, "ids en chemin relatif sûrs (anti-traversée)")
assert.match(notesMeta, /normalizeForSearch/, "recherche normalisée (accents/casse)")
assert.ok(existsSync(path.join(root, "tests/notes-v2.test.mjs")), "tests des notes v2 attendus")
for (const k of ["notesTree", "noteMove", "noteTrash", "noteSearch", "noteQuickCapture", "noteBacklinks"]) {
  assert.ok(main.includes(`case "${k}"`), `dispatch host : ${k}`)
}

// ── E. Éditeur TipTap + rendu des wikilinks ────────────────────────────────────
assert.ok(webPkg.dependencies?.["@tiptap/react"], "dépendance @tiptap/react installée dans web/")
assert.ok(webPkg.dependencies?.["tiptap-markdown"], "export Markdown bidirectionnel (tiptap-markdown)")
assert.match(noteEditor, /from "@tiptap\/react"/, "NoteEditor branché sur TipTap")
assert.match(noteEditor, /StarterKit/, "kit de base TipTap")
assert.match(notesView, /from "\.\/NoteEditor"/, "la vue Notes utilise l'éditeur riche")
assert.match(notesView, /api\.notesTree\(\)/, "arbre rendu côté renderer")
assert.match(notesView, /draggable/, "lignes déplaçables (drag & drop)")
assert.match(notesView, /onDrop/, "dossiers recevant le drop")
assert.match(notesView, /api\.noteSearch\(q\)/, "recherche globale déléguée au host")
assert.match(markdown, /onWikilink/, "les [[liens]] deviennent cliquables dans la vue Notes")

// ── F. Capture rapide globale : Ctrl+Shift+N (Rust) → événement → autoCapture ──
assert.match(lib, /Modifiers::CONTROL \| Modifiers::SHIFT\),\s*\r?\n\s*Code::KeyN/, "raccourci global Ctrl+Shift+N enregistré")
assert.match(lib, /"type": "quick-capture"/, "événement quick-capture émis vers le renderer")
assert.match(app, /ev\.type === "quick-capture"/, "le renderer écoute la demande de capture")
assert.match(app, /autoCapture=\{captureRequested\}/, "la capture est transmise à la vue Notes")
assert.match(notesView, /autoCapture/, "la vue Notes accepte la capture auto")
assert.match(notesView, /onCaptureHandled/, "l'auto-capture ne se rejoue pas (one-shot)")

// ── G. README : la version est documentée ──────────────────────────────────────
assert.match(readme, /v10\.1\.0/, "README : section v10.1.0")

console.log("v10.1.0 verification: OK")

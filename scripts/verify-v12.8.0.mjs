import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (relative) => readFileSync(path.join(root, relative), "utf8")
const exists = (relative) => existsSync(path.join(root, relative))

const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const cargo = read("src-tauri/Cargo.toml")
const notesMeta = read("host/notes-meta.ts")
const host = read("host/aven-app-host.ts")
const notes = read("host/notes.ts")
const view = read("web/src/NotesView.tsx")
const templates = read("web/src/note-templates.ts")
const types = read("web/src/types.ts")
const styles = read("web/src/styles/voice-notes.css")
const readme = read("README.md")
const agents = read("AGENTS.md")

assert.equal(pkg.version, "12.8.0", "package.json porte la version courante")
assert.equal(tauri.version, pkg.version, "Tauri suit package.json")
assert.equal(cargo.match(/^version = "([^"]+)"$/m)?.[1], pkg.version, "Cargo suit package.json")
assert.equal(pkg.scripts["verify:v12.8.0"], "node scripts/verify-v12.8.0.mjs", "la sonde a son entrée npm")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v12.8.0.mjs"), "npm run verify inclut la sonde")
assert.ok(readme.startsWith("# Aven v12.8.0\n"), "README annonce la version courante")
assert.ok(readme.includes("v12.8.0 — les notes deviennent une bibliothèque de connaissances"), "README documente la fonctionnalité")
assert.ok(agents.includes("Notes = bibliothèque de connaissances (v12.8.0)"), "AGENTS.md fixe le contrat des notes")

// Étiquettes de contenu indépendantes des affectations aux agents.
for (const symbol of ["loadLabels", "loadAllLabels", "setLabels", "normalizeLabels", "rekeyNoteMetadata"]) {
  assert.ok(notesMeta.includes("export function " + symbol), "notes-meta exporte " + symbol)
}
assert.ok(host.includes('case "noteSetLabels"'), "IPC d'étiquetage libre")
assert.ok(host.includes('case "noteLabelsAll"'), "chargement en lot des étiquettes")
assert.ok(types.includes("noteSetLabels:"), "OpenCodeApi type les étiquettes libres")
assert.ok(view.includes("notes-labels-editor"), "l'éditeur affiche les étiquettes")
assert.ok(view.includes("aria-label=\"Filtrer par étiquette\""), "les étiquettes filtrent l'arborescence")

// Recherche dans titres, corps, tags d'agents, labels libres et highlights.
assert.ok(notes.includes("metadata.tags?.[n.id]"), "recherche dans tags d'agents")
assert.ok(notes.includes("metadata.labels?.[n.id]"), "recherche dans étiquettes libres")
assert.ok(notes.includes("metadata.highlights"), "recherche dans les extraits conservés")
assert.ok(host.includes("highlights: loadHighlights(workspace)"), "dispatch recherche indexe les highlights")

// Highlights : citation courte, provenance réelle, navigation et purge cohérentes.
for (const symbol of ["loadHighlights", "addHighlight", "removeHighlight"]) {
  assert.ok(notesMeta.includes("export function " + symbol), "notes-meta exporte " + symbol)
}
assert.ok(host.includes("const note = getNote(workspace, String(params?.[0] ?? \"\"))"), "le host valide la note source d'un highlight")
assert.ok(host.includes("rekeyNoteMetadata(workspace, from, moved)"), "un déplacement conserve les références")
assert.ok(host.includes("rekeyNoteMetadata(workspace, from, archived)"), "un archivage conserve les références")
assert.ok(view.includes("Capturer l'extrait"), "l'interface capture une sélection")
assert.ok(view.includes("noteHighlightAdd"), "l'interface enregistre l'extrait")
assert.ok(view.includes("highlights.map((item)"), "la bibliothèque liste les extraits")
assert.ok(view.includes("open(item.noteId)"), "un highlight ouvre sa note source")

// Modèles, gestion des dossiers et mode concentration.
assert.equal((templates.match(/id: "(?:idee|reunion|recherche|journal|projet|article)"/g) ?? []).length, 6, "six modèles Markdown intégrés")
assert.ok(view.includes("buildNoteTemplate"), "les modèles sont utilisés dans l'interface")
assert.ok(view.includes("renameFolder"), "renommer les dossiers est exposé")
assert.ok(view.includes("removeFolder"), "mettre les dossiers à la poubelle est exposé")
assert.ok(view.includes("Mode concentration"), "mode concentration disponible")
assert.ok(styles.includes(".notes-layout.focus-mode"), "le mode concentration masque le panneau latéral")

// Les tests doivent exister et rester dans le glob du runner Node.
for (const file of [
  "tests/notes-tags.test.mjs",
  "tests/notes-v2.test.mjs",
  "tests/notes-highlights.test.mjs",
  "tests/note-templates.test.mjs",
]) assert.ok(exists(file), "test présent : " + file)

console.log("v12.8.0 verification: OK (labels, highlights, recherche, modèles, dossiers, focus)")

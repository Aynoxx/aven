import { readApp, readStyles } from "./lib/sources.mjs"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

// Sondes v9.3.0 : restructuration — hub reformé (3 étages), vues Notes/Fichiers
// intégrées, Usage dans les Réglages, renommage « Espaces », prompt orchestrateur.

const pkg = JSON.parse(read("package.json"))
const [vMaj, vMin, vPatch] = pkg.version.split(".").map(Number)
assert.ok(vMaj * 10000 + vMin * 100 + vPatch >= 90300, `version trop ancienne : ${pkg.version}`)

const app = readApp()
const css = readStyles()
const main = read("host/aven-app-host.ts") // v10.0.0 : remplace le main Electron
const preload = read("web/src/types.ts") // v10.0.0 : remplace le preload (contrat OpenCodeApi)
const types = read("web/src/types.ts")
const settings = read("web/src/SettingsDialog.tsx")
const notesMeta = read("host/notes-meta.ts")
const notes = read("host/notes.ts")
const filesModule = read("host/workspace-files.ts")
const notesView = read("web/src/NotesView.tsx")
const filesView = read("web/src/FilesView.tsx")
const agentProjet = read(".opencode/agents/projet.md")
const readme = read("README.md")
// v11.0.0 : le hub a cédé la place au Poste — les entrées sont les instruments
// du rail et les tuiles d'Aujourd'hui. Les intentions v9.3.0 restent figées.
const workbench = read("web/src/workbench/WorkbenchShell.tsx")
const homeBoard = read("web/src/workbench/HomeStage.tsx")

// A. Les quatre destinations restent nommées ; Usage vit dans Réglages.
// v11.0.0 : les clés internes du hub disparaissent avec lui.
assert.match(workbench, /kind: "terminal", label: "Terminal"/)
assert.match(workbench, /kind: "orchestration", label: "Orchestration"/)
assert.match(workbench, /kind: "files", label: "Fichiers"/)
assert.match(workbench, /kind: "notes", label: "Notes"/)
assert.ok(!/kind: "stats"/.test(app), "aucune entrée Statistiques dans le Poste (→ Réglages/Usage)")
assert.ok(!/\.hub-card \{/.test(css), "le hub orbital et ses cartes ont disparu")

// B. L'état Freebuff reste visible (le second assistant n'est pas enterré).
assert.match(app, /freebuffPillState/, "l'état Freebuff vit dans le contrôleur")
assert.match(app, /freebuffPtyActive/, "l'état actif lit le PTY embarqué")

// C. Renommage « Espaces » (affichage seul — IPC workspace:* inchangé).
// v9.6.0 : le modal espaces du hub est retiré — la gestion vit dans Réglages → Configuration.
assert.ok(!app.includes('aria-label="Gérer les espaces"'), "le raccourci espaces a quitté le hub (v9.6.0)")
// v9.6.0 : l'eyebrow ESPACES du modal hub a disparu avec le modal (Réglages).
// v9.6.0 : les avis « Espace actif » vivaient dans le modal retiré.
assert.match(settings, /<h4>Espaces de travail<\/h4>/, "Réglages : section « Espaces de travail » (v10.5.0)")
assert.ok(!/Changer de projet/.test(app), "l'ancien libellé « Changer de projet » a disparu")

// D. Notes : vue complète remplaçant le modal (rendu, édition, tags, joindre).
assert.ok(existsSync(path.join(root, "web/src/NotesView.tsx")), "NotesView.tsx attendu")
assert.ok(!existsSync(path.join(root, "web/src/NotesDialog.tsx")), "NotesDialog.tsx supprimé")
// v11.0.0 : le rendu vit dans la coquille du Poste (workbench/).
assert.match(workbench, /import NotesView from "\.\.\/NotesView"/)
assert.ok(!/NotesDialog/.test(app), "plus aucune référence au modal NotesDialog dans App.tsx")
assert.match(notesView, /Markdown/, "la vue Notes rend le Markdown (plus de <pre> brut)")
assert.match(notesView, /noteSave/, "édition intégrée (notes:save)")
assert.match(notesView, /noteSetTags/, "tags par agent (notes:setTags)")
assert.match(notesView, /Joindre à \{activeAgentName\}/, "l'action de transfert nomme l'agent ciblé")
assert.match(notesView, /onClick=\{\(\) => attach\(selected, false\)\}/, "le transfert prépare toujours le texte dans le composeur")
assert.match(notes, /export function saveNote/, "saveNote (création/édition de vrais fichiers .md)")
assert.match(notesMeta, /MAX_NOTE_TAGS/, "tags bornés")
assert.match(main, /case "noteSave"/)
assert.match(main, /case "noteSetTags"/)
assert.match(preload, /noteSave/)
assert.match(preload, /noteSetTags/)
assert.match(types, /noteSave/)

// E. Fichiers : explorateur intégré cloisonné (safeResolve est LA barrière).
assert.ok(existsSync(path.join(root, "web/src/FilesView.tsx")), "FilesView.tsx attendu")
assert.match(workbench, /import FilesView from "\.\.\/FilesView"/)
assert.match(filesModule, /export function safeResolve/, "la barrière de cloisonnement est factorisée")
assert.match(filesModule, /path\.relative/, "le contrôle final est path.relative (seule vérité)")
assert.match(filesModule, /MAX_TEXT_BYTES/, "aperçu texte borné")
assert.match(filesView, /Préparer une analyse/, "pont fichier → agent")
assert.match(filesView, /filesOpen/, "l'Explorateur Windows reste accessible d'un clic")
assert.match(main, /case "filesList"/)
assert.match(main, /case "filesRead"/)
assert.match(main, /case "filesOpen"/)
assert.match(preload, /filesList/)
assert.match(types, /filesList/)
assert.ok(existsSync(path.join(root, "tests/workspace-files.test.mjs")), "tests du module fichiers attendus")
assert.ok(existsSync(path.join(root, "tests/notes-tags.test.mjs")), "tests des tags attendus")

// F. Statistiques → onglet « Usage » des Réglages (module host/stats.ts inchangé).
assert.match(settings, /"usage"/)
assert.match(settings, /renderUsage/, "l'onglet Usage rend les statistiques")
assert.match(settings, /getStats/, "les données stats passent par l'IPC existant")
assert.ok(!/showStats/.test(app), "plus de panneau stats dans le hub")

// G. Routes vocales alignées sur la nouvelle carte.
assert.match(app, /case "open-workspace":[\s\S]*?openFilesView/, "la voix ouvre l'explorateur intégré")
assert.match(app, /case "open-stats":[\s\S]*?openConfiguration\(undefined, "usage"\)/, "la voix ouvre Réglages → Usage")

// H. Orchestrateur : prompt de délégation enrichi.
assert.match(agentProjet, /Protocole d'orchestration/, "le protocole v9.3.0 est dans le prompt")
assert.match(agentProjet, /délègue/, "rôle de délégation conservé")

// I. README : la carte des features est réécrite.
assert.match(readme, /Usage/, "README : Usage mentionné")
assert.match(readme, /Espaces/, "README : Espaces mentionnés")

console.log("v9.3.0 verification: OK")

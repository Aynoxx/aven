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

const app = read("web/src/App.tsx")
const css = read("web/src/App.css")
const main = read("electron/main.ts")
const preload = read("electron/preload.cts")
const types = read("web/src/types.ts")
const settings = read("web/src/SettingsDialog.tsx")
const notesMeta = read("electron/notes-meta.ts")
const notes = read("electron/notes.ts")
const filesModule = read("electron/workspace-files.ts")
const notesView = read("web/src/NotesView.tsx")
const filesView = read("web/src/FilesView.tsx")
const agentProjet = read(".opencode/agents/projet.md")
const readme = read("README.md")

// A. Hub reformé : 5 cartes (Faire ×3 + Contenu ×2), Statistiques sortie du cercle.
assert.match(app, /key: "project", label: "Projet"/)
assert.match(app, /key: "agents", label: "Agents"/)
assert.match(app, /key: "freebuff", label: "Freebuff"/)
assert.match(app, /key: "files", label: "Fichiers"/)
assert.match(app, /key: "notes", label: "Notes"/)
assert.ok(!/key: "stats"/.test(app), "la carte Statistiques a quitté le cercle du hub (→ Réglages/Usage)")
assert.match(css, /--hub-angle:72deg/, "5 cartes à 72° attendues")
assert.ok(!/\.hub-card-stats \{ --hub-angle/.test(css), "plus d'angle pour la carte stats supprimée")

// B. Pastille d'état Freebuff dans le hub (le second assistant devient visible).
assert.match(app, /freebuff-pill/, "pastille Freebuff attendue dans le hub")
assert.match(app, /freebuffPtyActive/, "l'état actif lit le PTY embarqué")
assert.match(css, /\.freebuff-pill/)

// C. Renommage « Espaces » (affichage seul — IPC workspace:* inchangé).
assert.match(app, /Gérer les espaces/, "modal du hub renommé")
assert.match(app, /eyebrow">ESPACES/, "eyebrow ESPACES attendu")
assert.match(app, /Espace actif :/, "les avis du hub parlent d'« espace »")
assert.match(settings, /<h4>Espaces<\/h4>/, "Réglages : section « Espaces »")
assert.ok(!/Changer de projet/.test(app), "l'ancien libellé « Changer de projet » a disparu")

// D. Notes : vue complète remplaçant le modal (rendu, édition, tags, joindre).
assert.ok(existsSync(path.join(root, "web/src/NotesView.tsx")), "NotesView.tsx attendu")
assert.ok(!existsSync(path.join(root, "web/src/NotesDialog.tsx")), "NotesDialog.tsx supprimé")
assert.match(app, /import NotesView from "\.\/NotesView"/)
assert.ok(!/NotesDialog/.test(app), "plus aucune référence au modal NotesDialog dans App.tsx")
assert.match(notesView, /Markdown/, "la vue Notes rend le Markdown (plus de <pre> brut)")
assert.match(notesView, /noteSave/, "édition intégrée (notes:save)")
assert.match(notesView, /noteSetTags/, "tags par agent (notes:setTags)")
assert.match(notesView, /Joindre à la conversation/, "injection dans le composeur")
assert.match(notes, /export function saveNote/, "saveNote (création/édition de vrais fichiers .md)")
assert.match(notesMeta, /MAX_NOTE_TAGS/, "tags bornés")
assert.match(main, /notes:save/)
assert.match(main, /notes:setTags/)
assert.match(preload, /noteSave/)
assert.match(preload, /noteSetTags/)
assert.match(types, /noteSave/)

// E. Fichiers : explorateur intégré cloisonné (safeResolve est LA barrière).
assert.ok(existsSync(path.join(root, "web/src/FilesView.tsx")), "FilesView.tsx attendu")
assert.match(app, /import FilesView from "\.\/FilesView"/)
assert.match(filesModule, /export function safeResolve/, "la barrière de cloisonnement est factorisée")
assert.match(filesModule, /path\.relative/, "le contrôle final est path.relative (seule vérité)")
assert.match(filesModule, /MAX_TEXT_BYTES/, "aperçu texte borné")
assert.match(filesView, /Faire analyser par un agent/, "pont fichier → agent")
assert.match(filesView, /filesOpen/, "l'Explorateur Windows reste accessible d'un clic")
assert.match(main, /files:list/)
assert.match(main, /files:read/)
assert.match(main, /files:open/)
assert.match(preload, /filesList/)
assert.match(types, /filesList/)
assert.ok(existsSync(path.join(root, "tests/workspace-files.test.mjs")), "tests du module fichiers attendus")
assert.ok(existsSync(path.join(root, "tests/notes-tags.test.mjs")), "tests des tags attendus")

// F. Statistiques → onglet « Usage » des Réglages (module electron/stats.ts inchangé).
assert.match(settings, /"usage"/)
assert.match(settings, /renderUsage/, "l'onglet Usage rend les statistiques")
assert.match(settings, /getStats/, "les données stats passent par l'IPC existant")
assert.ok(!/showStats/.test(app), "plus de panneau stats dans le hub")

// G. Routes vocales alignées sur la nouvelle carte.
assert.match(app, /case "open-workspace":[\s\S]*?openFilesView/, "la voix ouvre l'explorateur intégré")
assert.match(app, /case "open-stats":[\s\S]*?setSettingsSection\("usage"\)/, "la voix ouvre Réglages → Usage")

// H. Orchestrateur : prompt de délégation enrichi.
assert.match(agentProjet, /Protocole d'orchestration/, "le protocole v9.3.0 est dans le prompt")
assert.match(agentProjet, /délègue/, "rôle de délégation conservé")

// I. README : la carte des features est réécrite.
assert.match(readme, /Usage/, "README : Usage mentionné")
assert.match(readme, /Espaces/, "README : Espaces mentionnés")

console.log("v9.3.0 verification: OK")

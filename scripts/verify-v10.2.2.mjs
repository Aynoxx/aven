import { readApp, readStyles } from "./lib/sources.mjs"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Sondes v10.2.2 : corrections mesurées en pilotant l'app (docs/audits/2026-10-19-test-live-features.md).
// Chaque assertion verrouille un défaut constaté, pas une intention :
//  ① les wikilinks écrits par l'éditeur riche arrivent NON échappés sur le disque ;
//  ② le menu du modèle est mesuré (côté qui a de la place), jamais hors écran ;
//  ③ la recherche du hub filtre réellement les conversations ;
//  ④ conversations et renommage restent joignables sans la barre latérale ;
//  ⑤ Freebuff nomme un CLI absent au lieu d'un faux démarrage ;
//  ⑥ accessibilité (onglets, barre de sélection, composeur) et notes (épingle,
//     titre, dossiers vides, métadonnées purgées) tiennent.
// verify-docs exige un scripts/verify-v<version>.mjs par version : c'est ce fichier.
// Écrit en invariants (pas de numéro figé) pour survivre aux bumps suivants.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const [vMaj, vMin, vPatch] = pkg.version.split(".").map(Number)
assert.ok(vMaj * 10000 + vMin * 100 + vPatch >= 100202, `version trop ancienne : ${pkg.version}`)

const notes = read("host/notes.ts")
const meta = read("host/notes-meta.ts")
const host = read("host/aven-app-host.ts")
const app = readApp()
const notesView = read("web/src/NotesView.tsx")
const noteEditor = read("web/src/NoteEditor.tsx")
const freebuff = read("web/src/FreebuffAgentPage.tsx")
const settings = read("web/src/SettingsDialog.tsx")
const css = readStyles()
const readme = read("README.md")

// ── A. Chaîne de versions et documentation ─────────────────────────────────────
assert.equal(JSON.parse(read("src-tauri/tauri.conf.json")).version, pkg.version,
  "tauri.conf.json aligné sur package.json")
assert.equal(pkg.scripts["verify:v10.2.2"], "node scripts/verify-v10.2.2.mjs", "script dédié exposé")
assert.ok(pkg.scripts.verify.includes("verify-v10.2.2.mjs"),
  "la sonde entre dans la chaîne npm run verify (AGENTS.md §11)")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replace(/\./g, "\\.")}`, "m"),
  "README : titre de version")
assert.match(readme, /v10\.2\.2 — /, "README : note de version v10.2.2")
assert.match(readme, /verify-v10\.2\.2\.mjs/, "README : la sonde est citée")

// ── B. Wikilinks : le disque reçoit « [[note]] », pas « \[\[note\]\] » ──────────
// tiptap-markdown échappe les crochets ; sans restauration, noteLinks/backlinks
// d'une note enregistrée ne résolvaient plus (défaut P0 mesuré).
assert.match(notes, /export function restoreWikilinks/, "notes.ts expose restoreWikilinks (testé)")
assert.match(notes, /const body = restoreWikilinks\(String\(markdown \?\? ""\)\)/,
  "saveNote restaure les wikilinks AVANT d'écrire (seul endroit qui décide du disque)")
assert.match(noteEditor, /e\.storage\.markdown\.getMarkdown\(\)/,
  "l'éditeur continue d'exporter du Markdown standard (l'échappement est absorbé côté host)")

// ── C. Menu du modèle : direction mesurée + libellé sain ──────────────────────
assert.match(app, /modelButtonRef/, "le bouton du modèle est mesuré avant d'ouvrir")
assert.match(app, /const dir: "up" \| "down" = above >= 220 && above > below \? "up" : "down"/,
  "la bulle s'ouvre du côté qui a de la place (plus de menu hors écran)")
assert.match(css, /\.model-select-menu\.down \{ top: calc\(100% \+ 6px\); bottom: auto;/,
  "la variante « vers le bas » existe en CSS")
assert.match(app, /usableModelRef\(currentModel\)/, "le modèle affiché est filtré (plus de « null/ »)")
assert.match(app, /AUTO_MODEL_LABEL/, "une conversation sans modèle est nommée « Auto »")

// ── D. Barre de commande : la recherche filtre, les conversations restent
// joignables, F2 renomme dans l'inspecteur (v11.0.0 : le hub a quitté le Poste). ──
const workbench = read("web/src/workbench/WorkbenchShell.tsx")
const commandBar = read("web/src/workbench/CommandBar.tsx")
assert.match(commandBar, /rankByQuery\(chats, q, \(c\) => c\.title \|\| "Conversation"\)/,
  "la barre de commande classe les conversations par titre, sans dépendre de la casse locale")
assert.match(commandBar, /Rechercher une conversation, une note/,
  "la barre distingue la recherche de la rédaction d'une demande")
assert.match(read("web/src/workbench/omnibox.ts"), /open-conversations/,
  "les commandes portent une entrée « conversations »")
assert.match(workbench, /chatId && renamingChat === chatId/,
  "F2 renomme dans l'inspecteur, même barre latérale masquée")
assert.match(css, /\.wb-input/, "le champ de renommage du Poste est stylé")
assert.match(commandBar, /openHomeConversation\(chat\)/, "le résultat ouvre la conversation existante")

// ── E. Freebuff : un CLI absent est nommé, pas déguisé en démarrage ────────────
// v10.3.0 : la page lit le gestionnaire PARTAGÉ (vérification + installation au
// démarrage) au lieu de sonder le CLI elle-même.
assert.match(freebuff, /api\.freebuffCliEnsure\(\)/, "la page vérifie le CLI avant de lancer")
assert.match(freebuff, /CLI Freebuff non installé/, "l'état nomme le CLI absent")
assert.match(freebuff, /ensureCli/, "un bouton Installe le CLI depuis la page")
assert.match(freebuff, /disabled=\{!presence\.online\}/, "« Interrompre » est désactivé sans session")

// ── F. Accessibilité mesurée ───────────────────────────────────────────────────
// v11.0.0 : les sections de Réglages sont des boutons d'inspecteur nommés.
assert.match(workbench, /aria-label="Sections des réglages"/, "les sections Réglages sont un groupe nommé")
assert.match(workbench, /aria-selected=\{settingsSection === id\}/, "chaque section expose aria-selected")
assert.match(settings, /aria-pressed=\{appearance\.theme === value\}/, "le thème expose aria-pressed")
assert.match(settings, /aria-label=\{`Clé API \$\{p\.label\}`\}/, "les champs de clés sont nommés")
assert.match(app, /aria-label="Message à l[’']agent"/, "le composeur est nommé")
assert.match(workbench, /aria-label="Citer la sélection dans le composeur"/, "la barre de sélection est nommée")
assert.match(app, /if \(selBarRef\.current\) \{ setSelBar\(null\); return \}/,
  "Échap ferme la barre de sélection avant d'interrompre le tour")
assert.match(workbench, /<option value="">Auto — le routeur choisit<\/option>/,
  "le sélecteur de modèle expose l'option Auto")

// ── G. Notes : épingle, aperçu, dossiers vides, purge ─────────────────────────
assert.ok(!/["'`]📌/.test(notesView), "l'arbre des notes n'affiche plus d'emoji (icône <Icon name=\"pin\">)")
assert.match(notesView, /<Icon name="pin"/, "l'épingle est une icône de la bibliothèque")
assert.match(notesView, /stripLeadingTitle\(selected\.markdown, selected\.title\)/,
  "l'aperçu ne répète pas le titre (H1 retiré à l'affichage)")
assert.match(notes, /const walkFolders/, "notesTree scanne les dossiers, pas seulement les notes")
assert.match(meta, /export function forgetNote/, "notes-meta expose forgetNote")
assert.ok(meta.includes('clean.replace(/^\\.(?:trash|archive)\\//, "")'),
  "forgetNote normalise l'id de poubelle vers le chemin d'origine")
assert.match(host, /forgetNote\(requireWorkspace\(\), rel\)/,
  "notePurge oublie épinglage et tags de la note purgée")

console.log("v10.2.2 verification: OK")

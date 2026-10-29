import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readStyles } from "./lib/sources.mjs"

// Sonde v11.0.0 — le Poste remplace le hub et les pages. Conventions figées ici :
//   A. Une seule fenêtre : bandeau, rail, onglets, scène, inspecteur, barre de commande.
//   B. La navigation est un modèle pur d'onglets (`workbench/tabs.ts`) : Aujourd'hui ne
//      se ferme pas, un instrument n'a qu'un onglet, une conversation peut en avoir
//      plusieurs, et le clavier (flèches, Ctrl+W) suit le même chemin.
//   C. La barre de commande est le seul point d'entrée global : recherche, `>` commandes,
//      `/` portées — jamais d'envoi implicite ; le micro global est le seul à exécuter.
//   D. La DA « DRONE » vit dans `da.css` (jetons uniques) et la charpente dans
//      `workbench.css` ; les surfaces mortes du hub et des pages ont été retirées.
//   E. La version et sa note README sont publiées ensemble, avec la sonde au pipeline.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const has = (p) => existsSync(path.join(root, p))

const pkg = JSON.parse(read("package.json"))
const lock = JSON.parse(read("package-lock.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const cargo = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const readme = read("README.md")
const rules = read("AGENTS.md")
const css = readStyles()
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, "")

const shell = read("web/src/workbench/WorkbenchShell.tsx")
const home = read("web/src/workbench/HomeStage.tsx")
const command = read("web/src/workbench/CommandBar.tsx")
const tabs = read("web/src/workbench/tabs.ts")
const omnibox = read("web/src/workbench/omnibox.ts")
const actions = read("web/src/workbench/actions.ts")
const instrument = read("web/src/InstrumentFrame.tsx")
const controller = read("web/src/app/use-aven-app.ts")
const da = read("web/src/styles/da.css")
const workbenchCss = read("web/src/styles/workbench.css")

// ── A. Le cadre permanent ────────────────────────────────────────────────────
assert.match(shell, /className="wb-status"/, "bandeau de télémétrie permanent")
// v12.0.0 : le rail permanent a disparu. La navigation primaire est une
// CONSTELLATION temporaire : aucun meuble ne survit à la fermeture de l'arc.
assert.doesNotMatch(shell, /className="wb-rail"/, "aucun rail permanent")
assert.match(shell, /<NavigationConstellation/, "la coquille rend la constellation")
assert.match(read("web/src/workbench/constellation.ts"), /export function arcLayout/, "l'arc est un module pur")
assert.match(shell, /role="tablist" aria-label="Onglets du Poste"/, "barre d'onglets nommée")
assert.match(shell, /className="wb-stage" id="wb-stage" role="tabpanel"/, "scène = panneau de l'onglet actif")
assert.match(shell, /className="wb-inspector"/, "inspecteur permanent")
assert.match(shell, /<CommandBar app=\{app\} \/>/, "barre de commande permanente")
// v12.0.0 : plus de rail à déployer — la poignée ouvre la même constellation,
// que l'on soit à l'accueil ou dans un espace de travail.
assert.match(shell, /open={navOpen}/, "la poignée pilote l'ouverture de la constellation")

// Le cadre ne défile pas ; le scroll vit dans les conteneurs de contenu.
assert.match(cssCode, /\.wb-app \{[^}]*overflow: hidden;/, "le Poste ne défile pas globalement")

// Un instrument = InstrumentFrame, jamais une page plein écran ni un dialogue.
for (const file of ["web/src/NotesView.tsx", "web/src/FilesView.tsx", "web/src/pages/TasksPage.tsx", "web/src/FreebuffAgentPage.tsx", "web/src/SettingsDialog.tsx"]) {
  assert.match(read(file), /<InstrumentFrame|import InstrumentFrame/, `${file} rend un instrument`)
}
assert.match(instrument, /role="toolbar" aria-label=/, "les actions d'instrument sont nommées")

// L'inspecteur porte le contexte : session (titre, renommage F2), modèle, mode, sections.
assert.match(shell, /aria-label="Titre de la conversation"/, "le titre de session est éditable dans l'inspecteur")
assert.match(shell, /Renommer la conversation \(F2\)/, "F2 retrouve son affordance dans l'inspecteur")
assert.match(shell, /aria-label="Modèle de la conversation"/, "le modèle se choisit dans l'inspecteur")
assert.match(shell, /aria-label="Sections des réglages"/, "les sections de Réglages vivent dans l'inspecteur")

// ── B. Modèle d'onglets pur, testé, branché ──────────────────────────────────
assert.match(tabs, /^\/\/ v11\.0\.0 : modèle d'onglets/m, "tabs.ts est le modèle du Poste")
assert.match(tabs, /export function initialTabs/, "l'onglet initial est Aujourd'hui")
assert.match(tabs, /if \(tab\.kind === "home"\) return state/, "Aujourd'hui ne se ferme pas")
assert.match(tabs, /export function openInstrument/, "un instrument n'a qu'un onglet")
assert.match(tabs, /MAX_CONVERSATION_TABS = 8/, "les onglets de conversation sont bornés")
assert.match(tabs, /export function bindChat/, "une session chargée se rattache à l'onglet")
assert.match(tabs, /export function nextTabFocus/, "la navigation clavier est pure")
assert.match(read("tests/workbench-tabs.test.mjs"), /nextTabFocus/, "le modèle a ses tests")
assert.match(read("tests/workbench-actions.test.mjs"), /planFor/, "les verbes ont leurs tests")
assert.match(read("tests/omnibox.test.mjs"), /parseOmnibox/, "la barre de commande a ses tests")
assert.match(shell, /nextTabFocus\(e\.key, index, tabsState\.tabs\.length\)/, "la barre d'onglets branche le modèle")
// v11.1.0 : le × de chaque onglet a été retiré (barre allégée, plan approuvé) ;
// fermer un onglet reste possible au clavier et suit le modèle pur `closeTab`.
assert.match(controller, /e\.key\.toLowerCase\(\) === "w"[\s\S]{0,160}closePage\(\)/, "Ctrl+W ferme l'onglet actif")
assert.match(tabs, /export function closeTab/, "le modèle d'onglets expose closeTab")
assert.match(shell, /document\.getElementById\(`wb-tab-\$\{id\}`\)\?\.focus\(\)/, "le focus suit l'onglet sélectionné")

// Le contrôleur ne garde pas les booléens de page d'avant : l'état est un tab set.
assert.match(controller, /const \[tabsState, setTabsState\] = useState<TabsState>\(initialTabs\)/, "un seul état d'onglets")
assert.match(controller, /const activeInstrument = activeWorkbenchTab\(tabsState\)/, "l'instrument actif dérive des onglets")
assert.match(controller, /e\.key\.toLowerCase\(\) === "w"[\s\S]{0,240}closePage\(\)/, "Ctrl+W ferme l'onglet, pas la fenêtre")
assert.match(controller, /e\.key\.toLowerCase\(\) === "k"[\s\S]{0,160}\.wb-command-input/, "Ctrl+K donne le focus à la barre de commande")

// ── C. Barre de commande et dictée ───────────────────────────────────────────
assert.match(omnibox, /export function parseOmnibox/, "les trois modes (`rien`, `>`, `/`) sont purs")
assert.match(omnibox, /export function matchCommands/, "les commandes sont une liste fermée")
assert.match(command, /role="combobox"/, "la saisie est un combobox nommé")
assert.match(command, /role="listbox" aria-label="Résultats de la barre de commande"/, "les résultats sont un listbox nommé")
assert.match(command, /nextArrowIndex\(e\.key, active, results\.length\)/, "les flèches suivent le module pur")
assert.match(command, /if \(!q\) \{ setNotes\(\[\]\); return \}/, "aucune recherche implicite sur une saisie vide")
assert.match(command, /openConversationInstrument/, "la barre ouvre les conversations sans créer de session")
assert.doesNotMatch(command, /setInput\(/, "la barre de commande n'écrit jamais dans le composeur")
assert.doesNotMatch(command, /api\.(send|prompt|createChat)/, "la barre ne crée ni n'envoie de conversation")

assert.match(command, /dictation\.start\("workbench"\)/, "le micro global déclare la même provenance")
assert.match(controller, /effectiveIntent\(result\.intent, origin, agents\.map\(\(a\) => a\.id\)\)/, "la provenance décide avant toute action")
assert.match(controller, /setInput\(text\)/, "une dictée ordinaire rejoint le composeur")
const dictationBlock = controller.slice(controller.indexOf("onText: async"), controller.indexOf("onError:"))
assert.ok(dictationBlock.length > 0, "le callback de dictée est localisé")
assert.ok(!/api\.[a-zA-Z]*[sS]end\(/.test(dictationBlock), "aucun envoi implicite après une dictée")

// Les verbes du Poste préparent, ils n'envoient pas.
assert.match(actions, /mode: "compose"/, "transmettre prépare le composeur")
assert.doesNotMatch(actions, /mode: "send"/, "aucun mode d'envoi implicite")
assert.match(shell, /planFor\("cite"/, "citer une réponse crée une note")

// ── D. DA et surfaces ────────────────────────────────────────────────────────
assert.match(da, /--font-mono: ui-monospace/, "la deuxième voix est monospace système")
// v12.0.0 : l'orange braise du brief remplace le #ff5a00 de la DA DRONE. Un seul
// accent dans le Poste — la règle tient, sa valeur change.
assert.match(da, /--accent: #d77a43;/, "un seul accent orange braise")
// La DA ne vaut que si le boot ne l'écrase pas : `appearance.ts` posait l'accent
// Émeraude par défaut, donc l'interface rendait du vert sur le champ olive pendant
// que cette sonde lisait la feuille. Le défaut suit désormais le signal.
assert.match(read("web/src/appearance.ts"), /accent: "signal"/, "l'accent par défaut est le signal orange")
assert.match(read("web/src/appearance.ts"), /signal: \{ label: "Orange braise", value: "#d77a43" \}/, "le preset signal vit dans la table des accents")
assert.match(da, /--radius-xs: 2px;/, "la géométrie est resserrée par la DA")
assert.match(da, /:root\[data-theme="light"\]/, "la DA fournit les deux thèmes")
assert.match(da, /@media \(prefers-reduced-motion: reduce\)/, "la DA neutralise le mouvement")
assert.match(workbenchCss, /\.wb-status \{/, "workbench.css porte la charpente")
assert.match(workbenchCss, /\.wb-command-results \{/, "les résultats de commande sont une surface propre")

// Aucune valeur de police en dur (la sonde des conventions couvre tout le barrel).
for (const value of [...cssCode.matchAll(/(?<![-\w])font-size:\s*([^;}]+)/g)].map((m) => m[1])) {
  assert.ok(!/\d+px/.test(value.replace(/var\(--font-size-\w+\)/g, "")), `font-size en dur : ${value}`)
}

// Les surfaces mortes du hub et des pages ont été retirées, pas laissées en décor.
for (const gone of ["web/src/PageShell.tsx", "web/src/app/AppShell.tsx", "web/src/pages/HomePage.tsx", "web/src/view-transitions.ts", "web/src/app/with-view-transition.ts", "web/src/styles/home.css", "tests/view-transitions.test.mjs"]) {
  assert.equal(has(gone), false, `${gone} a disparu avec la v11.0.0`)
}
assert.ok(!cssCode.includes("view-transition-name"), "aucun nom de transition de vue ne subsiste")
assert.ok(!cssCode.includes(".page-main"), "aucune charpente de page ne subsiste")
assert.ok(!read("web/src/App.css").includes('@import "./styles/home.css"'), "App.css n'importe plus la feuille du hub")

// La doc décrit l'architecture réelle.
assert.match(rules, /Poste de travail/, "AGENTS.md §6 nomme le Poste")
assert.match(rules, /InstrumentFrame/, "AGENTS.md §6 cite la charpente des instruments")
assert.match(rules, /web\/src\/workbench\/tabs\.ts/, "AGENTS.md §6 cite le modèle d'onglets")
assert.match(rules, /Barre de commande et nouvelle conversation \(v11\.0\.0\)/, "AGENTS.md §6 fixe la barre de commande")
assert.match(readme, /v11\.0\.0 — le Poste/, "README porte la note de version")

// ── E. Version publiée, sonde branchée ───────────────────────────────────────
// v11.0.1 : cette sonde est devenue historique — elle vérifie désormais que les
// manifestes s'accordent entre eux, plus un numéro figé qui bloquerait chaque patch
// (même convention que la sonde v10.5.0, qui interdit déjà un pin dans v10.4.0).
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(lock.version, pkg.version, "package-lock.json correspond")
assert.equal(lock.packages[""].version, pkg.version, "le paquet racine du lock est synchronisé")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit la version")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit la version")
assert.match(cargoLock, new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`), "Cargo.lock suit la version")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.0.0.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.0.0"], "node scripts/verify-v11.0.0.mjs", "la sonde est accessible directement")

console.log("v11.0.0 verification: OK (Poste, onglets, barre de commande, DA, version)")

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readApp } from "./lib/sources.mjs"

// Sonde v10.4.0 — deux conventions nouvelles, figées ici :
//   A. Une dictée a une PROVENANCE (hub / composeur) : le composeur transcrit
//      toujours dans la chatbox, le hub exécute la commande demandée. La page Projet
//      est une destination distincte des espaces et du dossier.
//   B. Un seul retour par écran : la conversation garde « Accueil » dans la barre de
//      fenêtre, les pages portent leur « Fermer » ; la barre n'affiche pas l'entrée
//      de la page où l'on se trouve déjà (Paramètres dans Réglages).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const intent = read("host/voice-intent.ts")
const voice = read("host/voice.ts")
const routing = read("web/src/dictation-routing.ts")
const dictation = read("web/src/voice-dictation.ts")
const app = readApp()
// v11.0.0 : la coquille est le Poste (workbench/), plus AppShell.
const appShell = read("web/src/workbench/WorkbenchShell.tsx")
const conversation = read("web/src/pages/ConversationPage.tsx")
const home = read("web/src/workbench/HomeStage.tsx")
const commandBar = read("web/src/workbench/CommandBar.tsx")
const tasks = read("web/src/pages/TasksPage.tsx")
const freebuff = read("web/src/FreebuffAgentPage.tsx")
const notes = read("web/src/NotesView.tsx")
const files = read("web/src/FilesView.tsx")
const settings = read("web/src/SettingsDialog.tsx")
const tests = read("tests/dictation-routing.test.mjs")
const intentTests = read("tests/voice-intent.test.mjs")

// ── Version publiée ─────────────────────────────────────────────────────────────
// v10.5.0 : cette sonde vérifie les comportements conservés de v10.4.0 ;
// la version courante est contrôlée par verify-v10.5.0.mjs.
assert.ok(pkg.scripts.verify.includes("scripts/verify-v10.4.0.mjs"), "npm run verify conserve la sonde historique v10.4.0")

// ── A1. La page Projet est une destination vocale à part entière ────────────────
assert.match(intent, /export const APP_ACTIONS = \["open-project",/, "open-project entre dans la liste fermée")
assert.match(intent, /"new-chat", "go-home"\]/, "go-home entre dans la liste fermée")
assert.match(intent, /- « ouvre Freebuff » ou « ouvre le terminal Freebuff » = open-project \(page Terminal Freebuff\), PAS les Réglages/,
  "la commande vocale ouvre la page Terminal Freebuff plutôt que les Réglages")
assert.match(intent, /- « ouvre les espaces de travail »[^\n]*= open-projects/,
  "le prompt distingue les espaces de travail")
assert.match(intent, /- « ouvre le dossier du projet »[^\n]*= open-workspace/,
  "le prompt distingue le dossier du projet")
// Le motif de destination générique « projet » reste après les motifs plus
// spécifiques « dossier de projet » et « espaces de travail ». La route Freebuff
// ajoutée en v10.5.0 peut, elle, apparaître plus tôt.
const iWorkspace = intent.indexOf('action: "open-workspace"')
const iProjects = intent.indexOf('action: "open-projects"')
const iAmbiguousProject = intent.indexOf('projets?\\b/i, intent: { intent: "chat" }')
assert.ok(iWorkspace > 0 && iProjects > 0 && iAmbiguousProject > 0, "les trois routes existent dans le filet")
assert.ok(iWorkspace < iAmbiguousProject && iProjects < iAmbiguousProject,
  "« dossier du projet » et « espaces » sont reconnus avant le refus du projet ambigu")
assert.match(intent, /action: "go-home"/, "le filet connaît le retour à l'accueil")

// Un motif de commande l'emporte sur un verdict de modèle divergent (bug mesuré).
assert.match(voice, /result\.intent = deterministic \?\? classified/,
  "la décision déterministe prime sur le classifieur pour éviter une navigation ambiguë")
assert.match(intentTests, /un motif de commande prime sur une action modèle divergente/,
  "le comportement d'arbitrage est testé")

// ── A2. La provenance décide, dans un module pur testé ──────────────────────────
assert.match(routing, /^\/\/ Pur : testable avec Node seul, sans dépendance desktop\./m,
  "dictation-routing.ts reste un module pur (AGENTS.md §8)")
assert.match(routing, /export function effectiveIntent\(/, "la décision est une fonction pure exportée")
assert.match(routing, /if \(origin === "composer"\) return \{ intent: "chat" \}/,
  "le composeur ne déclenche jamais d'action")
assert.match(routing, /intent\.target && agentIds\.includes\(intent\.target\)/,
  "une cible d'agent inconnue ne bascule nulle part")
assert.match(tests, /effectiveIntent/, "le module a son test .test.mjs")

assert.match(dictation, /export type DictationOrigin|DictationOrigin =/, "la provenance est typée")
assert.match(dictation, /onText: \(result: DictationResult, origin: DictationOrigin\) => void/,
  "le callback de dictée reçoit la provenance")
assert.match(dictation, /originRef = useRef<DictationOrigin>\("composer"\)/,
  "la provenance est retenue pour le clip en cours")
assert.match(dictation, /onText\(result, originRef\.current\)/, "le résultat est routé avec sa provenance")

assert.match(app, /import \{ effectiveIntent \} from "\.\.\/dictation-routing"/,
  "le contrôleur branche le module pur")
assert.match(app, /effectiveIntent\(result\.intent, origin, agents\.map\(\(a\) => a\.id\)\)/,
  "l'intention effective est calculée à partir de la provenance")
assert.match(app, /const c = await api\.createChat\(tabRef\.current\)/,
  "la conversation n'est créée qu'à l'arrivée d'un texte (plus de conversation vide)")
assert.match(commandBar, /dictation\.start\("workbench"\)/, "le micro global déclare la même provenance")
assert.match(conversation, /dictation\.start\("composer"\)/, "le micro du composeur déclare la sienne")

// ── B1. Le cadre est permanent : plus de barre de fenêtre à faire suivre ───────
// v11.0.0 : le Poste remplace la barre contextuelle — un seul cadre, des onglets.
assert.match(appShell, /role="tablist" aria-label="Onglets du Poste"/,
  "les onglets forment une barre nommée")
// v12.0.0 : le bandeau ne liste que des conversations — la scène n'est un
// `tabpanel` que lorsqu'un de ces onglets est affiché (sinon : région nommée).
assert.match(appShell, /role=\{stageIsTab \? "tabpanel" : "region"\}/,
  "la scène est le panneau de l'onglet actif quand il existe")
assert.match(appShell, /Fermer l’onglet/,
  "fermer un onglet est nommé")
assert.ok(!/Accueil<\/button>/.test(appShell),
  "aucun retour dupliqué « Accueil » ne subsiste dans la coquille")

// ── B2. Un seul retour par écran : l'onglet est LA sortie ─────────────────────
for (const [name, source] of [["Notes", notes], ["Fichiers", files], ["Réglages", settings], ["Tâches", tasks], ["Freebuff", freebuff]]) {
  assert.ok(!/key: "close"/.test(source), `${name} : aucun second bouton Fermer`)
  assert.ok(!/className: "dialog-close"/.test(source), `${name} : plus de classe de fermeture de page`)
}

// Les deux conventions sont écrites dans les règles, pas seulement dans le code.
const rules = read("AGENTS.md")
assert.match(rules, /Un seul retour par écran \(v10\.4\.0/, "AGENTS.md §6 énonce le retour unique")
assert.match(rules, /Une dictée a une provenance \(v10\.4\.0\)/, "AGENTS.md §6 énonce la provenance de la dictée")

console.log("v10.4.0 verification: OK (provenance de dictée, page Projet distincte, une seule sortie par écran)")

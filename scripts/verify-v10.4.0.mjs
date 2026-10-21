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
const appShell = read("web/src/app/AppShell.tsx")
const conversation = read("web/src/pages/ConversationPage.tsx")
const home = read("web/src/pages/HomePage.tsx")
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
// L'ordre du filet déterministe est une garantie : « dossier du projet » et
// « espaces de travail » doivent être testés AVANT le motif « projet » générique.
const iWorkspace = intent.indexOf('action: "open-workspace"')
const iProjects = intent.indexOf('action: "open-projects"')
const iProject = intent.indexOf('action: "open-project"')
assert.ok(iWorkspace > 0 && iProjects > 0 && iProject > 0, "les trois routes existent dans le filet")
assert.ok(iWorkspace < iProject && iProjects < iProject,
  "« dossier du projet » et « espaces » passent avant le motif « projet » (sinon Réglages)")
assert.match(intent, /action: "go-home"/, "le filet connaît le retour à l'accueil")

// Un motif de commande l'emporte sur un verdict de modèle divergent (bug mesuré).
assert.match(voice, /deterministic\?\.intent === "app"/,
  "le filet de commande prime sur l'action du modèle (sinon « ouvre le projet » rouvre les Réglages)")
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
assert.match(home, /dictation\.start\("hub"\)/, "le micro du hub déclare sa provenance")
assert.match(conversation, /dictation\.start\("composer"\)/, "le micro du composeur déclare la sienne")

// ── B1. La barre de fenêtre suit la page ────────────────────────────────────────
assert.match(appShell, /\{!showSettings && \([\s\S]{0,300}Ouvrir les paramètres d’apparence/,
  "« Paramètres » disparaît de la barre quand on est dans Réglages")
assert.match(appShell, /const isPage = showNotes \|\| showFiles \|\| showSettings \|\| showAgentsPage \|\| showFreebuffAgent/,
  "les pages sont identifiées comme un groupe")
assert.match(appShell, /!isPage && \([\s\S]{0,300}Accueil/,
  "« Accueil » n'est proposé que devant une conversation")
assert.match(appShell, /<FreebuffAgentPage onError=\{fail\} onClose=\{closePage\} \/>/,
  "la page Freebuff reçoit son propre retour")

// ── B2. Un seul retour par écran ────────────────────────────────────────────────
for (const [name, source] of [["Notes", notes], ["Fichiers", files], ["Réglages", settings], ["Tâches", tasks], ["Freebuff", freebuff]]) {
  assert.match(source, /className: "dialog-close"/, `${name} : la page porte son retour (« Fermer »)`)
  assert.match(source, /key: "close"/, `${name} : le retour est une action déclarée`)
}
assert.ok(!conversation.includes(">Accueil<"),
  "la conversation n'a plus un second bouton Accueil dans sa barre de titre")
assert.ok(!/back-home-button[\s\S]{0,160}Accueil/.test(conversation),
  "aucun retour dupliqué ne subsiste dans la conversation")

// Les deux conventions sont écrites dans les règles, pas seulement dans le code.
const rules = read("AGENTS.md")
assert.match(rules, /Un seul retour par écran \(v10\.4\.0\)/, "AGENTS.md §6 énonce le retour unique")
assert.match(rules, /Une dictée a une provenance \(v10\.4\.0\)/, "AGENTS.md §6 énonce la provenance de la dictée")

console.log("v10.4.0 verification: OK (provenance de dictée, page Projet distincte, une seule sortie par écran)")

import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.14.1 : deux défauts d'attention, une même exigence — le Poste ne répond
// pas à ce qui ne lui est pas adressé, et il ne perd pas la conversation qu'on
// regarde. Ce que la sonde fige :
//   A. la décision « cette parole m'est-elle adressée ? » vit dans un module PUR,
//      sans réseau ni horloge, qui écarte hésitations, hallucinations du STT et
//      remarques ambiantes ;
//   B. elle est consultée AVANT la prolongation de la veille et AVANT le LLM, et
//      une parole écartée reçoit « ignoré » (aucune réponse) ;
//   C. supprimer la conversation ouverte laisse un onglet de CONVERSATION actif
//      quand une autre reste — jamais un voisin (Notes, Aujourd'hui…) ;
//   D. la doc dit les deux règles et la note de version est en tête du README.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const exists = (p) => existsSync(path.join(root, p))
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const lock = JSON.parse(read("package-lock.json"))
const cargo = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const readme = read("README.md")

// ── Version cohérente dans tous les manifestes ─────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(lock.version, pkg.version, "package-lock.json correspond à package.json")
assert.equal(lock.packages[""].version, pkg.version, "le paquet racine du lock est synchronisé")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(cargoLock, new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`), "Cargo.lock suit package.json")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.14.1.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.14.1"], "node scripts/verify-v11.14.1.mjs", "la sonde a son entrée npm")

// ── A. La décision d'adresse : un module pur, fermé, sans réseau ───────────
assert.ok(exists("host/voice-agent-addressed.ts"), "la décision vit dans host/voice-agent-addressed.ts")
const addressed = read("host/voice-agent-addressed.ts")
assert.match(addressed, /Pur : testable avec Node seul/, "le module se déclare pur")
assert.doesNotMatch(addressed, /fetch\(|https?:\/\/|Date\.now\(|performance\.now\(/,
  "aucun réseau ni horloge : une décision d'adresse ne paie pas de latence")
assert.match(addressed, /export function classifyVoiceAddress\(\s*text: string,\s*options\?: \{ expectsAnswer\?: boolean \},?\s*\): VoiceAddressVerdict/,
  "le verdict est une fonction pure exportée, avec son contexte de question")
assert.match(addressed, /export const AMBIENT_MAX_WORDS = \d+/, "le seuil de longueur est une constante exportée")
assert.match(addressed, /options\?\.expectsAnswer \? "addressed" : "filler"/,
  "« oui » n'est adressé que si Aven vient de poser une question")
assert.match(addressed, /expectsAnswer\?: boolean/, "le contexte de question est un paramètre, pas une devinette")
assert.match(addressed, /STT_HALLUCINATIONS/, "les hallucinations du STT sur le silence ont une liste fermée")
assert.match(addressed, /FILLER_TOKENS/, "les hésitations ont une liste fermée")
assert.match(addressed, /"filler"/, "le verdict « filler » existe")
assert.match(addressed, /return \"ambient\"/, "une remarque courte sans marque est classée ambiante")
assert.ok(exists("tests/voice-agent-addressed.test.mjs"), "le module a son test .test.mjs")
const addressedTests = read("tests/voice-agent-addressed.test.mjs")
assert.match(addressedTests, /une vraie demande reste adressée/, "le test fige qu'une vraie demande passe")
assert.match(addressedTests, /une remarque ambiante et courte n'est pas adressée/, "le test fige l'ambiance écartée")

// ── B. Le filtre passe AVANT la veille et AVANT le LLM ─────────────────────
const commands = read("host/voice-agent-commands.ts")
assert.match(commands, /from "\.\/voice-agent-addressed\.js"/, "l'interprétation importe la décision")
assert.match(commands, /addressed: boolean/, "le contrat d'interprétation porte le verdict")
assert.match(commands, /isAddressedToAgent\(useful, options\)/, "le verdict est calculé sur le texte utile")
assert.match(read("host/aven-app-host.ts"), /expectsAnswer: params\?\.\[1\] === true/,
  "le host transmet le contexte de question")
const hook = read("web/src/voice-agent/use-voice-agent.ts")
const addressedAt = hook.indexOf("if (!interpreted.addressed)")
const wakeAt = hook.indexOf('commit({ type: "wake" })')
const askAt = hook.indexOf("await ask(interpreted.demand)")
assert.ok(addressedAt > 0, "le renderer consulte le verdict d'adresse")
assert.ok(wakeAt > addressedAt, "une parole non adressée ne prolonge pas la veille")
assert.ok(askAt > addressedAt, "une parole non adressée ne part jamais au LLM")
assert.match(hook, /commit\(\{ type: "ignored", reading \}\)/, "une parole écartée revient en « ignoré »")
assert.match(hook, /voiceAgentInterpret\(text, expectsAnswer\)/, "le renderer transmet le contexte de question")
assert.match(hook, /const expectsAnswer =/, "le contexte vient de la dernière réponse lue")
assert.match(read("web/src/types.ts"), /sleep: boolean; addressed: boolean/, "le miroir IPC du renderer suit le contrat")

// ── C. Supprimer la conversation ouverte garde une conversation ────────────
const tabs = read("web/src/workbench/tabs.ts")
assert.match(tabs, /export function removeChatTab\(\s*state: TabsState,\s*chatId: string,\s*next\?: \{ chatId: string; agent\?: string \} \| null,?\s*\): TabsState/,
  "removeChatTab accepte la conversation qui prend la place")
assert.match(tabs, /chatId: nextId, agent: next\?\.agent \?\? t\.agent/, "l'onglet actif se rattache à la conversation restante")
const app = read("web/src/app/use-aven-app.ts")
assert.match(app, /removeChatTab\(state, id, next \? \{ chatId: next\.id, agent: next\.agent \} : null\)/,
  "la suppression transmet la conversation restante à l'onglet")
const tabsTests = read("tests/workbench-tabs.test.mjs")
assert.match(tabsTests, /la conversation restante reprend l'onglet actif/, "le comportement est testé")
assert.match(tabsTests, /l'onglet déjà ouvert de la conversation restante prend le focus/, "le doublon d'onglet est testé")

// ── D. La doc et la note de version ────────────────────────────────────────
const agents = read("AGENTS.md")
assert.match(agents, /Une parole qui n'est pas adressée ne reçoit pas de réponse \(v11\.14\.1\)/,
  "AGENTS.md décrit la règle d'adresse")
assert.match(agents, /Supprimer la conversation ouverte garde une conversation \(v11\.14\.1\)/,
  "AGENTS.md décrit la règle d'onglet")
assert.match(agents, /scripts\/verify-v11\.14\.1\.mjs/, "AGENTS.md cite la sonde")
assert.match(readme, new RegExp(`v${pkg.version.replaceAll(".", "\\.")} — `), "README porte la note de la version courante")

console.log("v11.14.1 verification: OK (parole adressée filtrée avant le LLM, onglet de conversation conservé)")

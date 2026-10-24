import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.2.0 : l'agent vocal reçoit son premier canal d'ACTION. Le risque d'une telle
// marche n'est pas de mal répondre : c'est de laisser un modèle décider d'une
// écriture, d'un chemin de fichier ou d'une boucle sans fin. Cette sonde fige les
// quatre garde-fous : outils en LECTURE SEULE, arguments validés, boucle bornée,
// chemin machine jamais transmis.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const lock = JSON.parse(read("package-lock.json"))
const cargo = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const readme = read("README.md")

const tools = read("host/voice-agent-tools.ts")
const speech = read("host/voice-agent-speech.ts")
const host = read("host/aven-app-host.ts")

// ── Version cohérente dans tous les manifestes ───────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(lock.version, pkg.version, "package-lock.json correspond à package.json")
assert.equal(lock.packages[""].version, pkg.version, "le paquet racine du lock est synchronisé")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(cargoLock, new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`), "Cargo.lock suit package.json")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")

// ── A. Le module d'outils reste pur et en LECTURE SEULE ─────────────────────
assert.ok(existsSync(path.join(root, "host/voice-agent-tools.ts")), "le module d'outils existe")
assert.match(tools, /Pur : testable avec Node seul/, "le module se déclare pur")
assert.doesNotMatch(tools, /from "node:fs"/, "aucun accès disque dans le module pur")
assert.match(
  tools,
  /export const TOOL_NAMES = \["app_state", "search_notes", "read_note"\] as const/,
  "la liste des outils est fermée et strictement en lecture",
)
const toolNames = tools.match(/export const TOOL_NAMES = \[([^\]]*)\]/)?.[1] ?? ""
assert.doesNotMatch(toolNames, /create|save|delete|write|move|archive|rename|trash/i, "aucun outil n'écrit")

// ── B. La boucle est bornée, et le dernier tour force une réponse ───────────
assert.match(tools, /export const MAX_TOOL_STEPS = 3/, "la boucle est plafonnée à trois tours")
assert.match(speech, /body\.tools = VOICE_TOOLS/, "les outils sont proposés au modèle")
assert.match(speech, /body\.tool_choice = "auto"/, "le modèle choisit librement d'appeler un outil")
assert.match(speech, /step < MAX_TOOL_STEPS/, "la boucle utilise le plafond exporté")
assert.match(
  speech,
  /const final = await chatCompletion\(messages, \{[^}]*withTools: false/,
  "après le plafond, un tour SANS outil force une réponse parlée",
)
// Une conversation sans exécutant ne doit pas envoyer d'outil du tout.
assert.match(speech, /if \(!run\) \{/, "sans exécutant, la conversation reste sans outils")

// ── C. Les arguments ne sont jamais crus ────────────────────────────────────
assert.match(tools, /export function safeNoteId/, "les identifiants de note sont filtrés")
assert.match(tools, /segment === "\.\."/, "la traversée « .. » est refusée")
assert.match(tools, /export function readToolCalls/, "les appels du modèle sont décodés et bornés")
assert.match(tools, /if \(!isToolName\(call\.name\)\)/, "un outil inconnu est refusé avant exécution")
assert.match(tools, /catch \(error\)/, "un échec de lecture devient un message, jamais une exception")

// ── D. Le host branche les données réelles sans fuiter le chemin machine ────
assert.match(host, /createVoiceToolRunner\(\{/, "le host fournit un exécutant à la boucle")
assert.match(host, /path\.basename\(workspace\)/, "l'état ne transmet que le NOM de l'espace")
assert.doesNotMatch(host, /workspace: workspace,/, "le chemin complet de la machine ne part pas au fournisseur")
assert.match(host, /searchNotes: \(query\) => searchNotes\(requireWorkspace\(\), query\)/, "la recherche réutilise l'API notes du host")
assert.match(host, /readNote: \(id\) => \{/, "la lecture réutilise l'API notes du host")

// ── E. Les tests couvrent le périmètre et la borne ──────────────────────────
assert.ok(existsSync(path.join(root, "tests/voice-agent-tools.test.mjs")), "les tests du module existent")
const tests = read("tests/voice-agent-tools.test.mjs")
assert.match(tests, /boucle bornée/, "un test couvre la borne de la boucle")
assert.match(tests, /Outil inconnu/, "un test couvre le refus d'un outil hors liste")
assert.match(tests, /sans outils, la requête ne porte aucun champ tools/, "un test couvre la non-régression de la conversation")

// ── F. La note de version nomme la fonctionnalité ──────────────────────────
assert.match(readme, /v11\.2\.0 — l'agent vocal lit vraiment tes notes/, "README porte la note de version")

console.log("v11.2.0 verification: OK (outils de lecture bornés, lecture seule)")

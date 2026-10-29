import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.9.0 : l'agent vocal agit par un catalogue fermé. Ce que la sonde fige :
// la liste EXACTE des actions (rien qui « ouvrirait » quelque chose), les
// destructions PROPOSÉES et jamais exécutées par le modèle, l'ambiguïté qui
// rend une question plutôt qu'un choix, l'unique chemin de confirmation côté
// host (jeton, 45 s), et le prompt qui dit la règle.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
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
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.9.0.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.9.0"], "node scripts/verify-v11.9.0.mjs", "la sonde a son entrée npm")

const actions = read("host/agent-actions.ts")
const tools = read("host/voice-agent-tools.ts")
const host = read("host/aven-app-host.ts")
const speech = read("host/voice-agent-speech.ts")
const tests = read("tests/voice-agent-tools.test.mjs")
const agents = read("AGENTS.md")

// ── Catalogue FERMÉ : la liste exacte, rien qui ouvrirait quelque chose ────
const names = [...actions.matchAll(/^ {4}name: "([a-z_]+)",$/gm)].map((m) => m[1])
assert.deepEqual(
  [...names].sort(),
  [
    "archive_chat",
    "archive_note",
    "create_chat",
    "create_folder",
    "create_note",
    "delete_chat",
    "list_chats",
    "move_note",
    "pin_note",
    "recent_actions",
    "rename_chat",
    "trash_note",
  ],
  "le catalogue est exactement la liste documentée — toute action nouvelle doit être délibérée",
)
for (const name of names) {
  assert.doesNotMatch(name, /^(open|launch|exec|shell|run|purge|shutdown|volume|music)/, `action qui ouvrirait quelque chose : ${name}`)
}

// ── Une destruction est PROPOSÉE, jamais exécutée par le modèle ────────────
const destroys = actions.split('risk: "destroy"').length - 1
assert.ok(destroys >= 2, `les destructions déclarées sont présentes (${destroys})`)
assert.match(actions, /JAMAIS exécutée par le modèle/, "la règle d'or est écrite dans le catalogue")
assert.match(actions, /export function requiresActionConfirmation/, "la confirmation est une fonction du catalogue")
assert.match(
  tests,
  /for \(const action of destroy\) assert\.match\(action\.description, \/PROPOSE\//,
  "le test exige que chaque destruction se PROPOSE",
)
assert.match(tests, /proposée, jamais exécutée/, "le test de proposition existe")

// ── Ambiguïté = question, jamais un choix silencieux ───────────────────────
assert.match(actions, /ambiguous/, "plusieurs cibles correspondent = question posée")
assert.match(actions, /export const MAX_WRITES_PER_TURN = 1/, "une seule écriture par tour")
assert.match(actions, /export const ACTION_CONFIRM_MS = 45_000/, "la fenêtre de confirmation dure 45 s")

// ── Un seul chemin de confirmation, côté host, jeton gardé par le host ─────
assert.match(host, /case "voiceAgentConfirmAction"/, "la confirmation a son traitement IPC")
assert.match(host, /actionConfirmationOpen\(proposed\.askedAt\)/, "la décision expire")
assert.match(host, /const token = randomUUID\(\)/, "le jeton de confirmation reste côté host")
assert.match(tools, /case "confirm":/, "le runner classe la proposition")
assert.match(speech, /JAMAIS exécutée par toi/, "le prompt dit la règle à voix haute")
assert.match(speech, /Destruction ou note : proposée/, "le prompt groupe destruction et note")
assert.match(speech, /actionConfirmationText\(/, "la question de confirmation vient du CATALOGUE")
assert.match(actions, /name: "create_note"/, "la création de note est une action du catalogue")
assert.match(actions, /NOTE_BODY_MAX_CHARS/, "le corps de note a sa borne, distincte d'une cible")
assert.match(actions, /confirm: true/, "la création de note est une écriture proposée")
assert.match(host, /case "create_note":/, "le host traite la création proposée")
assert.match(host, /quickCapture\(requireWorkspace\(\), args\.title, args\.content\)/, "l'écriture n'a lieu qu'après confirmation")
assert.match(tests, /création de note : proposée avec son contenu/, "le test fige la proposition")

// ── Documenté et référencé ─────────────────────────────────────────────────
assert.match(agents, /L'agent vocal agit par un catalogue/, "AGENTS.md décrit la règle")
assert.match(agents, /scripts\/verify-v11\.9\.0\.mjs/, "AGENTS.md cite la sonde")

console.log("v11.9.0 verification: OK (catalogue fermé : douze actions, destruction et note proposées, confirmation à chemin unique)")

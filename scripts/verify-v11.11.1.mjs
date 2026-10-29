import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.11.1 : une lecture n'est coupée que par une parole ADRESSÉE. Ce que la
// sonde fige : la décision est une fonction pure qui ne regarde QUE l'écho,
// l'état de lecture et le verdict d'adresse (jamais le niveau du micro — il
// mesure la voix de l'agent reprise par les haut-parleurs), l'écho revient en
// « ignoré » sans toucher à la requête ni à la veille, et aucune garde temporelle
// ne subsiste (la fenêtre de 900 ms ne couvrait que le début d'une lecture).
// v11.15.0 : un bruit non adressé ne coupe plus rien ; « attends » et « chut »
// restent des reprises directes, même seuls.

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
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.11.1.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.11.1"], "node scripts/verify-v11.11.1.mjs", "la sonde a son entrée npm")

const barge = read("web/src/voice-agent/barge-in.ts")
const session = read("web/src/voice-agent/session.ts")
const hook = read("web/src/voice-agent/use-voice-agent.ts")
const tests = read("tests/voice-agent-barge-in.test.mjs")
const agents = read("AGENTS.md")

// ── La décision est pure : écho + état de lecture, rien d'autre ────────────
assert.match(
  barge,
  /export function shouldInterruptSpeech\(input: \{[\s\S]*?echo: boolean[\s\S]*?reading: boolean[\s\S]*?addressed: boolean[\s\S]*?\}\): boolean/,
  "la décision dépend de l'écho, de la lecture et du verdict d'adresse",
)
assert.match(barge, /isBargeInPhrase/, "les reprises directes ont leur liste fermée")
assert.doesNotMatch(barge, /AudioContext|getVolume|analyser/i, "aucune mesure de niveau dans la décision")
assert.match(
  hook,
  /if \(shouldInterruptSpeech\(\{ echo: false, reading, addressed: false, heard: text \}\)\)/,
  "un bruit non adressé ne coupe pas la lecture",
)
assert.match(
  hook,
  /if \(shouldInterruptSpeech\(\{ echo: false, reading, addressed: true, heard: text \}\)\) stopPlayback\(\)/,
  "une parole adressée coupe la lecture",
)
assert.match(tests, /un bruit non adressé ne coupe pas la lecture/, "le test fige la non-coupe du bruit")
assert.match(tests, /écho de la voix de l.agent ne coupe jamais rien/, "le test fige que l'écho ne coupe rien")

// ── L'écho revient « ignoré » : requête et veille intactes ─────────────────
const ignoredAt = session.indexOf('case "ignored"')
assert.ok(ignoredAt > 0, "le classement « ignoré » existe")
const ignored = session.slice(ignoredAt, session.indexOf('case "', ignoredAt + 5))
assert.ok(!/requestId/.test(ignored), "un écho n'annule pas la requête en cours")
assert.ok(!/awakeUntil/.test(ignored), "un écho ne touche pas à la veille")
assert.match(hook, /commit\(reading \? \{ type: "ignored", reading: true \} : \{ type: "interrupt" \}\)/, "écho → ignoré, vraie parole → interruption")

// ── Plus aucune garde temporelle de 900 ms ─────────────────────────────────
assert.doesNotMatch(barge, /900/, "la garde de 900 ms a disparu de la décision")
assert.doesNotMatch(session, /900/, "la garde de 900 ms a disparu de la session")

// ── Documenté et référencé ─────────────────────────────────────────────────
assert.match(agents, /Une lecture n'est coupée par une parole ADRESSÉE/, "AGENTS.md décrit la règle")

console.log("v11.11.1 verification: OK (reprise : décision pure sur l'écho, ignoré sans perte, aucune garde de 900 ms)")

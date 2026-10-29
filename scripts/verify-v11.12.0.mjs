import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.12.0 : une fois réveillé, Aven reste éveillé. Ce que la sonde fige :
// la veille dure une minute et n'est JAMAIS refermée à la capture de la
// parole (le défaut de la fenêtre de dix secondes de v11.1.0), les ordres de
// repos vivent en une seule liste côté host (le renderer n'en tient pas une
// seconde), le repos n'agit que réveillé ou appelé, interrompre une lecture ne
// rendort pas, et l'état de veille est DIT — jamais déduit de la couleur.

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
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.12.0.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.12.0"], "node scripts/verify-v11.12.0.mjs", "la sonde a son entrée npm")

const session = read("web/src/voice-agent/session.ts")
const wake = read("host/voice-agent-wake.ts")
const commands = read("host/voice-agent-commands.ts")
const hook = read("web/src/voice-agent/use-voice-agent.ts")
const tests = read("tests/voice-agent-wake.test.mjs")
const agents = read("AGENTS.md")

// ── La veille : une minute, prolongée, jamais refermée à la capture ────────
assert.match(session, /export const AWAKE_IDLE_MS = 60_000/, "la veille dure une minute")
assert.match(session, /return \{ \.\.\.state, awakeUntil: now \+ AWAKE_IDLE_MS \}/, "un réveil ouvre la veille")
const start = session.indexOf('case "speech-start"')
assert.ok(start > 0, "le cas speech-start existe")
const block = session.slice(start, session.indexOf('case "', start + 5))
assert.ok(!/awakeUntil/.test(block), "capturer la parole ne referme plus la veille (défaut v11.1.0)")

// ── Trois sorties seulement : repos, silence, micro coupé — pas l'écoute ───
const interruptAt = session.indexOf('case "interrupt"')
const errorAt = session.indexOf('case "error"')
assert.ok(interruptAt > 0 && errorAt > interruptAt, "les cas interrupt et error existent")
const interrupt = session.slice(interruptAt, errorAt)
assert.ok(!/awakeUntil/.test(interrupt), "interrompre une lecture ne rendort pas l'agent")
assert.match(session, /Éveillé/, "l'état de veille est DIT (« Éveillé »), jamais seulement coloré")

// ── Un écho de la voix de l'agent ne touche pas à la session ───────────────
assert.match(session, /case "ignored"/, "l'écho est classé « ignoré », pas interrompu")

// ── Une seule liste d'ordres de repos : côté host ──────────────────────────
assert.match(wake, /const SLEEP_PHRASE_RE = /, "les ordres de repos ont une expression unique")
assert.match(commands, /isSleepPhrase/, "les commandes vocales passent par la liste unique")
assert.match(commands, /from "\.\/voice-agent-wake\.js"/, "les commandes importent la veille, elles ne la recopient pas")
assert.doesNotMatch(hook, /SLEEP_PHRASE_RE/, "le renderer ne tient pas une seconde liste d'ordres")
assert.match(hook, /interpreted\.sleep && \(interpreted\.woken \|\| awake\)/, "le repos n'agit que réveillé ou explicitement appelé")

// ── Testé et documenté ─────────────────────────────────────────────────────
assert.match(tests, /ordre de repos : la phrase entière/, "le test fige la phrase entière")
assert.match(tests, /mot d'activation/, "le test du mot d'activation existe")
assert.match(agents, /Une fois réveillé, Aven reste éveillé/, "AGENTS.md décrit la règle")
assert.match(agents, /scripts\/verify-v11\.12\.0\.mjs/, "AGENTS.md cite la sonde")

console.log("v11.12.0 verification: OK (veille : capture ne referme pas, une seule liste de repos, interruption ne rendort pas)")

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.15.2 : la fin d'une lecture ne referme plus une capture commencée pendant
// la réponse. Ce défaut silencieux rendait le micro sourd : l'enregistreur
// restait ouvert sans phase « capturing », son speech-end était ignoré, et la
// réponse à la question que l'agent venait de poser n'était jamais transcrite.
// La sonde fige trois choses :
//   A. `done` préserve une capture (ou sa transcription) en cours ;
//   B. un enregistreur orphelin est arrêté par un filet, sans jeter son clip ;
//   C. le test de régression garde le scénario « question puis réponse ».

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const lock = JSON.parse(read("package-lock.json"))
const cargo = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const readme = read("README.md")
const agents = read("AGENTS.md")
const session = read("web/src/voice-agent/session.ts")
const hook = read("web/src/voice-agent/use-voice-agent.ts")
const sessionTest = read("tests/voice-agent-session.test.mjs")

// ── Version cohérente dans tous les manifestes ─────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(lock.version, pkg.version, "package-lock.json correspond à package.json")
assert.equal(lock.packages[""].version, pkg.version, "le paquet racine du lock est synchronisé")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(cargoLock, new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`), "Cargo.lock suit package.json")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.15.2.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.15.2"], "node scripts/verify-v11.15.2.mjs", "la sonde a son entrée npm")

// ── A. `done` ne referme pas une capture ni sa transcription ───────────────
const doneStart = session.indexOf('case "done":')
const doneEnd = session.indexOf('case "ignored":', doneStart)
assert.ok(doneStart > 0 && doneEnd > doneStart, "le cas done existe dans la machine à états")
const done = session.slice(doneStart, doneEnd)
assert.match(done, /if \(state\.phase === "capturing" \|\| state\.phase === "transcribing"\) return state/,
  "done préserve une capture ou une transcription en cours")
assert.match(done, /return \{ \.\.\.state, phase: "listening" \}/,
  "done rend la main quand rien n'est capturé")
assert.doesNotMatch(done, /phase: "capturing"/,
  "done ne fabrique jamais une capture")
assert.match(done, /v11\.15\.2/, "le pourquoi daté reste sur place")

// ── B. Un enregistreur orphelin ne reste pas ouvert ────────────────────────
const endStart = hook.indexOf("const handleSpeechEnd = useCallback")
const endEnd = hook.indexOf("handlersRef.current =", endStart)
assert.ok(endStart > 0 && endEnd > endStart, "handleSpeechEnd existe")
const end = hook.slice(endStart, endEnd)
assert.match(end, /if \(sessionRef\.current\.phase !== "capturing"\) \{/,
  "la fin de parole vérifie la phase")
assert.match(end, /if \(recorder && recorder\.state !== "inactive"\) \{[\s\S]*recorder\.stop\(\)/,
  "un enregistreur orphelin est arrêté")
assert.doesNotMatch(end, /discardNextRef\.current = true/,
  "le clip orphelin n'est pas jeté : il peut contenir la réponse")
assert.match(end, /v11\.15\.2/, "le filet porte sa raison datée")

// ── C. Le scénario de la question restée sans réponse est figé ─────────────
assert.match(sessionTest, /la fin de lecture ne referme pas une capture en cours/,
  "le test de régression existe")
assert.match(sessionTest, /reduceVoiceSession\(state, \{ type: "done" \}, 200\)/,
  "le test fait bien passer un done après un speech-start")
assert.match(sessionTest, /assert\.equal\(state\.phase, "capturing", "la capture garde sa phase après la lecture"\)/,
  "le test refuse le retour à « écoute »")

// ── La règle se dit dans la doc ────────────────────────────────────────────
assert.match(agents, /La fin d'une lecture ne referme pas une capture \(v11\.15\.2\)/,
  "AGENTS.md dit la règle")
assert.match(readme, /v11\.15\.2 — il n'oublie plus la question qu'il vient de te poser/,
  "README porte la note utilisateur de la version courante")

console.log("v11.15.2 verification: OK (la fin de lecture ne referme pas une capture)")

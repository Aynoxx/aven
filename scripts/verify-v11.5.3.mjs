import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.5.3 : l'audio se joue au fil de l'eau, et le lecteur est choisi AVANT
// l'appel. Ce que la sonde fige : `voiceAgentStreamKind` est appelé avant
// `voiceAgentSayStream` (un abonné branché après la commande perdrait toutes
// les trames), l'abonnement aux trames est installé AU CHARGEMENT du module
// (jamais au moment de la réponse), et la planification PCM reste pure dans
// pcm-schedule.ts avec son test.

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
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.5.3.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.5.3"], "node scripts/verify-v11.5.3.mjs", "la sonde a son entrée npm")

const hook = read("web/src/voice-agent/use-voice-agent.ts")
const stream = read("web/src/voice-agent/stream.ts")
const schedule = read("web/src/voice-agent/pcm-schedule.ts")
const agents = read("AGENTS.md")

// ── Le lecteur est choisi AVANT l'appel ────────────────────────────────────
const kindAt = hook.indexOf("await api.voiceAgentStreamKind(")
const streamAt = hook.indexOf("await api.voiceAgentSayStream(")
assert.ok(kindAt > 0, "voiceAgentStreamKind est appelé")
assert.ok(streamAt > 0, "voiceAgentSayStream est appelé")
assert.ok(kindAt < streamAt, "le lecteur est préparé AVANT la commande (un abonné tardif perd les trames)")

// ── L'abonnement aux trames est installé au chargement du module ───────────
assert.match(stream, /^installVoiceStreamListener\(\)$/m, "l'abonnement est branché au chargement, pas par réponse")
assert.match(stream, /Aucun listen par réponse/, "le piège du listen tardif est tracé dans le code")

// ── La planification PCM reste pure et testée ──────────────────────────────
assert.match(schedule, /export function pcmChunkPlan/, "la planification est une fonction exportée")
assert.ok(existsSync(path.join(root, "tests/pcm-schedule.test.mjs")), "tests/pcm-schedule.test.mjs existe")

// ── Les deux pièges sont documentés ────────────────────────────────────────
assert.match(agents, /L'audio se joue au fil de l'eau \(v11\.5\.3\)/, "AGENTS.md décrit la règle de livraison")
assert.match(agents, /abonné branché après la commande perdrait toutes les trames \(v11\.5\.3\)/, "AGENTS.md trace le piège de l'abonnement tardif")
assert.match(agents, /installVoiceStreamListener/, "AGENTS.md nomme l'abonnement au chargement")

console.log("v11.5.3 verification: OK (flux audio : lecteur choisi avant l'appel, abonnement au chargement, planification pure)")

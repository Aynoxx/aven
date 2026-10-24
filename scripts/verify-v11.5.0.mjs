import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.5.0 : la voix de secours est Piper, embarquée et hors ligne. Ce que la
// sonde fige :
//   A. la synthèse locale est un module à lanceur injectable, donc testé sans binaire ;
//   B. le routage connaît le préfixe « piper: » et le fichiers de ressources existent ;
//   C. le repli EDT passe par Piper, et Hortense ne sert plus que de dernier recours ;
//   D. le binaire et le modèle sont provisionnés et embarqués par l'installeur ;
//   E. le dictionnaire couvre Piper, la doc le dit, la sonde est branchée.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const lock = JSON.parse(read("package-lock.json"))
const cargo = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const readme = read("README.md")
const agents = read("AGENTS.md")

const piper = read("host/piper-tts.ts")
const edge = read("host/voice-agent-edge.ts")
const host = read("host/aven-app-host.ts")
const pron = read("host/pronunciation.ts")
const rust = read("src-tauri/src/runtime.rs")
const fetchScript = read("scripts/fetch-piper.mjs")

// ── Version cohérente dans tous les manifestes ───────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(lock.version, pkg.version, "package-lock.json correspond à package.json")
assert.equal(lock.packages[""].version, pkg.version, "le paquet racine du lock est synchronisé")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(cargoLock, new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`), "Cargo.lock suit package.json")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.5.0.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.5.0"], "node scripts/verify-v11.5.0.mjs", "la sonde a son entrée npm")

// ── A. Un module testable sans binaire ───────────────────────────────────────────────────
assert.ok(existsSync(path.join(root, "host/piper-tts.ts")), "la synthèse Piper vit dans son module")
assert.match(piper, /export type PiperRunner/, "le lanceur de processus est injectable")
assert.match(piper, /export async function synthesizePiperSpeech/, "la synthèse est une fonction exportée")
assert.ok(existsSync(path.join(root, "tests/piper-tts.test.mjs")), "les tests du module existent")

// ── B. Le routage et les identifiants ─────────────────────────────────────────────────────
assert.match(edge, /\{ kind: "piper"; voice: string \}/, "la route Piper existe")
assert.match(edge, /voiceName\.startsWith\("piper:"\)/, "le préfixe piper: est reconnu")
assert.match(edge, /return \{ kind: "piper", voice: voiceName\.slice\(6\) \}/, "la voix Piper est extraite du préfixe")

// ── C. Le repli passe par Piper, Hortense en dernier recours ────────────────────
const edgeBranch = host.slice(host.indexOf('if (route.kind === "edge")'), host.indexOf('stopVoiceSpeech()\n  await speakWithWindowsVoice(clean, route.voice'))
assert.match(edgeBranch, /await speakWithPiper\(clean\)/, "l'échec neuronal tente Piper")
assert.match(edgeBranch, /voix locale Piper utilisée/, "le basculement vers Piper est dit")
assert.ok(edgeBranch.indexOf("speakWithPiper") < edgeBranch.indexOf("speakWithWindowsVoice"), "Piper est tenté AVANT Hortense")
assert.match(host, /process\.env\.AVEN_PIPER_DIR/, "le dossier Piper vient du host")
assert.match(host, /existsSync\(layout\.binary\) && existsSync\(layout\.model\)/, "un Piper incomplet est détecté, pas supposé")

// ── D. Provisionné, embarqué, transmis ───────────────────────────────────────────────────
assert.ok(existsSync(path.join(root, "scripts/fetch-piper.mjs")), "le script de provisionnement existe")
assert.equal(pkg.scripts["fetch:piper"], "node scripts/fetch-piper.mjs", "le script a son entrée npm")
assert.match(fetchScript, /siwis\/medium\/fr_FR-siwis-medium/, "la voix récupérée est celle validée à l'oreille")
assert.ok(tauri.bundle.resources["resources/piper/"], "l'installeur embarque le dossier Piper")
assert.match(rust, /fn bundled_piper/, "Rust résout le dossier Piper")
assert.match(rust, /command\.env\("AVEN_PIPER_DIR", piper\)/, "Rust transmet le dossier au host")

// ── E. Dictionnaire et documentation ─────────────────────────────────────────────────────
assert.match(pron, /piper: \{/, "le dictionnaire couvre Piper")
assert.match(pron, /piper: \{\s*Freebuff: "Fribeuf",\s*Aven: "Aveun",\s*\}/, "Piper reçoit les deux graphies validées")
assert.match(host, /applyPronunciations\(sanitizeSpeechText\(text\), "piper"\)/, "Piper passe par le dictionnaire")
assert.match(agents, /host\/piper-tts\.ts/, "AGENTS.md cite le module Piper")
assert.match(agents, /npm run fetch:piper/, "AGENTS.md cite le provisionnement")
assert.match(readme, new RegExp(`v${pkg.version.replaceAll(".", "\\.")} — `), "README porte la note de la version courante")

console.log("v11.5.0 verification: OK (voix locale Piper embarquée, repli hors ligne, Hortense en dernier recours)")

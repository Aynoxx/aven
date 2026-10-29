import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.14.0 : une seule pile vocale. Ce que la sonde fige :
//   A. les modules retirés (Edge, Piper, cache de phrases, transport WebSocket,
//      provisionnement Piper) sont ABSENTS du disque et du packaging ;
//   B. le routage vit dans un module pur testé qui ne connaît que « pocket: » et
//      « sapi: » — une préférence héritée retombe sur la voix Windows ;
//   C. le menu, le contrat IPC et le lecteur ne gardent aucune trace d'un flux
//      WebM/Opus ni d'un groupe « Neuronales » ;
//   D. la doc dit la règle, la note de version aussi, et la sonde est branchée.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const exists = (p) => existsSync(path.join(root, p))
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const lock = JSON.parse(read("package-lock.json"))
const cargo = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const readme = read("README.md")

// ── Version cohérente dans tous les manifestes ──────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(lock.version, pkg.version, "package-lock.json correspond à package.json")
assert.equal(lock.packages[""].version, pkg.version, "le paquet racine du lock est synchronisé")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(cargoLock, new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`), "Cargo.lock suit package.json")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.14.0.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.14.0"], "node scripts/verify-v11.14.0.mjs", "la sonde a son entrée npm")

// ── A. Les modules retirés sont absents ────────────────────────────────────
for (const dead of [
  "host/voice-agent-edge.ts",
  "host/voice-agent-tts.ts",
  "host/voice-cache.ts",
  "host/piper-tts.ts",
  "scripts/fetch-piper.mjs",
  "tests/voice-agent-edge.test.mjs",
  "tests/voice-cache.test.mjs",
  "tests/piper-tts.test.mjs",
]) {
  assert.ok(!exists(dead), `${dead} a été retiré en v11.14.0 : ne le recrée pas`)
}
assert.ok(!exists("src-tauri/resources/piper"), "les ressources Piper ont été retirées de l'installeur")
assert.equal(tauri.bundle.resources["resources/piper/"], undefined, "l'installeur n'embarque plus Piper")
assert.equal(pkg.scripts["fetch:piper"], undefined, "l'entrée npm fetch:piper a disparu")
assert.equal(pkg.dependencies.ws, undefined, "la dépendance ws (transport Edge) a disparu")
assert.equal(pkg.devDependencies["@types/ws"], undefined, "les types ws ont disparu")
const rust = read("src-tauri/src/runtime.rs")
assert.ok(!/bundled_piper|AVEN_PIPER_DIR/.test(rust), "Rust ne résout plus le dossier Piper")
assert.equal((pkg.scripts.verify.match(/node scripts\/verify-v11\.(3\.0|4\.3|5\.0|5\.1)\.mjs/g) ?? []).length, 0,
  "les sondes d'Edge et de Piper ont été retirées de la chaîne")

// ── B. Le routage : module pur, testé, deux moteurs ─────────────────────────
assert.ok(exists("host/voice-route.ts"), "le routage vit dans son module")
const route = read("host/voice-route.ts")
assert.match(route, /Pur : testable avec Node seul/, "le module se déclare pur")
assert.match(route, /export type VoiceRoute =/, "le type de route est exporté")
assert.doesNotMatch(route, /kind: "edge"|kind: "piper"/, "aucune route retirée ne subsiste")
assert.match(route, /startsWith\("pocket:"\)/, "le préfixe Pocket est routé")
assert.match(route, /startsWith\("sapi:"\)/, "le préfixe Windows est routé")
assert.match(route, /voiceName\.startsWith\("edge:"\) \|\| voiceName\.startsWith\("piper:"\)/,
  "une préférence héritée retombe sur la voix par défaut")
const routeTests = read("tests/voice-route.test.mjs")
assert.match(routeTests, /préfixes retirés \(edge, piper\) retombent sur la voix par défaut/,
  "le repli des préfixes héritées est protégé par un test")
assert.match(routeTests, /préférence vide parle/, "jamais un agent muet est testé")

// ── C. Aucune trace du flux WebM/Opus ni du groupe neuronal dans l'UI ───────
const host = read("host/aven-app-host.ts")
assert.doesNotMatch(host, /EDGE_|voice-agent-edge|voice-agent-tts|voice-cache|piper-tts/,
  "le host n'importe plus aucun module retiré")
const voices = read("web/src/voice-agent/voices.ts")
assert.doesNotMatch(voices, /EDGE_VOICE_OPTIONS|isNeuralVoice/, "le catalogue du renderer est net")
const settings = read("web/src/SettingsDialog.tsx")
assert.doesNotMatch(settings, /Neuronales|isNeuralVoice/, "le menu des Réglages n'annonce plus de voix en ligne")
const stream = read("web/src/voice-agent/stream.ts")
assert.doesNotMatch(stream, /export function createVoiceStream|new MediaSource/, "aucun lecteur WebM/Opus ne revient")
const hook = read("web/src/voice-agent/use-voice-agent.ts")
assert.match(hook, /kind === "pcm" \? createPcmStream\(streamId\) : null/, "sans PCM, l'audio est joué d'un bloc")
const types = read("web/src/types.ts")
assert.match(types, /voiceAgentStreamKind: \(\) => Promise<"pcm" \| "none">/, "le contrat IPC n'a plus que deux états")
const pocket = read("host/pocket-tts.ts")
assert.match(pocket, /streamKindForVoice\(voiceName: string\): "pcm" \| "none"/, "un seul lecteur de flux possible")
const pron = read("host/pronunciation.ts")
assert.match(pron, /export type SpeechEngine = "sapi" \| "pocket"/, "le dictionnaire ne nomme que les moteurs restants")

// ── D. La doc et la note de version ────────────────────────────────────────
const agents = read("AGENTS.md")
assert.match(agents, /Une seule pile vocale \(v11\.14\.0\)/, "AGENTS.md décrit la règle d'une seule pile")
assert.match(readme, new RegExp(`v${pkg.version.replaceAll(".", "\\.")} — `), "README porte la note de la version courante")
assert.ok(exists("tests/voice-route.test.mjs"), "le routage a son test")

console.log("v11.14.0 verification: OK (une seule pile vocale : Pocket + repli Windows, Edge et Piper retirés)")

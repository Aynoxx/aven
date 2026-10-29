import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.12.1 : un paquet reçu se joue tout de suite. Ce que la sonde fige : le
// lecteur PCM programme chaque paquet dès son arrivée, et `maybeFinish`
// refuse de conclure tant qu'il reste des échantillons reçus et non
// programmés — la fin de flux ne jette JAMAIS l'audio en attente (régression
// mesurée : 1,07 s jouée sur une réponse de ~9 s avant correction, 7,79 s
// après, à texte identique).

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
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.12.1.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.12.1"], "node scripts/verify-v11.12.1.mjs", "la sonde a son entrée npm")

const pcm = read("web/src/voice-agent/pcm-stream.ts")
const edge = read("web/src/voice-agent/stream.ts")
const agents = read("AGENTS.md")
const audit = read("docs/audits/2026-10-28-coupe-lecture-pcm.md")

// ── Chaque paquet est programmé dès son arrivée ────────────────────────────
assert.match(pcm, /const flushPending = \(\) =>/, "la file des paquets en attente a une fonction dédiée")
const flushes = (pcm.match(/flushPending\(\)/g) ?? []).length
assert.ok(flushes >= 2, `la file est vidée à chaque arrivée de paquet (${flushes} appels)`)

// ── La fin de flux ne jette jamais l'audio reçu ────────────────────────────
assert.match(pcm, /const maybeFinish = \(\) =>/, "la conclusion du flux est une étape dédiée")
assert.match(
  pcm,
  /if \(!ended \|\| nodes\.size \|\| pending\.length\) return/,
  "maybeFinish refuse de conclure tant qu'il reste des échantillons en attente",
)
assert.match(pcm, /on ne rend JAMAIS la main/, "la régression corrigée est tracée dans le code")

// ── Un seul lecteur : le PCM est le seul flux (v11.14.0) ──────────────────
// Le lecteur WebM/Opus (MediaSource) a été retiré avec les voix neuronales :
// la file PCM ne doit pas se faire doubler par un second chemin de lecture.
assert.doesNotMatch(edge, /export function createVoiceStream|new MediaSource/, "le lecteur WebM/Opus retire ne revient pas")
assert.match(agents, /le PCM est le seul flux/, "AGENTS.md dit que le PCM est le seul flux")
assert.match(agents, /file reste vidée avant/, "AGENTS.md rappelle que la file se vide avant de conclure")

// ── Mesuré, documenté ──────────────────────────────────────────────────────
assert.match(audit, /7,79/, "l'audit porte les mesures avant/après")
assert.match(agents, /Un paquet reçu se joue tout de suite \(v11\.12\.1\)/, "AGENTS.md décrit la règle")
assert.ok(existsSync(path.join(root, "tests/pcm-schedule.test.mjs")), "la planification PCM a son test")

console.log("v11.12.1 verification: OK (PCM : paquet joué à l'arrivée, fin de flux jamais au détriment de l'audio en attente)")

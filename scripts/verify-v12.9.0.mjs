import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v12.9.0 : un profil de voix clonée peut être livré avec un installeur LOCAL.
// La sonde fige quatre choses :
//   1. le profil vit sous `src-tauri/resources/pocket-tts/voices/`, dossier
//      gitignoré, jamais dans le dépôt public ;
//   2. il est accompagné de `voice-consent.json` (attestation, portée locale) ;
//   3. le host le pose au premier lancement, sans écraser un profil existant ;
//   4. « Retirer la voix clonée » écrit un marqueur qui empêche son retour.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const cargo = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const readme = read("README.md")
const agents = read("AGENTS.md")
const pocket = read("host/pocket-tts.ts")
const host = read("host/aven-app-host.ts")
const bundle = read("scripts/bundle-pocket-voice.mjs")
const tests = read("tests/pocket-voice-seed.test.mjs")
const gitignore = read(".gitignore")

// ── Version et enregistrement ──────────────────────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(cargo.match(/^version = "([^"]+)"$/m)?.[1], pkg.version, "Cargo.toml suit package.json")
assert.match(
  cargoLock,
  new RegExp(`name = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`),
  "Cargo.lock suit package.json",
)
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")
assert.ok(readme.includes("v12.9.0 — la voix clonée peut être livrée avec ton installation"), "README documente la voix embarquée")
assert.equal(pkg.scripts["verify:v12.9.0"], "node scripts/verify-v12.9.0.mjs", "la sonde a son entrée npm")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v12.9.0.mjs"), "npm run verify inclut la sonde v12.9.0")
assert.equal(pkg.scripts["voice:bundle"], "node scripts/bundle-pocket-voice.mjs", "l'embarquement a son entrée npm")
assert.match(agents, /npm run voice:bundle/, "AGENTS.md cite l'embarquement local")

// ── Le module pur ──────────────────────────────────────────────────────────
assert.match(pocket, /export const POCKET_SEED_MARKER_FILE = "seed\.json"/, "le marqueur a un nom stable")
assert.match(pocket, /export const POCKET_BUNDLED_CONSENT_FILE = "voice-consent\.json"/, "l'attestation a un nom stable")
assert.match(pocket, /export function pocketBundledProfile\(/, "le profil embarqué se résout sans disque")
assert.match(pocket, /export function pocketVoiceSeedMarker\(/, "le marqueur se résout sans disque")
assert.match(pocket, /export function pocketSeedDecision\(/, "la décision de pose est pure")
assert.match(pocket, /return "skip-removed"/, "un retrait volontaire est une décision explicite")

// ── Le host : pose avant le moteur, jamais d'écrasement, retrait durable ────
assert.match(host, /function seedBundledVoiceProfile\(/, "le host a une pose dédiée")
assert.match(host, /pocketSeedDecision\(\{ bundled: !!bundled, installed, removed \}\)/, "la pose passe par la décision pure")
assert.match(host, /consent\?\.attested !== true \|\| consent\?\.scope !== "local-installer"/, "l'attestation locale est exigée")
assert.match(host, /copyFileSync\(bundled, paths\.staged\)/, "le profil est copié dans un staging")
assert.match(host, /renameSync\(paths\.staged, paths\.file\)/, "le staging est renommé après vérification")
assert.match(host, /writeTextAtomic\(pocketVoiceSeedMarker\(pocketDataDir\(\)\), JSON\.stringify\(\{ removed: true/, "le retrait écrit un marqueur")
assert.match(host, /rmSync\(pocketVoiceSeedMarker\(dataDir\), \{ force: true \}\)/, "un nouveau profil efface le marqueur de retrait")
const init = host.slice(host.indexOf("async function initialize"), host.indexOf("const bin = params.binPath"))
assert.ok(init.includes("seedBundledVoiceProfile()"), "initialize pose le profil avant de démarrer le moteur")

// ── Le script d'embarquement ───────────────────────────────────────────────
assert.match(bundle, /--attest/, "--attest est obligatoire pour écrire")
assert.match(bundle, /voice-consent\.json/, "le script écrit l'attestation")
assert.match(bundle, /attested: true/, "l'attestation est explicite")
assert.match(bundle, /local-installer/, "la portée est locale")
assert.match(bundle, /src-tauri.*resources.*pocket-tts.*voices/s, "la cible est le dossier de ressources local")
assert.match(bundle, /readBigUInt64LE/, "l'en-tête du profil est vérifié")
assert.match(bundle, /renameSync/, "le profil est posé par renommage")
assert.match(bundle, /build local/i, "le script avertit qu'il ne sert pas à une distribution publique")

// ── Empaquetage et dépôt ───────────────────────────────────────────────────
assert.match(tauri.bundle.resources["resources/pocket-tts/"], /runtime\/pocket-tts/, "l'installeur embarque le dossier Pocket")
assert.match(gitignore, /src-tauri\/resources\//, "le dossier des ressources reste hors du dépôt")

// ── Tests ──────────────────────────────────────────────────────────────────
assert.ok(existsSync(path.join(root, "tests/pocket-voice-seed.test.mjs")), "les tests de pose existent")
assert.match(tests, /pocketSeedDecision/, "la décision est testée")
assert.match(tests, /skip-removed/, "le retrait est testé")
assert.match(tests, /keep/, "l'absence d'écrasement est testée")

// ── Profil réellement embarqué : chemin canonique + attestation ────────────
const resources = path.join(root, "src-tauri", "resources")
const voices = existsSync(resources)
  ? readdirSync(resources, { recursive: true })
      .map(String)
      .map((name) => name.replaceAll("\\", "/"))
      .filter((name) => name.endsWith(".safetensors"))
  : []
const canonical = "pocket-tts/voices/aven.safetensors"
assert.deepEqual(voices.filter((name) => name !== canonical), [], "seul le profil canonique peut être embarqué")
if (voices.length) {
  const consentPath = path.join(resources, "pocket-tts", "voices", "voice-consent.json")
  assert.ok(existsSync(consentPath), "un profil embarqué exige voice-consent.json")
  const consent = JSON.parse(readFileSync(consentPath, "utf8"))
  assert.equal(consent.attested, true, "l'attestation du profil embarqué est explicite")
  assert.equal(consent.scope, "local-installer", "le profil embarqué est limité à un installeur local")
}

console.log("v12.9.0 verification: OK (profil de voix embarqué localement, attesté, posé une fois, retrait durable)")

import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.11.0 : l'app installe ce qu'elle utilise. Ce que la sonde fige : le
// clonage se fait dans l'app (le renderer choisit un fichier et transmet un
// CHEMIN, il n'en lit jamais un octet), le modèle vient du cache de
// L'APPLICATION — jamais du cache Hugging Face d'une autre installation —, le
// jeton chiffré ne redescend jamais (seul son booléen remonte), et un profil
// n'est posé qu'après vérification de son en-tête, par renommage.

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
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.11.0.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.11.0"], "node scripts/verify-v11.11.0.mjs", "la sonde a son entrée npm")

const pocket = read("host/pocket-tts.ts")
const host = read("host/aven-app-host.ts")
const api = read("web/src/api-tauri.ts")
const types = read("web/src/types.ts")
const agents = read("AGENTS.md")

// ── Le cache est celui de l'APPLICATION ────────────────────────────────────
assert.match(pocket, /HF_HOME: modelDir/, "le moteur reçoit le cache de l'app (HF_HOME)")
assert.doesNotMatch(pocket, /homedir\(\)/, "aucun chemin du dossier utilisateur pour le modèle")
assert.match(pocket, /export function pocketCloneRepoDir\(modelDir: string\)/, "le dépôt de clonage vit sous le cache de l'app")

// ── Le renderer transmet un CHEMIN, jamais des octets ──────────────────────
assert.match(api, /if \(property === "voiceCloneFromAudio"\)/, "l'API ouvre le sélecteur de fichier")
assert.match(api, /args: \[selected\]/, "seul le chemin part au host — le renderer ne lit pas le fichier")

// ── Le jeton ne redescend jamais : booléen seulement ───────────────────────
assert.match(types, /setVoiceCloneToken: \(token: string\) => Promise<\{ token: boolean \}>/, "la signature ne rend qu'un booléen")
assert.match(host, /token: !!voiceCloneToken\(\)/, "le statut du jeton est un booléen")
assert.match(host, /return \{ token: saveVoiceCloneToken\(String\(params\?\.\[0\] \?\? ""\)\) \}/, "l'enregistrement rend aussi un booléen")
assert.doesNotMatch(host, /token: voiceCloneToken\(\)/, "la valeur du jeton n'est jamais renvoyée telle quelle")
assert.match(host, /voiceCloneTokenEnc/, "le jeton vit chiffré côté host (settings.json)")

// ── Profil posé seulement après vérification de l'en-tête, par renommage ───
assert.match(pocket, /staged: `\$\{file\}\.export`/, "le moteur écrit dans un fichier provisoire")
assert.match(pocket, /export function profileTensorCount/, "l'en-tête du profil est vérifiable")
const checked = host.indexOf("profileTensorCount(new Uint8Array(readFileSync(paths.staged)))")
const renamed = host.indexOf("renameSync(paths.staged, paths.file)")
assert.ok(checked > 0, "le profil provisoire est vérifié")
assert.ok(renamed > checked, "le renommage n'a lieu qu'APRÈS la vérification de l'en-tête")

// ── `--default-voice` ne se lit qu'au démarrage ────────────────────────────
assert.match(pocket, /"--default-voice"/, "le profil cloné est passé au lancement du moteur")
assert.match(host, /--default-voice` ne se lit qu'au démarrage/, "le commentaire trace la contrainte de redémarrage")

// ── Testé ──────────────────────────────────────────────────────────────────
assert.ok(existsSync(path.join(root, "tests/pocket-tts.test.mjs")), "tests/pocket-tts.test.mjs existe")
const pocketTests = read("tests/pocket-tts.test.mjs")
for (const symbol of ["pocketClonePaths", "profileTensorCount", "pocketCloneRepoDir"]) {
  assert.ok(pocketTests.includes(symbol), `tests/pocket-tts.test.mjs couvre ${symbol}`)
}

// ── Documenté et référencé ─────────────────────────────────────────────────
assert.match(agents, /L'app installe ce qu'elle utilise/, "AGENTS.md décrit la règle")
assert.match(agents, /scripts\/verify-v11\.11\.0\.mjs/, "AGENTS.md cite la sonde")

console.log("v11.11.0 verification: OK (clonage dans l'app : chemin only, jeton jamais renvoyé, en-tête vérifié avant pose)")

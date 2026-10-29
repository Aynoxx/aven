import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.8.0 : les préférences ne sont jamais lues brutes. Ce que la sonde fige
// (contrat réécrit le 2026-10-27 après l'ajout du mur Pocket, voir
// docs/audits/2026-10-27-voix-pocket-tts.md) : la chaîne COMPLÈTE de
// normalisation — Pocket (Piper retiré en v11.14.0) — et le défaut venu EN DERNIER. Rien n'est
// servi sans passer par la normalisation ; une préférence devenue introuvable
// est recadrée au démarrage.

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
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.8.0.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.8.0"], "node scripts/verify-v11.8.0.mjs", "la sonde a son entrée npm")

const host = read("host/aven-app-host.ts")
const audit = read("docs/audits/2026-10-27-voix-pocket-tts.md")

// ── La chaîne complète de normalisation, défaut en dernier ─────────────────
assert.ok(
  host.includes(
    'voiceName: normalizePocketPreference(pocketProfile(), stored) || defaultVoiceName(),',
  ),
  "loadPrefs normalise Pocket et ne cale sur le défaut qu'en dernier recours",
)
assert.match(host, /function loadPrefs\(\): AppPrefs/, "loadPrefs reste la seule porte de lecture")
assert.match(host, /function defaultVoiceName\(\): string/, "le défaut est une fonction, pas un littéral éparpillé")

// ── Une préférence devenue introuvable est recadrée au démarrage ───────────
assert.match(
  host,
  /if \(loadPrefs\(\)\.voiceName\.startsWith\("pocket:"\)\) savePrefs\(\{ voiceName: POCKET_VOICE_ID \}\)/,
  "une voix Pocket absente est recadrée sur la voix intégrée",
)

// ── L'audit du jour cite la sonde (c'est lui qui l'a amendée) ───────────────
assert.match(audit, /scripts\/verify-v11\.8\.0\.mjs/, "l'audit du 2026-10-27 cite la sonde amendée")
assert.match(audit, /chaîne complète/, "l'audit dit ce que l'assertion exige désormais")

console.log("v11.8.0 verification: OK (préférences : chaîne de normalisation complète, défaut en dernier)")

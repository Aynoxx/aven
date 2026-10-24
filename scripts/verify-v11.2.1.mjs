import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.2.1 : « Aven » prononcé à la française (A français, « ven » anglais) était
// transcrit « Haven » par le STT, donc le réveil restait muet sans laisser de trace.
// La sonde fige les deux moitiés du correctif : les graphies mesurées réveillent,
// et l'élargissement reste borné au MOT ENTIER (aucun « avenue », « avenir »).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const lock = JSON.parse(read("package-lock.json"))
const cargo = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const readme = read("README.md")
const wake = read("host/voice-agent-wake.ts")
const wakeTests = read("tests/voice-agent-wake.test.mjs")

// ── Version cohérente dans tous les manifestes ───────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(lock.version, pkg.version, "package-lock.json correspond à package.json")
assert.equal(lock.packages[""].version, pkg.version, "le paquet racine du lock est synchronisé")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(cargoLock, new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`), "Cargo.lock suit package.json")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.2.1.mjs"), "npm run verify inclut la sonde courante")

// ── A. Les graphies mesurées sont acceptées ─────────────────────────────────
// Le « h » initial est le cœur du correctif : sans lui, « Haven » ne réveille rien.
assert.match(wake, /h\?/, "le motif accepte l'attaque « H » de « Haven »")
assert.match(wake, /WAKE_TOKEN_RE/, "les graphies sont une liste fermée et nommée")
assert.match(wake, /SPLIT_WAKE_NEXT_RE/, "la coupe « a ven » en deux mots reste reconnue")
assert.match(wake, /function wakePosition/, "la détection rend une position, pas seulement un booléen")

// ── B. L'élargissement reste borné au mot entier ────────────────────────────
// Le motif se termine par « $ » : « avenue » ou « avenir » ne peuvent pas entrer
// par préfixe — c'est la régression que l'élargissement risquait le plus.
assert.match(wake, /const WAKE_TOKEN_RE = \/\^.*\$\//, "le motif n'accepte qu'un mot entier")
assert.ok(
  wakeTests.includes('hasWakeWord("Haven, ouvre les notes")') || wakeTests.includes('"Haven, ouvre les notes"'),
  "le test « Haven » existe",
)
assert.ok(wakeTests.includes("l'avenue est longue"), "le faux positif « avenue » est testé")
assert.ok(wakeTests.includes("un avenant au contrat"), "le faux positif « avenant » est testé")

// ── C. Le mot reconnu est retiré, la demande reste entière ──────────────────
assert.match(wake, /const cut = found\.index \+ found\.length/, "le retrait suit le même découpage en mots")
assert.ok(
  wakeTests.includes('stripWakeWord("Haven, ouvre les notes")'),
  "le retrait de la graphie « Haven » est testé",
)

console.log("v11.2.1 verification: OK (réveil vocal — graphies du STT, mot entier, demande intacte)")

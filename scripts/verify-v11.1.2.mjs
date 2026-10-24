import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.1.2 : les formulations naturelles de sourdine doivent être des commandes
// LOCALES, jamais une demande au LLM. Le défaut observé en direct : « mets le
// micro en sourdine » partait au modèle, qui répondait « c'est fait » sans
// couper le micro. La sonde fige les trois formes et le garde-fou anti-musique.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const cargo = read("src-tauri/Cargo.toml")
const commands = read("host/voice-agent-commands.ts")
const tests = read("tests/voice-agent-commands.test.mjs")
const readme = read("README.md")

// ── Version cohérente dans les manifestes ────────────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(readme, new RegExp(`v${pkg.version.replaceAll(".", "\\.")}`), "README porte la note de la version courante")

// ── Les trois formulations signalées sont des règles locales ────────────────
assert.match(commands, /v11\.1\.2/, "le correctif est daté dans le routeur")
assert.ok(commands.includes("mets?-?\\s*toi"), "« mets-toi en sourdine » est reconnu")
assert.match(commands, /mode silencieux/, "« passe en mode silencieux » est reconnu")
assert.match(commands, /en sourdine/, "l'ordre « mets le micro en sourdine » est reconnu")
assert.ok(commands.includes('command: "mute-microphone"'), "la sourdine reste une commande locale")

// ── Les tests couvrent les formulations et le faux positif ──────────────────
assert.ok(tests.includes("mets le micro en sourdine"), "le test couvre « mets le micro en sourdine »")
assert.ok(tests.includes("mets-toi en sourdine"), "le test couvre « mets-toi en sourdine »")
assert.ok(tests.includes("passe en mode silencieux"), "le test couvre « passe en mode silencieux »")
assert.ok(tests.includes("mets la musique en sourdine"), "le test refuse de couper le micro sur un autre son")

console.log("v11.1.2 verification: OK (sourdine — ordre naturel, deuxième personne, mode silencieux)")

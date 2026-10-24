import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.1.3 : l'agent vocal agit seulement DANS Aven. Le modèle n'a aucun outil
// système ; la consigne doit le dire explicitement, sinon il raconte qu'il a
// coupé la musique ou ouvert Spotify. Aucun module vocal ne doit exposer de
// sortie externe (openExternal / shell).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const cargo = read("src-tauri/Cargo.toml")
const speech = read("host/voice-agent-speech.ts")
const commands = read("host/voice-agent-commands.ts")
const hook = read("web/src/voice-agent/use-voice-agent.ts")
const tests = read("tests/voice-agent-speech.test.mjs")
const readme = read("README.md")

// ── Version cohérente dans les manifestes ────────────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(readme, new RegExp(`v${pkg.version.replaceAll(".", "\\.")}`), "README porte la note de la version courante")

// ── La consigne borne le périmètre à l'app ───────────────────────────────────
assert.match(speech, /UNIQUEMENT à l'intérieur d'Aven/, "la consigne limite l'action à Aven")
assert.match(speech, /AUCUN accès à Windows/i, "Windows et les autres applications sont exclus")
assert.match(speech, /musique/, "la musique est nommée comme hors périmètre")
assert.match(speech, /volume/, "le volume est nommé comme hors périmètre")
assert.match(speech, /Spotify|éteindre l'ordinateur/, "les exemples d'actions système sont explicites")
assert.match(tests, /périmètre limité à l'intérieur d'Aven/, "le test couvre le périmètre")

// ── Aucun chemin d'action externe dans les modules vocaux ───────────────────
for (const [file, source] of [["speech", speech], ["commands", commands], ["hook", hook]]) {
  assert.doesNotMatch(source, /openExternal|shellOpen|openApp/, `${file} n'expose aucune sortie système`)
}

console.log("v11.1.3 verification: OK (agent vocal — actions limitées à l'intérieur d'Aven)")

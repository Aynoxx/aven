import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.5.1 : à texte égal, Piper parlait 44 % plus vite que Denise — la voix
// semblait pressée avant même que le timbre ne soit en cause. Ce que la sonde
// fige :
//   A. le débit est une CONSTANTE nommée et documentée par sa mesure ;
//   B. aucune voie de synthèse ne peut l'oublier : `--length_scale` part toujours ;
//   C. un test unitaire verrouille la valeur ET la surcharge ;
//   D. la règle est écrite (doc, README) et la sonde est branchée.

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
const tests = read("tests/piper-tts.test.mjs")

// ── Version cohérente dans tous les manifestes ───────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(lock.version, pkg.version, "package-lock.json correspond à package.json")
assert.equal(lock.packages[""].version, pkg.version, "le paquet racine du lock est synchronisé")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(cargoLock, new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`), "Cargo.lock suit package.json")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.5.1.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.5.1"], "node scripts/verify-v11.5.1.mjs", "la sonde a son entrée npm")

// ── A. Une constante nommée, justifiée par une mesure ──────────────────────
assert.match(piper, /export const PIPER_LENGTH_SCALE = 1\.1\b/, "le débit de référence est nommé")
// La justification chiffrée doit rester à côté de la constante : une valeur
// « au feeling » serait aussi inexplicable qu'indéfendable dans six mois.
const constantAt = piper.indexOf("export const PIPER_LENGTH_SCALE")
const rationale = piper.slice(constantAt - 700, constantAt)
assert.match(rationale, /44 %/, "la mesure d'origine est rappelée (44 % plus vite)")
assert.match(rationale, /101 %/, "la parité mesurée est rappelée (101 % de la durée de Denise)")
// Le pivot doit rester écrit : 1,44 a été écouté et rejeté à l'oreille. Sans
// cette phrase, la prochaine personne « re-calibrera sur la durée » et refera
// l'erreur que l'écoute a corrigée.
assert.match(rationale, /TROP LENTE/, "le rejet à l'écoute de 1,44 est documenté")
assert.match(rationale, /1,44/, "la valeur rejetée est nommée")

// ── B. Aucune synthèse ne peut contourner le réglage ──────────────────────
assert.match(piper, /export function piperArgs\(/, "les arguments sont construits par une fonction pure")
assert.match(piper, /"--length_scale",\s*String\(speech\.lengthScale \?\? PIPER_LENGTH_SCALE\)/, "--length_scale part toujours, avec la constante par défaut")
assert.match(piper, /spawn\(layout\.binary, piperArgs\(layout, output, speech\)/, "le lancement réel passe par ces arguments")

// ── C. Un test verrouille la valeur et l'échappatoire ─────────────────────
assert.ok(existsSync(path.join(root, "tests/piper-tts.test.mjs")), "les tests du module existent")
assert.match(tests, /le débit par défaut reste proche de celui du modèle/, "le test protège le débit par défaut")
assert.match(tests, /une prosodie explicite remplace le débit par défaut/, "le test protège la surcharge")

// ── D. La règle est écrite ───────────────────────────────────────────────
assert.match(agents, /PIPER_LENGTH_SCALE/, "AGENTS.md nomme le réglage")
assert.match(agents, /écoutée puis rejetée/, "AGENTS.md fige la leçon (mesure puis écoute)")
assert.match(readme, new RegExp(`v${pkg.version.replaceAll(".", "\\.")} — `), "README porte la note de la version courante")

console.log("v11.5.1 verification: OK (débit de Piper proche du modèle, parité mesurée rejetée à l'écoute)")

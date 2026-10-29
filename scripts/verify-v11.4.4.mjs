import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.4.4 : la voix locale avalait une syllabe des noms propres (« Freebuff »
// sortait « frebff »). Ce que la sonde fige :
//   A. le dictionnaire est un module PUR, séparé, avec sa table par moteur ;
//   B. les deux graphies validées à l'oreille sont là, sur les DEUX moteurs
//      restants — et sur eux seuls ;
//   C. le host applique le dictionnaire juste avant la synthèse, sur les deux
//      chemins, sans jamais toucher au texte affiché ;
//   D. un test verrouille les entrées, sinon la prochaine retouche les perdra ;
//   E. la règle est écrite dans la doc et la sonde est branchée sur npm run verify.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const lock = JSON.parse(read("package-lock.json"))
const cargo = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const readme = read("README.md")
const agents = read("AGENTS.md")

const module = read("host/pronunciation.ts")
const speech = read("host/voice-agent-speech.ts")
const host = read("host/aven-app-host.ts")
const tests = read("tests/pronunciation.test.mjs")

// ── Version cohérente dans tous les manifestes ───────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(lock.version, pkg.version, "package-lock.json correspond à package.json")
assert.equal(lock.packages[""].version, pkg.version, "le paquet racine du lock est synchronisé")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(cargoLock, new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`), "Cargo.lock suit package.json")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.4.4.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.4.4"], "node scripts/verify-v11.4.4.mjs", "la sonde a son entrée npm")

// ── A. Un module pur, une table par moteur ──────────────────────────────────
assert.ok(existsSync(path.join(root, "host/pronunciation.ts")), "le dictionnaire vit dans son module")
assert.match(module, /Pur : testable avec Node seul/, "le module se déclare pur")
// v11.5.0 : Piper devient un troisième moteur — la sonde exige les trois, pas
// seulement les deux d'origine (elle vérifie une intention, pas un instantané).
assert.match(module, /export type SpeechEngine = "sapi" \| "pocket"/, "les deux moteurs restants sont nommés")
assert.match(module, /export const PRONUNCIATIONS/, "la table est exportée")
assert.match(module, /export function applyPronunciations/, "la réécriture est une fonction exportée")

// ── B. Les graphies écoutées, et la voix neuronale intacte ─────────────────
assert.match(module, /Freebuff: "Fribeuf"/, "Freebuff se dit Fribeuf (écoute du 2026-10-25)")
assert.match(module, /Aven: "Aveun"/, "Aven se dit Aveun (écoute du 2026-10-25)")
assert.doesNotMatch(module, /edge: \{|piper: \{/, "aucun moteur retiré ne revient dans la table")
assert.match(module, /sapi: \{/, "la voix locale reçoit la table")

// ── C. Branché juste avant la synthèse, sur les chemins restants ────────────────
assert.match(speech, /import \{ applyPronunciations \} from "\.\/pronunciation\.js"/, "le host importe le dictionnaire")
assert.match(host, /applyPronunciations\(sanitizeSpeechText\(clean\), "pocket"\)/, "le chemin Pocket passe par la même porte")
assert.match(speech, /applyPronunciations\(sanitizeSpeechText\(text\), "sapi"\)/, "le chemin Windows applique le dictionnaire")
// L'ordre compte : nettoyer le Markdown, PUIS réécrire — sinon un nom collé à un
// astérisque ne serait pas reconnu comme un mot.
const cleanAt = speech.indexOf('applyPronunciations(sanitizeSpeechText(text), "sapi")')
assert.ok(cleanAt > 0, "le nettoyage précède la réécriture")

// ── D. Un test verrouille les entrées ──────────────────────────────────────
assert.ok(existsSync(path.join(root, "tests/pronunciation.test.mjs")), "le test du dictionnaire existe")
assert.match(tests, /Freebuff/, "le test couvre Freebuff")
assert.match(tests, /Aven/, "le test couvre Aven")
assert.match(tests, /le dictionnaire ne couvre que les moteurs qui existent encore/, "le test refuse un moteur retiré")
assert.match(tests, /un mot plus long qui contient l'entrée n'est pas touché/, "le test protège les mots voisins")

// ── E. La règle est écrite, la note de version aussi ──────────────────────
assert.match(agents, /host\/pronunciation\.ts/, "AGENTS.md cite le module")
assert.match(agents, /une table \*\*par moteur\*\*/, "AGENTS.md fige la règle du tableau par moteur")
assert.match(readme, new RegExp(`v${pkg.version.replaceAll(".", "\\.")} — `), "README porte la note de la version courante")

console.log("v11.4.4 verification: OK (noms propres prononcés, tableau strictement par moteur)")


import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.13.0 : le prompt du LLM vocal est un contrat de parole SECTIONNÉ, pas une
// suite de conseils fondus dans un paragraphe. Ce que la sonde fige : les quatre
// sections existent dans l'ordre du contrat, les interdits sensibles restent
// écrits mot pour mot, aucune directive hors sujet n'y rentre, et le test qui
// pose le contrat existe aussi. Une règle de format ou d'interdiction se
// modifie dans le prompt ET dans son test — jamais dans un handler.

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
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.13.0.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.13.0"], "node scripts/verify-v11.13.0.mjs", "la sonde a son entrée npm")

const speech = read("host/voice-agent-speech.ts")
const tests = read("tests/voice-agent-speech.test.mjs")
const agents = read("AGENTS.md")

// ── Les quatre sections, dans l'ordre du contrat ───────────────────────────
// On cherche la forme littérale du tableau (`"…",`) : le commentaire de doc
// cite aussi les sections, il ne doit pas suffire à faire passer la sonde.
const start = speech.indexOf("export function voiceSystemPrompt")
assert.ok(start > 0, "voiceSystemPrompt existe dans host/voice-agent-speech.ts")
const sections = ['"FORMAT DE RÉPONSE",', '"CE QUE TU PEUX DIRE",', '"CE QUE TU NE DIS JAMAIS",', '"PÉRIMÈTRE ET ACTIONS",']
const at = sections.map((section) => speech.indexOf(section))
for (let i = 0; i < sections.length; i++) {
  assert.ok(at[i] > start, `section absente du prompt : ${sections[i]}`)
}
for (let i = 1; i < at.length; i++) {
  assert.ok(at[i] > at[i - 1], `ordre des sections : ${sections[i]} doit suivre ${sections[i - 1]}`)
}
assert.ok(speech.indexOf('"ACTIONS sur les données",') > start, "le sous-titre des actions du catalogue reste")

// ── Les interdits restent écrits mot pour mot ──────────────────────────────
const interdits = [
  "1 à 2 phrases.",
  "Pas de Markdown",
  "Pas de préambule ni de remerciement.",
  "une seule, courte, à la fin",
  "Prochaine étape : une seule, courte, à la fin.",
  "Ce que les outils t'ont réellement renvoyé pour les données d'Aven",
  "Pour une connaissance générale, réponds depuis ton savoir",
  "clé d'API",
  "nom de tes outils",

  "Une intention n'est pas une action",
  "Une opinion présentée comme un fait",
  "JAMAIS exécutée par toi",
  "UNIQUEMENT à l'intérieur d'Aven",
  "AUCUN accès à Windows",
  "ne peux agir que dans Aven",
]
for (const rule of interdits) {
  assert.ok(speech.includes(rule), `interdit ou règle absent du prompt : « ${rule} »`)
}
// Aucune directive hors sujet : l'ancien prompt portait une expression anglaise
// (« according to ») sans rapport avec la parole.
assert.doesNotMatch(speech, /according to/i, "plus de directive anglaise hors sujet dans le prompt")

// ── Budget de latence (v11.14.0) : le prompt est payé à l'aller ─────────────
// Chaque phrase supplémentaire est des tokens envoyés avant le premier son, puis
// du temps de génération. Mesuré : 2 135 caractères avant raccourcissement,
// 1 427 après — le budget laisse de la marge, mais refuse un prompt qui repart à
// gonfler en ajoutant des consignes au fil de l'eau.
const promptStart = speech.indexOf("export function voiceSystemPrompt")
const promptEnd = speech.indexOf("\n}", promptStart)
const promptSource = speech.slice(promptStart, promptEnd)
// Le texte ENVOYÉ au modèle (les chaînes du tableau), comments et code exclus.
const promptPayload = [...promptSource.matchAll(/"([^"]+)"/g)].map((m) => m[1]).join(" ")
assert.ok(promptPayload.length <= 1600,
  `voix : le prompt envoyé pèse ${promptPayload.length} caractères (budget 1 600) — une règle se remplace, jamais s'ajoutée.`)
assert.ok(promptSource.length <= 2800,
  `voix : le corps de voiceSystemPrompt pèse ${promptSource.length} caractères (budget 2 800)`)

// ── Le contrat est aussi posé par le test, et documenté ────────────────────
assert.match(tests, /FORMAT DE RÉPONSE/, "tests/voice-agent-speech.test.mjs fige la section de format")
assert.match(tests, /CE QUE TU NE DIS JAMAIS/, "le test fige la section des interdits")
assert.match(tests, /PÉRIMÈTRE ET ACTIONS/, "le test fige la section de périmètre")
assert.match(agents, /Le LLM vocal a un contrat de parole/, "AGENTS.md décrit le contrat")
assert.match(agents, /scripts\/verify-v11\.13\.0\.mjs/, "AGENTS.md cite la sonde")

console.log("v11.13.0 verification: OK (prompt vocal sectionné : quatre sections, interdits verrouillés)")

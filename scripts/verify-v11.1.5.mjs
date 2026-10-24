import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.1.5 : l'agent vocal envoyait chaque segment à Groq SANS en-tête
// d'authentification. La clé était passée à la place du type MIME, donc la fonction
// de transcription ne la voyait jamais et Groq répondait 401 à chaque demande.
// Cette sonde fige les trois maillons : la clé est un paramètre nommé, l'en-tête est
// posé, et l'appelant du host transmet bien la clé (jamais un type MIME).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const lock = JSON.parse(read("package-lock.json"))
const cargo = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const readme = read("README.md")

const speech = read("host/voice-agent-speech.ts")
const host = read("host/aven-app-host.ts")
const tests = read("tests/voice-agent-speech.test.mjs")

// ── Version cohérente dans tous les manifestes ───────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(lock.version, pkg.version, "package-lock.json correspond à package.json")
assert.equal(lock.packages[""].version, pkg.version, "le paquet racine du lock est synchronisé")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(cargoLock, new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`), "Cargo.lock suit package.json")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")

// ── A. La clé est un paramètre nommé, plus jamais un type MIME ───────────────
assert.match(
  speech,
  /export async function transcribeVoiceSegment\(\s*audio: Blob,\s*apiKey: string,/,
  "la transcription reçoit la clé comme deuxième paramètre nommé",
)
assert.ok(
  !/transcribeVoiceSegment\(\s*audio: Blob,\s*mimeType: string/.test(speech),
  "le deuxième paramètre n'est plus un type MIME (c'est là que la clé se perdait)",
)
assert.match(speech, /audio\.type \|\| "audio\/webm"/, "le type MIME se lit sur le Blob audio")

// ── B. La requête de transcription est authentifiée ─────────────────────────
assert.match(
  speech,
  /Authorization: `Bearer \$\{apiKey\}`/,
  "la requête de transcription porte l'en-tête Authorization",
)
assert.equal(
  (speech.match(/audio\/transcriptions/g) ?? []).length,
  1,
  "une seule route de transcription est construite",
)
assert.match(speech, /Bearer \$\{options\.apiKey\}/, "la réponse au modèle s'authentifie avec la clé reçue")
assert.equal(
  (speech.match(/Authorization:/g) ?? []).length,
  2,
  "les deux appels Groq (transcription et réponse) portent un en-tête Authorization",
)

// ── C. L'appelant du host transmet la clé, pas un type MIME ─────────────────
assert.match(
  host,
  /transcribeVoiceSegment\(new Blob\(\[bytes\], \{ type: mimeType \}\), requireGroqKey\(\), fetch\)/,
  "le host passe requireGroqKey() à la transcription",
)
assert.ok(
  !/transcribeVoiceSegment\(new Blob\([^)]*\), mimeType,/.test(host),
  "le host ne passe plus le type MIME à la place de la clé",
)
assert.match(host, /function requireGroqKey\(\): string/, "la clé manquante lève un message actionnable")
// v11.1.5 : le host ré-emballait `{ text }` déjà rendu par la fonction — le renderer
// recevait `{ text: { text } }`, donc « [object Object] » et un silence total.
assert.match(
  host,
  /return transcribeVoiceSegment\(new Blob\(\[bytes\], \{ type: mimeType \}\), requireGroqKey\(\), fetch\)/,
  "l'IPC de transcription rend le résultat tel quel (une seule enveloppe)",
)
assert.ok(
  !/const text = await transcribeVoiceSegment[\s\S]{0,300}?return \{ text \}/.test(host),
  "le résultat de transcription n'est plus ré-emballé dans un second `{ text }`",
)
const hook = read("web/src/voice-agent/use-voice-agent.ts")
assert.match(hook, /typeof rawText !== "string"/, "le renderer refuse une charge non textuelle au lieu de la stringifier")
assert.ok(
  !/String\(rawText \?\? ""\)/.test(hook),
  "plus de conversion silencieuse d'un objet en « [object Object] »",
)

// ── D. Un refus d'authentification dit où corriger la clé ───────────────────
assert.match(
  speech,
  /status === 401 \|\| status === 403/,
  "les refus d'authentification sont distingués des pannes du service",
)
assert.match(speech, /Réglages → Services IA/, "le message de refus indique où remplacer la clé")

// ── E. Le test couvre la régression (l'en-tête, pas seulement le texte) ─────
assert.match(tests, /captured\.init\.headers\.Authorization, "Bearer cle"/, "le test vérifie l'en-tête Authorization")
assert.match(tests, /describeGroqFailure\(401\)/, "le test couvre le message de clé refusée")

// ── F. La note de version nomme le correctif ────────────────────────────────
assert.match(readme, /v11\.1\.5 — l'agent vocal reçoit enfin sa clé/, "README porte la note de version")

console.log("v11.1.5 verification: OK (transcription vocale authentifiée, 401 expliqué)")

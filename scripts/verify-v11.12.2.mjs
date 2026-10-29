import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.12.2 : le transcript « conversation » du terminal se rattrape à
// l'ouverture. Ce que la sonde fige : le minuteur de rendu se remet à zéro en
// tirant (le défaut « minuteur collant » condamnait tous les scans suivants),
// l'ouverture de la vue déclenche un scan immédiat, et l'état d'une session
// déjà démarrée s'annonce — jamais le silence sur « démarrage ».

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
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.12.2.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.12.2"], "node scripts/verify-v11.12.2.mjs", "la sonde a son entrée npm")

const page = read("web/src/FreebuffAgentPage.tsx")
const agents = read("AGENTS.md")

// ── Le minuteur se remet à zéro en tirant ──────────────────────────────────
assert.match(page, /v11\.12\.2/, "le défaut corrigé est tracé dans la page")
assert.match(
  page,
  /if \(renderTimer\.current\) \{ clearTimeout\(renderTimer\.current\); renderTimer\.current = null \}/,
  "le minuteur de rendu est annulé au lieu d'être laissé coller",
)
assert.match(page, /renderTimer\.current = setTimeout/, "le rendu reste coalescé (un seul minuteur)")
// Hors vue, le callback ne consomme pas le timer : le prochain tir repart de zéro.
assert.match(page, /if \(!showTranscriptRef\.current\) return/, "un timer expiré hors vue ne consomme pas le rendu")

// ── L'ouverture déclenche un scan immédiat ─────────────────────────────────
assert.match(page, /if \(showTranscript\) scheduleRender\(true\)/, "ouvrir la vue relit le buffer sans attendre un octet")
assert.match(page, /const scheduleRender = \(immediate = false\)/, "le mode immédiat existe")

// ── Une session déjà démarrée s'annonce, jamais muette ─────────────────────
assert.match(page, /"En ligne"/, "l'état courant affiche En ligne")
assert.match(page, /Freebuff démarre…/, "l'état de démarrage est un libellé explicite")
assert.match(page, /role="status"/, "l'état est annoncé (aria), pas seulement coloré")

// ── Documenté et référencé ─────────────────────────────────────────────────
assert.match(agents, /Un transcript suspendu se rattrape à l'ouverture/, "AGENTS.md décrit la règle")
assert.match(agents, /scripts\/verify-v11\.12\.2\.mjs/, "AGENTS.md cite la sonde")

console.log("v11.12.2 verification: OK (transcript : minuteur remis à zéro en tirant, scan à l'ouverture, état dit)")

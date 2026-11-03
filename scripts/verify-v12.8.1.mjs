import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v12.8.1 : le titre d'accueil est LE signal de la page — une grande tache d'encre
// d'accent, pas dix micro-touches dispersées. La sonde fige trois choses :
//   1. le titre prend `--accent-ink`, jamais `--accent` en texte (AGENTS.md §3) ;
//   2. la seconde ligne garde son recul en `--muted` (invariant v12.1.0) ;
//   3. les deux thèmes possèdent déjà leur encre, aucun token nouveau n'est créé.
// Elle ne fige pas la teinte exacte : celle-ci suit le preset choisi par l'utilisateur.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const cargo = read("src-tauri/Cargo.toml")
const readme = read("README.md")
const css = read("web/src/styles/workbench.css")
const da = read("web/src/styles/da.css")
const home = read("web/src/workbench/HomeStage.tsx")

// ── Version et enregistrement ──────────────────────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(cargo.match(/^version = "([^"]+)"$/m)?.[1], pkg.version, "Cargo.toml suit package.json")
assert.equal(pkg.scripts["verify:v12.8.1"], "node scripts/verify-v12.8.1.mjs", "la sonde a son entrée npm")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v12.8.1.mjs"), "npm run verify inclut la sonde v12.8.1")
const version = pkg.version.replaceAll(".", "\\.")
assert.match(readme, new RegExp(`^# Aven v${version}\\r?$`, "m"), "README annonce la version courante")
assert.ok(readme.includes("v12.8.1 — le titre d'accueil porte le signal"), "README documente le titre en accent")
assert.ok(readme.includes("scripts/verify-v12.8.1.mjs"), "README cite la sonde")

// ── Le titre porte le signal, sans jamais confondre accent et encre ─────────
const title = css.match(/\.wb-home-title \{[^}]*\}/)?.[0] ?? ""
assert.ok(title.length > 0, "le titre d'accueil a sa règle")
assert.ok(title.includes("color: var(--accent-ink)"), "le titre prend l'encre d'accent")
assert.ok(!title.includes("color: var(--text)"), "le titre n'est plus en texte courant")
assert.ok(!/color:\s*var\(--accent\)/.test(title), "le titre n'utilise jamais --accent en texte")
assert.match(title, /font-size: var\(--font-size-display\)/, "l'échelle d'affichage ne change pas")
assert.match(css, /\.wb-home-title span \+ span \{ color: var\(--muted\); \}/,
  "la seconde ligne recule toujours au lieu de doubler la masse")
assert.match(home, /className="wb-home-title"/, "le titre reste porté par le H1 de l'accueil")

// ── Les deux thèmes ont déjà leur encre : aucun token nouveau ──────────────
assert.match(da, /--accent-ink-light: #9c4f22/, "l'encre claire existe")
assert.match(da, /--accent-ink-dark: #e08a56/, "l'encre sombre existe")
assert.match(da, /--accent-ink: var\(--accent-ink-dark\)/, "le thème sombre consomme l'encre sombre")
assert.match(da, /--accent-ink: var\(--accent-ink-light\)/, "le thème clair consomme l'encre claire")

console.log("v12.8.1 verification: OK (titre d'accueil en encre d'accent, seconde ligne reculée)")

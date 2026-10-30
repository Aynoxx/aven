import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const cargo = read("src-tauri/Cargo.toml")
const home = read("web/src/workbench/HomeStage.tsx")
const shell = read("web/src/workbench/WorkbenchShell.tsx")
const app = read("web/src/app/use-aven-app.ts")
const css = read("web/src/styles/workbench.css")
const readme = read("README.md")
const agents = read("AGENTS.md")

// v12.7.1 : la version avance — figer « 12.7.0 » casserait au bump suivant, comme
// l'avait déjà appris v12.3.1. La sonde protège la SYNCHRONISATION des manifestes,
// pas un numéro.
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "Tauri suit package.json")
assert.equal(cargo.match(/^version = "([^"]+)"$/m)?.[1], pkg.version, "Cargo suit package.json")
assert.equal(pkg.scripts["verify:v12.7.0"], "node scripts/verify-v12.7.0.mjs", "la sonde a son entrée npm")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v12.7.0.mjs"), "npm run verify inclut la sonde")
// Le README du dépôt est en CRLF : un motif qui fige "\n" échoue sur Windows,
// alors que la règle vérifiée est seulement « la première ligne annonce la version ».
const version = pkg.version.replaceAll(".", "\\.")
assert.match(readme, new RegExp(`^# Aven v${version}\\r?$`, "m"), "README annonce la version courante")
assert.ok(readme.includes("v12.7.0 — l'accueil distingue le vide du chargement"), "README documente la finition")

// L'accueil attend la fin des trois chargements avant d'annoncer un état vide.
assert.ok(shell.includes("chatsReady={loadedFor === tab}"), "le shell transmet la disponibilité de l'historique")
// Même piège CRLF que la première ligne du README : la règle est la présence des
// deux champs dans le même objet rendu, pas le caractère de fin de ligne.
assert.match(app, /^    loadedFor,\r?\n    mainBlocks,$/m, "le contrôleur expose loadedFor")
assert.ok(app.includes("setLoadedFor(agent)"), "un chargement d'archives est lui aussi signalé comme terminé")
assert.ok(home.includes("chatsReady: boolean"), "HomeStage reçoit l'état de l'historique")
assert.ok(home.includes("Promise.all(["), "notes et fichiers sont attendus ensemble")
assert.ok(home.includes("setRecentLoaded(true)"), "la fin du chargement des notes et fichiers est mémorisée")
assert.ok(home.includes("const resumeLoading = ready && (!chatsReady || !recentLoaded)"), "le vide n'est montré qu'une fois les sources chargées")
assert.ok(home.includes("{!ready ? ("), "l'absence d'espace prêt est distinguée d'un espace vide")
assert.ok(home.includes("resumeLoading ? ("), "un état de chargement explicite précède l'état vide")
assert.ok(home.includes("entries.map((entry) =>"), "seules les entrées réelles sont rendues")
assert.ok(!home.includes("Rien pour l’instant"), "aucun faux élément vide ne remplit la bande")
assert.ok(!home.includes("SLOTS"), "l'ordre des entrées ne dépend plus de cases artificielles")

// Les trois colonnes restent mesurées ; la hauteur de fenêtre bénéficie d'un repli dédié.
assert.ok(css.includes("grid-template-columns: repeat(3, minmax(0, 1fr))"), "la bande conserve trois colonnes égales")
assert.ok(css.includes(".wb-home-resume-loading {"), "le chargement a un style discret")
assert.ok(css.includes("@media (max-height: 640px) and (min-width: 721px)"), "les fenêtres basses ont une composition resserrée")
assert.ok(css.includes(".wb-home-agent { width: min(36vh, 280px); height: min(36vh, 280px); }"), "la sphère se réduit avec la hauteur")
assert.ok(agents.includes("seules les entrées réellement présentes sont rendues"), "AGENTS.md maintient la règle")

console.log("v12.7.0 verification: OK (chargement réel, reprise sans cases vides, fenêtres basses)")

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v12.7.1 : correctif visible — « Parcourir les fichiers » depuis l'accueil faisait
// tomber la vue Fichiers. La cause n'était pas la vue : la fonction `openFilesView`
// était passée NUE à `onClick`, donc React lui donnait le MouseEvent comme
// `initialPath`, et FilesView appelait `initial.split("/")` sur un objet.
// La règle figée ici : un handler qui accepte un CHEMIN ne se passe jamais nu à un
// événement — on l'enveloppe sans argument, ou on transmet explicitement le chemin.
// L'ancienne sonde v12.1.0 exigeait la forme fautive ; elle est amendée avec ce
// correctif (AGENTS.md, « amender une règle »).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const cargo = read("src-tauri/Cargo.toml")
const shell = read("web/src/workbench/WorkbenchShell.tsx")
const app = read("web/src/app/use-aven-app.ts")
const files = read("web/src/FilesView.tsx")
const readme = read("README.md")

// ── Version et enregistrement ──────────────────────────────────────────────
assert.equal(tauri.version, pkg.version, "Tauri suit package.json")
assert.equal(cargo.match(/^version = "([^"]+)"$/m)?.[1], pkg.version, "Cargo suit package.json")
assert.equal(pkg.scripts["verify:v12.7.1"], "node scripts/verify-v12.7.1.mjs", "la sonde a son entrée npm")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v12.7.1.mjs"), "npm run verify inclut la sonde v12.7.1")
const version = pkg.version.replaceAll(".", "\\.")
assert.match(readme, new RegExp(`^# Aven v${version}\\r?$`, "m"), "README annonce la version courante")
assert.ok(readme.includes("v12.7.1 — « Parcourir les fichiers » ne casse plus l'interface"),
  "README documente le correctif")

// ── Le clic d'accueil n'envoie plus l'événement comme chemin ───────────────
assert.match(shell, /onBrowseFiles=\{\(\) => openFilesView\(\)\}/,
  "« Parcourir les fichiers » ouvre la vue sans lui passer le clic")
assert.ok(!/onBrowseFiles=\{openFilesView\}/.test(shell),
  "la fonction à argument n'est plus passée nue à onClick (forme qui plantait)")
// Un fichier repris, lui, transmet bien un CHEMIN explicite — l'inverse est voulu.
assert.match(shell, /onOpenFile=\{\(path\) => openFilesView\(path\)\}/,
  "un fichier repris transmet son chemin, jamais un événement")
assert.match(app, /const openFilesView = \(initialPath\?: string\)/,
  "l'ouverture accepte un chemin optionnel, pas un événement")
// La vue attend une chaîne : c'est le contrat qui a été violé, pas son implémentation.
assert.match(files, /initialPath\?: string/, "la vue Fichiers type son chemin en chaîne")
assert.match(files, /const dir = initial\.split\("\/"\)/, "le chemin reçu est réellement découpé")

console.log("v12.7.1 verification: OK (« Parcourir les fichiers » ouvre la vue sans recevoir le clic)")

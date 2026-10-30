import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v12.7.2 : le libellé d'une action rapide doit dire son effet réel (AGENTS.md §6).
// « Dicter une note » promettait une dictée ; la capture de Notes crée une note vide
// et ouvre l'éditeur (`noteQuickCapture`), sans micro ni transcription. L'action
// s'appelle désormais « Nouvelle note ». La sonde fige la correspondance libellé ↔
// effet, pas seulement le texte : si la dictée arrive un jour, ce nom devra changer.
//
// AMENDEMENT v12.1.0 : sa liste de libellés et son assertion de handler suivaient
// l'ancien nom — elles sont mises à jour avec ce correctif, pas contournées.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const cargo = read("src-tauri/Cargo.toml")
const home = read("web/src/workbench/HomeStage.tsx")
const shell = read("web/src/workbench/WorkbenchShell.tsx")
const notes = read("web/src/NotesView.tsx")
const readme = read("README.md")

// ── Version et enregistrement ──────────────────────────────────────────────
assert.equal(tauri.version, pkg.version, "Tauri suit package.json")
assert.equal(cargo.match(/^version = "([^"]+)"$/m)?.[1], pkg.version, "Cargo suit package.json")
assert.equal(pkg.scripts["verify:v12.7.2"], "node scripts/verify-v12.7.2.mjs", "la sonde a son entrée npm")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v12.7.2.mjs"), "npm run verify inclut la sonde v12.7.2")
const version = pkg.version.replaceAll(".", "\\.")
assert.match(readme, new RegExp(`^# Aven v${version}\\r?$`, "m"), "README annonce la version courante")
assert.ok(readme.includes("v12.7.2 — « Nouvelle note » dit ce qu'elle fait"), "README documente le renommage")

// ── Le libellé dit l'effet, jusque dans le code ────────────────────────────
assert.match(home, /\/>Nouvelle note/, "l'action s'appelle « Nouvelle note »")
assert.ok(!home.includes("Dicter une note"), "l'ancien libellé qui promettait une dictée a disparu")
assert.ok(!home.includes("onDictateNote"), "le prop ne s'appelle plus « dicter » : il ne dicte pas")
assert.match(home, /onNewNote: \(\) => void/, "le prop porte le nom de l'effet réel")
assert.equal(home.match(/className="button ghost wb-home-action"/g)?.length, 3, "trois actions rapides, toujours")
assert.match(shell, /onNewNote=\{\(\) => \{ setCaptureRequested\(true\); openNotesView\(\) \}\}/,
  "« Nouvelle note » ouvre la capture de Notes")
// La capture crée une note : c'est la preuve que l'action ne peut pas s'appeler « Dicter ».
assert.match(notes, /api\.noteQuickCapture\("", ""\)/, "la capture crée une note de Inbox, elle ne transcrit pas")
assert.match(notes, /if \(!props\.autoCapture \|\| captureOnce\.current\) return/, "la capture demandée s'exécute une seule fois")

console.log("v12.7.2 verification: OK (« Nouvelle note » nomme la capture qui crée la note)")

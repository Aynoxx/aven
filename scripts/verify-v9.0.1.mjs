import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
// v10.0.0 (parité native) : le seed a été extrait de settings.ts (couplé à Electron)
// vers workspace-seed.ts — module pur bundlé dans le host moteur.
// v11.1.3 : la ré-exportation `settings.ts` n'avait plus aucun importeur en
// production. Elle est supprimée ; la sonde lit le module réellement exécuté.
const seed = read("host/workspace-seed.ts")
const readme = read("README.md")

// ── Version ──
const [vMaj, vMin, vPatch] = pkg.version.split(".").map(Number)
assert.ok(vMaj * 10000 + vMin * 100 + vPatch >= 90001, `version trop ancienne : ${pkg.version}`)

// ── Fix principal : les agents sont découverts dans le gabarit, plus de liste statique ──
assert.match(seed, /export function trackedAgentFiles/)
assert.match(seed, /readdirSync\(agentsDir\)/)
assert.match(seed, /\.endsWith\("\.md"\)/)
assert.match(seed, /trackedAgentFiles\(templateDir\)/)
assert.ok(!/\[\s*path\.join\(".opencode", "agents", "code\.md"\)/.test(seed),
  "la liste statique TRACKED liste encore les agents en dur : la synchro dynamique doit la remplacer")
assert.ok(!/"projet\.md"/.test(seed), "« projet.md » ne doit pas revenir en dur dans workspace-seed.ts")

// Le nouvel agent est bien livré dans le gabarit de l'app.
assert.ok(existsSync(path.join(root, ".opencode", "agents", "projet.md")), "projet.md absent du gabarit")

// ── Fix CI : le script test ne passe plus le DOSSIER tests/ à node --test ──
assert.match(pkg.scripts.test, /--test\s+"tests\/\*\.test\.mjs"/, "npm test doit utiliser un glob explicite")
assert.ok(!/--test tests\/$/.test(pkg.scripts.test), "npm test passe encore le dossier tests/ (échec ERR_UNSUPPORTED_DIR_IMPORT sur Node 22)")

// ── Documentation ──
assert.match(readme, /v9\.0\.1/)

console.log("v9.0.1 verification: OK")

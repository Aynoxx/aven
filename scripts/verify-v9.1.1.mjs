import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const app = read("web/src/App.tsx")
const css = read("web/src/App.css")
const freebuff = read("electron/freebuff.ts")
const operations = read("electron/operations.ts")

// ── Version ──
const [vMaj, vMin, vPatch] = pkg.version.split(".").map(Number)
assert.ok(vMaj * 10000 + vMin * 100 + vPatch >= 90101, `version trop ancienne : ${pkg.version}`)

// 1. Plus de doublon « Projet » / « Projets » : l'ancienne carte espaces est retirée.
assert.ok(!/key: "projects"/.test(app), "la carte « Projets » (doublon visuel) doit avoir disparu du hub")
assert.ok(!/hub-card-projects/.test(css), "le CSS de la carte « Projets » doit avoir disparu")
assert.match(app, /key: "project", label: "Projet"/) // la carte orchestrateur reste

// 2. Repli automatique sur OpenCode quand Freebuff tombe sur une erreur de facturation.
assert.match(freebuff, /export function isBillingError/)
assert.match(freebuff, /payment required/i)
assert.match(operations, /if \(!isBillingError\(err\)\) throw err/)
assert.match(operations, /return await this\.send\(id, text, "opencode"\)/)
assert.match(operations, /crédits Codebuff épuisés/)

console.log("v9.1.1 verification: OK")

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const cli = read("host/freebuff-cli.ts")
const main = read("host/aven-app-host.ts") // v10.0.0 : remplace le main Electron
const settingsDialog = read("web/src/SettingsDialog.tsx")
const app = read("web/src/App.tsx")
const css = read("web/src/App.css")

// ── Version ──
const [vMaj, vMin, vPatch] = pkg.version.split(".").map(Number)
assert.ok(vMaj * 10000 + vMin * 100 + vPatch >= 90104, `version trop ancienne : ${pkg.version}`)

// A. Le titre de fenêtre `start` est vide et quoté (sinon « Windows ne trouve pas 'Freebuff' »).
const quoted = 3 // launch, login, install
assert.equal((cli.match(/"start", "\\"\\""/g) || []).length, quoted, "les 3 commandes doivent avoir un titre vide quoté après start")
assert.ok(!cli.includes('"start", "Freebuff"'), "le titre interprétable comme programme doit avoir disparu")
// Garde npm avant installation + repli documenté.
assert.match(main, /checkNpm/)
assert.match(main, /npm est introuvable/)
assert.match(cli, /"npm", "install", "-g", "freebuff"/, "repli d'installation : npm -g freebuff")
// L'installation est visible : bouton désactivé pendant le poll.
assert.match(settingsDialog, /cliInstalling/)
assert.match(settingsDialog, /Installation en cours/)

// B. Bandeau du hub : coin bas-gauche (plus au centre), éphémère et actionnable.
assert.match(css, /\.home-notice \{ position:absolute; z-index:8; left:8px; bottom:8px/)
assert.match(app, /HOME_NOTICE_TTL/)
assert.match(app, /FREEBUFF_MISSING_NOTICE/)
assert.match(app, /home-notice-action/)
assert.match(app, /home-notice-close/)

// C. Hub contenu dans le viewport : rayon réduit + marge haute resserrée.
assert.match(css, /calc\(100vh - 130px\)/)
assert.match(css, /--hub-r: clamp\(196px, 37cqw, 272px\)/)

// D. Page Agents allégée : 2 conversations max + compteur, badge lecture seule, grille fluide.
// v9.6.0 : la grille d'agents devient la page « Tâches » (orchestrateur + modes) ; les
// cartes modes montrent la DERNIÈRE conversation de chaque mode, le badge lecture seule
// quitte les cartes (les modes restent connus par leur description).
// v10.1.0 : les cartes modes ont quitté la page — UNE carte orchestrateur porte un
// switch segmenté (Auto par défaut), rejoué dans le bandeau de conversation.
assert.match(app, /tasks-mode-switch/, "v10.1.0 : le switch de mode remplace les cartes de modes")
assert.match(css, /repeat\(auto-fill, minmax\(340px, 1fr\)\)|repeat\(auto-fit, minmax\(230px, 1fr\)\)/)

console.log("v9.1.4 verification: OK")

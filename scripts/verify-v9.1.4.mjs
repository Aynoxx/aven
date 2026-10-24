import { readApp, readStyles } from "./lib/sources.mjs"
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
const app = readApp()
const css = readStyles()

// ── Version ──
const [vMaj, vMin, vPatch] = pkg.version.split(".").map(Number)
assert.ok(vMaj * 10000 + vMin * 100 + vPatch >= 90104, `version trop ancienne : ${pkg.version}`)

// A. Le titre de fenêtre `start` est vide et quoté (sinon « Windows ne trouve pas 'Freebuff' »).
// v10.3.0 : l'installation n'ouvre plus de console (`start`) — elle est exécutée par le
// gestionnaire vérifié. Les deux commandes console restantes (launch, login) gardent
// le titre vide quoté.
const quoted = 2 // launch, login
assert.equal((cli.match(/"start", "\\"\\""/g) || []).length, quoted, "les 2 commandes console doivent avoir un titre vide quoté après start")
assert.ok(!cli.includes('"start", "Freebuff"'), "le titre interprétable comme programme doit avoir disparu")
// Garde npm avant installation + repli documenté.
assert.match(main, /checkNpm/)
assert.match(main, /npm est introuvable/)
assert.match(cli, /"npm", "install", "-g", "freebuff"/, "repli d'installation : npm -g freebuff")
// L'installation est visible : bouton désactivé pendant le poll.
assert.match(settingsDialog, /cliInstalling/)
assert.match(settingsDialog, /Installation en cours/)

// B. Bandeau du hub : coin bas-gauche (plus au centre), éphémère et actionnable.
// AMENDEMENT v11.0.0 : l'avis n'est plus un coin absolu du hub mais un bandeau de
// la planche Aujourd'hui. L'invariant conservé : éphémère (TTL), actionnable.
assert.match(css, /\.wb-home-notice \{[^}]*margin: 10px 20px 0;/)
assert.match(app, /HOME_NOTICE_TTL/)
assert.match(app, /FREEBUFF_MISSING_NOTICE/)
assert.match(app, /wb-home-notice-action/, "l'avis reste actionnable (il mène à sa destination)")
assert.match(app, /wb-home-notice-close/, "l'avis reste refermable")

// C — AMENDEMENT v11.0.0 : l'orbite du hub a disparu, donc son rayon et sa marge
// haute aussi. L'invariant conservé : le contenu tient dans le viewport, il ne
// pousse pas la fenêtre à défiler (le Poste est en overflow: hidden, seul l'intérieur
// de l'instrument défile).
assert.match(css, /\.wb-app \{[^}]*height: 100dvh;[^}]*overflow: hidden;/s, "le Poste tient dans la fenêtre")
assert.match(css, /\.wb-home-scroll \{[^}]*overflow-y: auto;/, "seule la planche Aujourd'hui défile")

// D. Page Agents allégée : 2 conversations max + compteur, badge lecture seule, grille fluide.
// v9.6.0 : la grille d'agents devient la page « Tâches » (orchestrateur + modes) ; les
// cartes modes montrent la DERNIÈRE conversation de chaque mode, le badge lecture seule
// quitte les cartes (les modes restent connus par leur description).
// v10.1.0 : les cartes modes ont quitté la page — UNE carte orchestrateur porte un
// switch segmenté (Auto par défaut), rejoué dans le bandeau de conversation.
assert.match(app, /tasks-mode-switch/, "v10.1.0 : le switch de mode remplace les cartes de modes")
// v11.1.3 : les deux grilles visées (cartes agents 340 px, cartes modes 230 px) ont
// disparu — la vue Orchestration ne porte plus qu'une carte principale. L'invariant
// « une grille reste fluide, jamais un nombre de colonnes fixe » se vérifie sur la
// grille vivante des tuiles de statistiques.
assert.match(css, /\.stats-grid \{[^}]*repeat\(auto-fit, minmax\(150px, 1fr\)\)/, "les grilles restantes restent fluides (auto-fit)")

console.log("v9.1.4 verification: OK")

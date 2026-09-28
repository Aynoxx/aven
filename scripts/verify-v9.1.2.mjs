import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const cli = read("electron/freebuff-cli.ts")
const main = read("electron/main.ts")
const preload = read("electron/preload.cts")
const types = read("web/src/types.ts")
const app = read("web/src/App.tsx")
const css = read("web/src/App.css")
const settingsDialog = read("web/src/SettingsDialog.tsx")
const icons = read("web/src/icons/Icon.tsx")

// ── Version ──
const [vMaj, vMin, vPatch] = pkg.version.split(".").map(Number)
assert.ok(vMaj * 10000 + vMin * 100 + vPatch >= 90102, `version trop ancienne : ${pkg.version}`)

// 1. Module de lancement : commande spawn-safe, parsing de version, plateforme.
assert.match(cli, /export function buildLaunchCommand/)
assert.match(cli, /export function parseVersionOutput/)
assert.match(cli, /export function unsupportedPlatform/)
assert.match(cli, /\/D/, "start /D doit définir le dossier de départ (pas de cd imbriqué)")

// 2. IPC aux trois endroits.
assert.match(main, /freebuff:status/)
assert.match(main, /freebuff:launch/)
assert.match(main, /parseVersionOutput/)
// v9.1.3 : les arguments verbatim (quoting cassé des chemins avec espaces) ont disparu.
assert.match(main, /detached: true, stdio: "ignore"/)
assert.ok(!/windowsVerbatimArguments/.test(main), "les arguments verbatim doivent avoir disparu (v9.1.3)")
assert.match(preload, /freebuffCliStatus/)
assert.match(preload, /freebuffCliLaunch/)
assert.match(types, /freebuffCliStatus/)
assert.match(types, /freebuffCliLaunch/)

// 3. UI : carte hub + section Réglages, icône terminal.
// v9.2.0 : le TUI freebuff s'ouvre DANS Aven (pont PTY, session persistante) — la
// sonde « freebuffCliLaunch("launch") » du hub est remplacée par le terminal intégré ;
// la console externe reste accessible depuis les Réglages (lancement = install/login).
assert.match(app, /showFreebuffBridge/, "v9.2.0 : le hub ouvre le terminal Freebuff intégré")
assert.match(app, /freebuffCliLaunch\("install"\)/, "le flux d'installation reste branché (avis hub)")
assert.ok(!css.includes(".hub-card-freebuff"), "v9.4.0 : la carte Freebuff a quitté le hub (page Assistants)")
assert.match(css, /--hub-angle:90deg/) // v9.4.0 : 4 cartes réparties à 90°
assert.match(settingsDialog, /Freebuff CLI gratuit/)
// v9.2.0 : le lancement quotidien vit dans le terminal intégré (carte hub) ; les
// Réglages gardent connexion (console externe) et installation.
assert.match(settingsDialog, /Se connecter/)
assert.match(settingsDialog, /Installer le CLI/)
assert.match(icons, /case "terminal"/)

console.log("v9.1.2 verification: OK")

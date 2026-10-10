import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

// Sondes v9.2.0 : PTY du CLI freebuff embarqué (protocole freebuff-pty). Chaque
// assertion verrouille un point du protocole ou une règle du projet (RULES.md).

const pkg = JSON.parse(read("package.json"))
const [vMaj, vMin, vPatch] = pkg.version.split(".").map(Number)
assert.ok(vMaj * 10000 + vMin * 100 + vPatch >= 90200, `version trop ancienne : ${pkg.version}`)

const pty = read("host/freebuff-pty.ts")
const dialog = read("web/src/FreebuffAgentPage.tsx")
const main = read("host/aven-app-host.ts") // v10.0.0 : remplace le main Electron
const preload = read("web/src/types.ts") // v10.0.0 : remplace le preload (contrat OpenCodeApi)
const types = read("web/src/types.ts")
const css = read("web/src/App.css")
const readme = read("README.md")

// A. Le module PTY est PUR (sans Electron) et testé — RULES.md §8.
// v9.2.1 (revue) : transport = @lydell/node-pty (binaires PRÉBUILDÉS N-API, vérifiés
// sous l'Electron du projet — node-pty officiel exige MSVC). Sans compilation.
assert.ok(!/from "electron"/.test(pty), "freebuff-pty.ts ne doit pas dépendre d'Electron")
assert.match(pty, /@lydell\/node-pty/, "le transport doit être le ConPTY prébuildé (@lydell/node-pty)")
assert.match(pty, /loadPtyModule/, "le module PTY est chargé explicitement au boot (chemin dev/packagé)")
// v10.0.0 : le packaging passe par les resources Tauri (plus electron-builder).
const tauriConf92 = JSON.parse(read("src-tauri/tauri.conf.json"))
assert.ok(Object.keys(tauriConf92.bundle?.resources ?? {}).some((f) => f.includes("@lydell/node-pty")), "les binaires prébuildés doivent être packagés")
assert.ok(existsSync(path.join(root, "tests", "freebuff-pty.test.mjs")), "tests du PTY attendus")

// B. Contrats du protocole : retry de boot borné, backoff, scrollback rejoué et borné.
assert.match(pty, /MAX_PTY_BOOT_ATTEMPTS = 3/, "3 tentatives de boot max")
assert.match(pty, /PTY_BOOT_GRACE_MS = 5_000/, "grâce de boot de 5 s (ECONNRESET connu)")
assert.match(pty, /ptyBackoffMs/, "le retry de boot a un backoff")
assert.match(pty, /MAX_PTY_SCROLLBACK/, "le scrollback est borné")
assert.match(pty, /buildPtyCommand/, "la commande PTY est factorisée (testable)")

// C. Session persistante côté renderer : fermer la vue n'arrête PAS le process.
assert.match(dialog, /session persistante|persistante/i, "le dialogue documente la persistance")
assert.ok(dialog.includes("freebuffCliLaunch(\"launch\""), "la vue démarre le PTY via freebuff:launch (dimensions ajoutées en v9.4.0)")
assert.match(dialog, /freebuff\.pty\.replay/, "le scrollback rejoué est attendu à la réouverture")
assert.match(dialog, /agents-page/, "v9.5.0 : la vue est une PAGE pleine (plus de dialogue recouvrant)")

// D. IPC complet des deux côtés (main + preload + types), convention domaine:action.
assert.match(main, /case "freebuffPtyInput"/)
assert.match(main, /case "freebuffPtyResize"/)
assert.match(main, /case "freebuffPtySignal"/)
assert.match(main, /case "freebuffPtyRestart"/)
assert.match(preload, /freebuffPtyInput/)
assert.match(preload, /freebuffPtyRestart/)
assert.match(types, /freebuffPtyInput: \(data: string\) => Promise<void>/)
assert.match(types, /freebuffPtyRestart: \(\) => Promise<void>/)

// E. L'action « launch » démarre le PTY avec les mêmes garde-fous anti-takeover (v9.1.5,
// affinés par l'E2E v9.2.1) : le CLI externe est refusé, NOTRE session existante est
// réjointe (replay), la détection vérifie le chemin réel du CLI (pas l'app desktop).
assert.match(main, /if \(!isFreebuffPtyActive\(\) && await isFreebuffProcessRunning\(\)\) throw new Error\(freebuffBusyMessage\(\)\)/)
assert.match(main, /type: "freebuff\.pty\.replay"/, "notre session existante doit être réjointe (replay), jamais bloquée")
assert.match(main, /ExecutablePath -like/, "la détection vérifie le chemin du CLI (.config\\manicode), pas seulement le nom")
assert.match(main, /startFreebuffPty\(\{\s*cwd: requireWorkspace\(\)/, "le PTY démarre sur l'espace ACTIF (jamais un dossier vide)")

// F. Arrêt propre : le PTY meurt avec l'app (pas de freebuff orphelin après quit).
assert.match(main, /stopFreebuffPty\(\)/, "le shutdown du host doit arrêter le PTY")
assert.match(read("src-tauri/src/lib.rs"), /"shutdown"/, "la fermeture de l'app envoie shutdown au host avant le kill")

// G. Le flux passe par IPC et les événements existants — AUCUN serveur WS local.
assert.match(dialog, /freebuff\.pty\.data/, "le flux PTY arrive via onEvent (freebuff.pty.data)")
assert.ok(!existsSync(path.join(root, "electron", "freebuff-bridge.ts")), "le pont WS doit rester supprimé (remplacé par le PTY IPC)")
assert.ok(!existsSync(path.join(root, "web", "src", "freebuff-bridge-client.ts")), "le client WS doit rester supprimé")
assert.ok(!/freebuffBridgeStart/.test(preload), "preload : les canaux WS doivent avoir disparu")
assert.ok(!/freebuffBridgeStart/.test(types), "types : les canaux WS doivent avoir disparu")
assert.ok(!/"ws"/.test(JSON.stringify(pkg.dependencies)), "la dépendance ws doit être retirée (plus aucun WebSocket serveur)")

// H. UI : rendu par xterm.js (pas un <pre>), thème dérivé, styles chargés.
assert.match(dialog, /from "@xterm\/xterm"|import\("@xterm\/xterm"\)/, "le rendu passe par xterm.js")
assert.match(css, /\.bridge-term-host/, "styles de l'hôte terminal attendus")
assert.match(read("web/src/main.tsx"), /@xterm\/xterm\/css\/xterm\.css/, "la CSS xterm est chargée au boot")

// I. Documentation utilisateur.
assert.match(readme, /terminal Freebuff intégré|PTY/i, "README : note utilisateur du terminal intégré")

console.log("v9.2.0 verification: OK")

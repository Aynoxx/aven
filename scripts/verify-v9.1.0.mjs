import { readApp, readStyles } from "./lib/sources.mjs"
import assert from "node:assert/strict"
import { existsSync as existsSync2 } from "node:fs"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const app = readApp()
const css = readStyles()
const appearance = read("web/src/appearance.ts")
const settingsDialog = read("web/src/SettingsDialog.tsx")
// v11.1.3 : la politique de notification et les préférences n'ont plus de jumeau
// TypeScript mort — la sonde lit le code qui s'exécute vraiment (notify.rs et
// aven-app-host.ts). Un module sans importeur ne protège plus rien.
const notify = read("src-tauri/src/notify.rs")
const diagnostic = read("host/diagnostic.ts")
const main = read("host/aven-app-host.ts") // v10.0.0 : remplace le main Electron
const preload = read("web/src/types.ts") // v10.0.0 : remplace le preload (contrat OpenCodeApi)
const types = read("web/src/types.ts")
const readme = read("README.md")

// ── Version ──
const [vMaj, vMin] = pkg.version.split(".").map(Number)
assert.ok(vMaj > 9 || (vMaj === 9 && vMin >= 1), `version trop ancienne : ${pkg.version}`)

// ① projet à part : instrument dédié + badge orchestrateur, hors sélecteur.
// v11.0.0 : le hub a disparu ; le rail porte la destination Terminal, la page
// Orchestration garde son badge et sa carte dédiée.
const workbench = read("web/src/workbench/WorkbenchShell.tsx")
assert.match(workbench, /kind: "terminal", label: "Terminal"/)
assert.match(app, /agent-card-orchestrator/)
assert.match(app, /orchestrator-badge/)
assert.ok(!css.includes(".hub-card")) // le hub a disparu (v11.0.0)

// ② plus de sélecteur d'agents en haut à droite.
assert.ok(!/showAgentPicker/.test(app), "showAgentPicker doit avoir disparu")
assert.ok(!/home-agent-chip/.test(app), "le chip « Agent ▾ » doit avoir disparu")

// ③ retour à Aujourd'hui : le rail et l'onglet plancher, plus de barre de fenêtre.
assert.match(workbench, /onClick=\{goHome\}/)
assert.match(workbench, /kind: "home", label: "Aujourd’hui"/)
assert.match(app, /const goHome = \(\) => openInstrumentTab\("home"\)/)

// ④ quitter une conversation → instrument Orchestration.
assert.match(app, /const openAgentsPage = \(\) => openInstrumentTab\("orchestration"\)/)
assert.match(workbench, /kind: "orchestration", label: "Orchestration"/, "le rail nomme sa destination actuelle")

// ⑤ Freebuff moteur de tous les agents.
// v9.1.3 : la clé Codebuff, le bouton composeur et le réglage « moteur des agents » sont
// retirés (l'envoi repart sur OpenCode). v9.1.6 : le module backend-choice et le chemin
// main freebuff sont PURGÉS — les sondes correspondantes le vérifient désormais par absence.
assert.ok(!existsSync2("web/src/backend-choice.ts"), "backend-choice.ts doit rester supprimé (purge v9.1.6)")
assert.doesNotMatch(appearance, /freebuffAsEngine/, "le champ freebuffAsEngine doit avoir disparu de l'apparence (v9.1.3)")
assert.doesNotMatch(settingsDialog, /Utiliser Freebuff comme moteur des agents/, "le réglage « Utiliser Freebuff comme moteur des agents » doit avoir disparu (v9.1.3)")

// ⑥a notifications de bureau.
assert.match(notify, /pub\(crate\) fn should_notify/)
assert.match(notify, /window_focused/)
assert.match(notify, /NotifyKind::TurnError => true/)
assert.match(main, /prefs\.json/)
// v10.0.0 : AppUserModelId Electron → identité Tauri (tauri.conf.json).
assert.match(read("src-tauri/tauri.conf.json"), /"identifier": "com\.local\.aven"/)
assert.match(read("src-tauri/src/notify.rs"), /notify_from_event/)
// v10.0.0 : turnStarts (main) → mesure de durée de tour côté Rust (notify.rs).
assert.match(read("src-tauri/src/notify.rs"), /started\.elapsed\(\)\.as_millis\(\)/)
assert.match(main, /case "prefs"/)
assert.match(main, /case "setNotifications"/)
assert.match(preload, /setNotifications/)
assert.match(types, /setNotifications/)
assert.match(settingsDialog, /Activer les notifications/)

// ⑥b diagnostic copiable sans fuite de clé.
assert.match(diagnostic, /redactSecrets/)
assert.match(main, /case "diagnostic"/)
assert.match(main, /keyIds: Object\.entries\(s\.keys\)/)
assert.match(settingsDialog, /Copier le diagnostic/)

// ⑥c barre d'onglets morte supprimée.
assert.ok(!/className="tabs"/.test(app), "la barre .tabs morte doit être retirée du JSX")
assert.ok(!/\.tabs \{/.test(css), "le CSS .tabs doit être retiré")
assert.ok(!/showTabs/.test(appearance), "le champ showTabs doit avoir disparu")
assert.ok(!/showTabs/.test(settingsDialog), "le réglage « Barre des agents » doit avoir disparu")

// ⑦ documentation.
assert.match(readme, /v9\.1\.0/)

console.log("v9.1.0 verification: OK")

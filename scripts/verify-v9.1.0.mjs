import assert from "node:assert/strict"
import { existsSync as existsSync2 } from "node:fs"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const app = read("web/src/App.tsx")
const css = read("web/src/App.css")
const appearance = read("web/src/appearance.ts")
const settingsDialog = read("web/src/SettingsDialog.tsx")
const notify = read("host/notify-policy.ts")
const prefs = read("host/prefs.ts")
const diagnostic = read("host/diagnostic.ts")
const main = read("host/aven-app-host.ts") // v10.0.0 : remplace le main Electron
const preload = read("web/src/types.ts") // v10.0.0 : remplace le preload (contrat OpenCodeApi)
const types = read("web/src/types.ts")
const readme = read("README.md")

// ── Version ──
const [vMaj, vMin] = pkg.version.split(".").map(Number)
assert.ok(vMaj > 9 || (vMaj === 9 && vMin >= 1), `version trop ancienne : ${pkg.version}`)

// ① projet à part : carte hub dédiée + badge orchestrateur, hors sélecteur.
assert.match(app, /key: "project", label: "Projet"/)
assert.match(app, /hub-card-\$\{item\.key\}/) // classe construite depuis item.key
assert.match(app, /agent-card-orchestrator/)
assert.match(app, /orchestrator-badge/)
assert.ok(css.includes("--hub-angle:90deg")) // cartes réparties régulièrement (v9.4.0 : 4 cartes à 90°)
assert.match(css, /\.hub-card-project/)

// ② plus de sélecteur d'agents en haut à droite.
assert.ok(!/showAgentPicker/.test(app), "showAgentPicker doit avoir disparu")
assert.ok(!/home-agent-chip/.test(app), "le chip « Agent ▾ » doit avoir disparu")

// ③ bouton Accueil dans la barre de fenêtre, masqué sur l'accueil.
assert.match(app, /window-chrome-home/)
assert.match(app, /\{!showHome && \(/)
assert.match(app, /const goHome/)

// ④ quitter une conversation → page Agents.
assert.match(app, /setShowHome\(false\); setShowAgentsPage\(true\)/)
assert.match(app, /Voir la page des agents/)

// ⑤ Freebuff moteur de tous les agents.
// v9.1.3 : la clé Codebuff, le bouton composeur et le réglage « moteur des agents » sont
// retirés (l'envoi repart sur OpenCode). v9.1.6 : le module backend-choice et le chemin
// main freebuff sont PURGÉS — les sondes correspondantes le vérifient désormais par absence.
assert.ok(!existsSync2("web/src/backend-choice.ts"), "backend-choice.ts doit rester supprimé (purge v9.1.6)")
assert.doesNotMatch(appearance, /freebuffAsEngine/, "le champ freebuffAsEngine doit avoir disparu de l'apparence (v9.1.3)")
assert.doesNotMatch(settingsDialog, /Utiliser Freebuff comme moteur des agents/, "le réglage « Utiliser Freebuff comme moteur des agents » doit avoir disparu (v9.1.3)")

// ⑥a notifications de bureau.
assert.match(notify, /export function shouldNotify/)
assert.match(notify, /windowFocused/)
assert.match(notify, /input\.kind === "turn-error"\) return true/)
assert.match(prefs, /prefs\.json/)
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

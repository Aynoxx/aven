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
const backend = read("web/src/backend-choice.ts")
const appearance = read("web/src/appearance.ts")
const settingsDialog = read("web/src/SettingsDialog.tsx")
const freebuff = read("electron/freebuff.ts")
const notify = read("electron/notify-policy.ts")
const prefs = read("electron/prefs.ts")
const diagnostic = read("electron/diagnostic.ts")
const main = read("electron/main.ts")
const preload = read("electron/preload.cts")
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
assert.match(css, /--hub-angle:60deg/) // cartes réparties régulièrement (v9.1.1 : 6 cartes)
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
assert.match(backend, /hasCodebuffKey && options\.pref/)
assert.ok(!/tab === "code"/.test(backend), "la règle ne doit plus être limitée à l'agent code")
assert.match(appearance, /freebuffAsEngine/)
assert.match(appearance, /freebuffDefaultCode/) // migration de l'ancienne clé conservée
assert.match(settingsDialog, /Utiliser Freebuff comme moteur des agents/)
assert.match(freebuff, /options\.task === "projet" \? 30 : 20/)

// ⑥a notifications de bureau.
assert.match(notify, /export function shouldNotify/)
assert.match(notify, /windowFocused/)
assert.match(notify, /input\.kind === "turn-error"\) return true/)
assert.match(prefs, /prefs\.json/)
assert.match(main, /setAppUserModelId\("com\.local\.aven"\)/)
assert.match(main, /notifyDesktop/)
assert.match(main, /turnStarts\.set\(sessionID, Date\.now\(\)\)/)
assert.match(main, /prefs:get/)
assert.match(main, /prefs:setNotifications/)
assert.match(preload, /setNotifications/)
assert.match(types, /setNotifications/)
assert.match(settingsDialog, /Activer les notifications/)

// ⑥b diagnostic copiable sans fuite de clé.
assert.match(diagnostic, /redactSecrets/)
assert.match(main, /app:diagnostic/)
assert.match(main, /keyIds: Object\.keys\(loadKeys\(\)\)/)
assert.match(settingsDialog, /Copier le diagnostic/)

// ⑥c barre d'onglets morte supprimée.
assert.ok(!/className="tabs"/.test(app), "la barre .tabs morte doit être retirée du JSX")
assert.ok(!/\.tabs \{/.test(css), "le CSS .tabs doit être retiré")
assert.ok(!/showTabs/.test(appearance), "le champ showTabs doit avoir disparu")
assert.ok(!/showTabs/.test(settingsDialog), "le réglage « Barre des agents » doit avoir disparu")

// ⑦ documentation.
assert.match(readme, /v9\.1\.0/)

console.log("v9.1.0 verification: OK")

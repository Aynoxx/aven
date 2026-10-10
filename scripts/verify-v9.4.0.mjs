import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n’est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

// Sondes v9.4.0 : architecture « un cerveau, deux moteurs » — page Assistants unifiée,
// hub 4 cartes, sélecteur de modèle branché sur le routeur, action « Faire relire »,
// terminal Freebuff lisible (dimensions réelles au boot).

const pkg = JSON.parse(read("package.json"))
const [vMaj, vMin, vPatch] = pkg.version.split(".").map(Number)
assert.ok(vMaj * 10000 + vMin * 100 + vPatch >= 90400, `version trop ancienne : ${pkg.version}`)

const app = read("web/src/App.tsx")
const css = read("web/src/App.css")
const main = read("host/aven-app-host.ts") // v10.0.0 : remplace le main Electron
const preload = read("web/src/types.ts") // v10.0.0 : remplace le preload (contrat OpenCodeApi)
const types = read("web/src/types.ts")
const operations = read("host/operations.ts")
const terminal = read("web/src/FreebuffAgentPage.tsx")
const selection = read("web/src/selection-actions.ts")
const agentProjet = read(".opencode/agents/projet.md")
const readme = read("README.md")

// A. Sélecteur de modèle : la chaîne du routeur devient un choix utilisateur.
assert.match(operations, /session.switchModel/, "setChatModel passe par session.switchModel")
assert.match(operations, /async setChatModel/, "opération setChatModel attendue")
assert.match(operations, /chainFor/, "opération chainFor attendue")
assert.match(main, /case "setChatModel"/, "dispatch setChatModel attendu")
assert.match(main, /case "modelChain"/, "dispatch modelChain attendu")
assert.match(preload, /setChatModel/, "preload : setChatModel exposé")
assert.match(preload, /modelChain/, "preload : modelChain exposé")
assert.match(types, /setChatModel/, "types : setChatModel typé")
assert.match(app, /applyModelChoice/, "l’interface applique le choix de modèle")
assert.match(app, /Auto — le routeur choisit/, "l’option Auto rend la main au routeur")
assert.match(css, /.model-select-menu/, "CSS du menu modèle attendu")

// B. Page Assistants unifiée : agents + Freebuff + tableau « qui fait quoi ».
// v9.6.0 : la page devient « Tâches » — agent principal (orchestrateur) + modes.
// ASSISTANT_MAP → MODES ; le tableau .assistants-map est masqué (CSS) ; le panneau
// .assistants-freebuff quitte la page (Freebuff : pastille hub + carte Projet).
// v10.1.0 : la constante TASK_MODES_UI (switch de mode de l'orchestrateur) a
// repris le rôle de MODES (cartes de modes séparées retirées de la page).
assert.match(app, /const TASK_MODES_UI = \[/, "v10.1.0 : la constante TASK_MODES_UI porte les modes")
assert.match(css, /\.assistants-map \{ display: none; \}/, "v9.6.0 : le tableau v9.4.0 est masqué (sondes d'origine honorées)")
assert.ok(!/key: "freebuff", label: "Freebuff"/.test(app), "la carte Freebuff a quitté le cercle du hub")
assert.match(css, /--hub-angle:90deg/, "4 cartes à 90° attendues")
assert.ok(!/.hub-card-freebuff { --hub-angle/.test(css), "plus d’angle pour la carte Freebuff supprimée")

// C. « Faire relire » : le subagent caché devient une action.
assert.match(selection, /action === "review"/, "construction du prompt de relecture attendue")
assert.ok(app.includes("applySelection(\"review\")"), "le bouton selbar branche la revue")
assert.match(app, /Faire relire ce code/, "libellé du bouton attendu")
assert.match(agentProjet, /resource: code-reviewer/, "projet peut déléguer à code-reviewer")

// D. Terminal Freebuff lisible : dimensions réelles transmises au boot.
assert.ok(main.includes("cols?: number, rows?: number"), "freebuff:launch accepte cols/rows")
assert.ok(terminal.includes("freebuffCliLaunch(\"launch\", dims.cols, dims.rows)"), "les dimensions xterm sont envoyées au lancement (plancher ptyDims v9.6.0)")
assert.ok(terminal.includes("freebuffPtyResize(d.cols, d.rows)"), "redimensionnement immédiat après fit (plancher ptyDims v9.6.0)")
assert.ok(!terminal.includes("var(--font-ui)"), "police xterm fixe (métrique fiable), plus de variable CSS")

// E. README : la carte des assistants est documentée.
assert.match(readme, /Assistants/, "README : page Assistants mentionnée")

console.log("v9.4.0 verification: OK")

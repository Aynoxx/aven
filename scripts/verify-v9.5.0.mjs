import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

// Sondes v9.5.0 : le pont agents — Aven devient le cerveau unique des deux moteurs.
// ① catalogue .agents/ généré (mêmes agents que l'interface, modèles gratuits) ;
// ② --trust-agents au lancement du CLI ; ③ reprise de conversation (--continue) ;
// ④ serveur MCP des notes exposé à Freebuff ; ⑤ la vue « terminal » devient une
// conversation d'agent (transcript, composeur, prompts rapides, terminal en option).

const pkg = JSON.parse(read("package.json"))
const [vMaj, vMin, vPatch] = pkg.version.split(".").map(Number)
assert.ok(vMaj * 10000 + vMin * 100 + vPatch >= 90500, `version trop ancienne : ${pkg.version}`)

const bridge = read("electron/agents-bridge.ts")
const pty = read("electron/freebuff-pty.ts")
const main = read("electron/main.ts")
const preload = read("electron/preload.cts")
const types = read("web/src/types.ts")
const prefs = read("electron/prefs.ts")
const dialog = read("web/src/FreebuffAgentPage.tsx")
const css = read("web/src/App.css")
const readme = read("README.md")

// A. Pont catalogue : conversion .opencode → .agents (TypeScript AgentDefinition).
assert.match(bridge, /export function freeAgentId/, "ids aven-* dérivés des agents OpenCode")
assert.match(bridge, /export function toAgentFileContent/, "conversion en définition TypeScript attendue")
assert.match(bridge, /export function buildAgentsDir/, "synchronisation du dossier .agents attendue")
assert.match(bridge, /GENERATED_BANNER/, "les fichiers générés portent le marqueur de resynchronisation")
assert.match(bridge, /includeMessageHistory/, "le mode (primary/subagent) pilote l'historique")
assert.match(bridge, /agent-reviewer|code-reviewer/, "le relecteur a son traitement lecture seule")

// B. Le lancement du CLI partage le catalogue (--trust-agents) et peut reprendre.
assert.match(pty, /trust-agents/, "--trust-agents ajouté à la commande PTY")
assert.match(pty, /--continue/, "--continue (reprise) ajouté à la commande PTY")
assert.match(main, /trustAgents: existsSync/, "les flags suivent la présence du pont dans l'espace")
assert.match(main, /loadPrefs\(\)\.freebuffResume/, "la reprise lit la préférence utilisateur")
assert.match(main, /buildAgentsDir\(/, "le pont est resynchronisé à chaque boot d'espace")
assert.match(main, /readTemplateAgents\(templateDir\)/, "les agents viennent du gabarit (source de vérité)")

// C. Préférence de reprise, de bout en bout.
assert.match(prefs, /saveFreebuffResume/, "préférence persistée")
assert.match(main, /prefs:setFreebuffResume/, "IPC de la préférence")
assert.match(preload, /setFreebuffResume/, "preload : setFreebuffResume exposé")
assert.match(types, /freebuffResume/, "types : freebuffResume typé")

// D. Serveur MCP des notes : embarqué, configuré par le mcp.json généré.
assert.ok(existsSync(path.join(root, "aven-mcp-server.mjs")), "serveur MCP embarqué attendu à la racine")
const server = read("aven-mcp-server.mjs")
assert.match(server, /aven_notes_list/, "outil liste des notes")
assert.match(server, /aven_notes_search/, "outil recherche dans les notes")
assert.match(server, /--notes-dir/, "le dossier des notes est passé en argument (serveur hors espace)")
assert.match(bridge, /aven-mcp-server\.mjs|mcpServers/, "le mcp.json généré pointe vers le serveur Aven")
assert.ok(pkg.build.extraResources.some((e) => String(e.from).includes("aven-mcp-server.mjs")), "le serveur MCP est embarqué dans les resources packagées")

// E. La vue n'est plus un terminal : conversation d'agent.
assert.match(dialog, /agent-chat/, "transcript conversation dérivé du buffer")
assert.match(dialog, /agent-composer/, "composeur d'agent attendu")
assert.match(dialog, /agent-quick/, "prompts rapides attendus")
assert.match(dialog, /Vue terminal/, "le terminal brut reste accessible en option")
assert.match(dialog, /presenceOf/, "présence (En ligne / démarre…) attendue")
assert.match(dialog, /NON_SPEECH/, "les spinners et bordures sont filtrés du transcript")
assert.match(css, /\.agent-composer/, "CSS du composeur attendue")
assert.match(css, /\.agent-term-hidden/, "CSS de l'émulateur caché attendue")
// v9.5.1 : la vue est une PAGE pleine (agents-main), pas un dialogue recouvrant.
assert.match(dialog, /agents-main/, "la vue agent est routée comme la page Agents")
assert.ok(!dialog.includes("\"overlay\""), "plus aucun overlay : la page se navigue, elle ne recouvre pas")

// F. README : le pont est documenté.
assert.match(readme, /agents-bridge|\.agents/, "README : pont agents mentionné")

console.log("v9.5.0 verification: OK")

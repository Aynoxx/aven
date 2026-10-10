import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

// Sondes v9.6.0 : ① Espaces → Réglages ; ② Projet ouvre la page Freebuff (label gardé) ;
// ③ fix du TUI (plancher 80×24, émulateur superposé) ; ④ barre de session extraite du TUI ;
// ⑤ « Tâches » (spécialistes), agent central délégant, priorités refaites, Groq en chat.

const pkg = JSON.parse(read("package.json"))
const [vMaj, vMin, vPatch] = pkg.version.split(".").map(Number)
assert.ok(vMaj * 10000 + vMin * 100 + vPatch >= 90600, `version trop ancienne : ${pkg.version}`)

const app = read("web/src/App.tsx")
const page = read("web/src/FreebuffAgentPage.tsx")
const dims = read("web/src/pty-dims.ts")
const css = read("web/src/App.css")
const providers = read("host/providers.ts")
const priorities = read("host/priorities.ts")
const table = JSON.parse(read("model-priorities.json"))
const agentProjet = read(".opencode/agents/projet.md")
const readme = read("README.md")

// A. Espaces : le raccourci du hub est retiré, la gestion vit dans les Réglages.
assert.ok(!app.includes('aria-label="Gérer les espaces" title="Gérer les espaces"'), "le bouton « Espaces » a quitté la barre du hub")
assert.match(app, /openConfiguration\("workspaces"\)/, "la route vocale mène aux Réglages → Configuration")

// B. La carte Projet ouvre l'agent Freebuff (label et icône conservés).
// v9.7.1 : la carte passe source="project" (shared element carte→page), même destination.
assert.match(app, /key: "project", label: "Projet", kind: "project", hint: "Agent central \(Freebuff\)", action: \(\) => openFreebuffAgent\("project"\)/, "carte Projet → openFreebuffAgent(project)")
assert.ok(!app.includes('action: () => selectAgent("projet") },'), "l'ancien selectAgent projet a disparu du hub")

// C. Fix du TUI : plancher de dimensions testé + émulateur superposé (vraies dimensions).
assert.match(dims, /export function ptyDims/, "plancher ptyDims dans le module pur")
assert.match(dims, /PTY_MIN_COLS = 80/, "plancher colonnes 80")
assert.match(dims, /PTY_MIN_ROWS = 24/, "plancher lignes 24")
assert.match(page, /from "\.\/pty-dims"/, "la page utilise le module plancher")
assert.match(css, /\.agent-stage .*position: relative/s, "scène conversation/terminal")
assert.match(css, /\.agent-stage \.agent-term-hidden \{ position: absolute; inset: 0/, "l'émulateur caché garde de vraies dimensions (plus de 1×1 px)")

// D. Barre de session du TUI : extraite et affichée (module freebuff-transcript v9.6.0).
assert.match(page, /freebuff-sessionbar/, "barre de session rendue dans la page")
assert.match(css, /\.freebuff-sessionbar/, "CSS de la barre de session")
assert.match(page, /setSessionBar\(bar\)/, "capture effective depuis le buffer")

// E. « Tâches » : les spécialistes, et le hub ne parle plus d'« Agents ».
assert.match(app, /key: "agents", label: "Tâches", kind: "agent", hint: "Spécialistes par tâche"/, "carte renommée Tâches")
assert.ok(!/label: "Agents"/.test(app), "l'ancien label « Agents » a disparu du hub")

// F. Agent central : le prompt projet délègue et ne code jamais lui-même.
assert.match(agentProjet, /CERVEAU CENTRAL/, "rôle central affirmé")
// v10.0.0 : \r?\n et non \n — sous Windows (autocrlf=true) le checkout est CRLF et
// une regex \n-seul ne peut jamais matcher. Même exigence de texte, endings tolérés.
assert.match(agentProjet, /tu ne fais JAMAIS le\r?\ntravail spécialisé toi-même/, "interdiction de coder soi-même")

// G. Priorités refaites + Groq en chat.
assert.ok(table.models["groq/openai/gpt-oss-120b"], "GPT-OSS 120B (Groq) dans le catalogue")
assert.ok(table.models["groq/llama-3.3-70b-versatile"], "Llama 3.3 70B (Groq) dans le catalogue")
assert.ok(table.models["opencode/deepseek-v4-flash-free"].priority.code === 1, "DeepSeek V4 Flash en tête du domaine code")
assert.ok(table.models["opencode/nemotron-3-ultra-free"].priority.analyse === 1, "Nemotron 3 Ultra en tête du domaine analyse")
assert.match(providers, /Groq \(chat \+ dictée\)/, "Groq devient provider chat")
assert.ok(!providers.includes("openCodeEnv: false"), "plus de provider marqué non-chat : Groq est injecté au serveur OpenCode")
assert.match(priorities, /GROQ_FREE_IDS/, "liste fermée des ids groq gratuits")
assert.equal(priorities.includes('"groq/"'), true)

// H. Lisibilité Freebuff : le transcript vit dans un module pur testé.
const transcript = read("web/src/freebuff-transcript.ts")
assert.match(transcript, /export function buildTranscript/, "fonction centrale buildTranscript")
assert.match(transcript, /export function trimBorders/, "rognage des bordures de boîtes")
assert.match(transcript, /freebucks\?\|/, "motif quota « 40/40 Freebucks »")
assert.match(transcript, /greptile|refer\\s\+friends/, "filtre des pubs")
assert.match(transcript, /model\\s\+to\\s\+change/, "filtre des barres d'état TUI")
assert.match(page, /buildTranscript\(raw\)/, "la page Freebuff délègue au module")
assert.match(page, /isUserLine/, "les lignes utilisateur sont marquées")

// J. v9.6.2 : conflit de session avec l'app Desktop Freebuff — détection + bannière.
// v10.0.0 : le main Electron est retiré — la détection vit dans aven-app-host.ts.
const mainTs = read("host/aven-app-host.ts")
assert.match(mainTs, /isFreebuffDesktopRunning/, "détection de l'app Desktop Freebuff attendue")
assert.match(mainTs, /codebufffreebuff-desktop/, "filtrage par chemin complet (comme isFreebuffProcessRunning)")
assert.match(mainTs, /case "freebuffDesktopRunning"/, "canal IPC de détection attendu")
assert.match(mainTs, /Freebuff Desktop est ouverte/, "refus clair au lancement si l'app Desktop tient la session")
const page922 = read("web/src/FreebuffAgentPage.tsx")
assert.match(page922, /freebuffDesktopRunning/, "la page interroge la détection")
assert.match(page922, /freebuff-conflict/, "bannière de conflit rendue")
assert.match(page922, /déjà ouverte dans l'app Freebuff Desktop/, "message explicite attendu")
const css922 = read("web/src/App.css")
assert.match(css922, /\.freebuff-conflict/, "CSS de la bannière attendu")

// K. v9.7.1 : shared element réellement branché (l'audit v9.7.0 l'a trouvé mort).
assert.match(app, /openFreebuffAgent = \(source\?: "project"\) => withViewTransition/, "la page Freebuff accepte une source (morph carte→page)")
assert.match(app, /openAgentsPage = \(source\?: "tasks"\) => withViewTransition/, "la page Tâches accepte une source")
assert.match(app, /openFreebuffAgent\("project"\)/, "la carte Projet passe sa source")
assert.match(app, /openAgentsPage\("tasks"\)/, "la carte Tâches passe sa source")
assert.match(css, /\[data-vt-source="project"\] \.freebuff-agent-page \{ view-transition-name: hub-target; \}/, "CSS : carte et page partagent le même view-transition-name")
const vt921 = read("web/src/view-transitions.ts")
assert.match(vt921, /finished\.finally/, "la source est retirée après finished (pas de nom orphelin)")
assert.ok(!vt921.includes("transitionNameSelector"), "helper : fonction morte supprimée")
// Canal mort retiré (0 caller UI depuis v9.6.0).
const preload921 = read("web/src/types.ts")
const types921 = read("web/src/types.ts")
const operations921 = read("host/operations.ts")
assert.ok(!preload921.includes("renameAgent"), "preload : canal renameAgent supprimé")
assert.ok(!types921.includes("renameAgent"), "types : renameAgent supprimé")
assert.ok(!operations921.includes("async renameAgent"), "operations : renameAgent supprimé (les noms enregistrés restent lus)")

// I. Page « Tâches » : agent principal + 4 modes.
assert.match(app, /tasks-principal-card/, "carte de l'agent principal (orchestrateur)")
assert.match(app, /agent principal/, "l'orchestrateur est présenté comme agent principal")
assert.match(app, /tasks-mode-card/, "cartes de modes attendues")
assert.match(app, /MODES\.map\(/, "les modes sont dérivés de la constante MODES")
assert.ok((app.match(/fallbackName/g) ?? []).length >= 5, "4 modes + usage dans le rendu")
assert.match(app, /fallbackName: "Tâche complexe"/, "le mode tâche complexe (orchestrateur) est présent")
assert.match(css, /\.tasks-modes \{ display: grid/, "grille des modes")
assert.ok(!app.includes("renamingAgent"), "renommage d'agents retiré de la page")

console.log("v9.6.0 verification: OK")

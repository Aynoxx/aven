// Pont catalogue d'agents (v9.5.0) : Aven devient le CERVEAU unique des deux moteurs.
// Les agents OpenCode (.opencode/agents/*.md, format V2 à permissions) sont convertis
// en définitions TypeScript comprises par le CLI Freebuff (.agents/*.ts, type
// AgentDefinition — format vérifié dans la doc officielle Codebuff et le binaire CLI,
// qui charge « tout fichier du répertoire .agents/, même en sous-dossiers »).
//
// Le CLI est lancé avec --trust-agents : il propose donc LES MÊMES agents que
// l'interface Aven (aven-projet, aven-code, …), sur les mêmes modèles gratuits.
// Un mcp.json pointe vers le serveur MCP embarqué d'Aven (notes de l'espace) :
// Freebuff peut lire/chercher les notes Aven pendant sa session.
//
// Pur : aucune dépendance Electron — testable avec Node seul (comme workspace-sync).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { writeTextAtomic } from "./atomic-file.js"
import { isFreeModelRef } from "./priorities.js"

/** Marqueur en tête des fichiers GÉNÉRÉS par Aven : ceux-ci sont resynchronisés,
 * contrairement aux fichiers de l'utilisateur dans .agents/ (jamais touchés). */
export const GENERATED_BANNER = "// Généré par Aven (agents-bridge) — NE PAS MODIFIER : resynchronisé à chaque lancement."

/** Modèle gratuit par défaut des agents Freebuff (passes isFreeModelRef ; le CLI
 * Codebuff route via OpenRouter — « any model in OpenRouter » — donc un ref
 * openrouter/…:free du catalogue est le choix sûr). L'utilisateur peut surcharger
 * le champ model en éditant ses propres fichiers .agents. */
export const FREE_AGENT_MODEL = "openrouter/nvidia/nemotron-3-super-120b-a12b:free"

/** Ordre d'affichage des agents Aven (cohérent avec l'interface). */
export const AGENT_ORDER = ["projet", "code", "recherche", "analyse", "code-reviewer"] as const

/** ID d'agent Freebuff dérivé de l'ID OpenCode : préfixe « aven- » pour éviter toute
 * collision avec un agent publié (les ids locaux sont simples : lettres/chiffres/tirets). */
export function freeAgentId(opencodeId: string): string {
  const clean = String(opencodeId || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "")
  if (!clean) throw new Error("Identifiant d'agent vide")
  return `aven-${clean}`
}

/** Extrait le bloc frontmatter YAML « --- … --- » d'un fichier Markdown (analyseur
 * minimal sans dépendance YAML, suffisant pour nos gabarits : clés scalaires de
 * premier niveau, listes « - item » et LISTES D'OBJETS multi-lignes avec lignes de
 * continuation indentées — le format des permissions OpenCode). */
export function parseFrontmatter(markdown: string): { data: Record<string, unknown>; body: string } {
  const text = String(markdown ?? "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return { data: {}, body: text.trim() }
  const data: Record<string, unknown> = {}
  let currentKey: string | null = null
  const unquote = (v: string) => v.trim().replace(/^"([\s\S]*)"$/, "$1").replace(/^'([\s\S]*)'$/, "$1")
  for (const rawLine of m[1].split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const indented = /^[ \t]/.test(rawLine)
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*([\s\S]*)$/)
    if (line.startsWith("- ")) {
      // Item de liste sous currentKey : objet « key: value » ou scalaire.
      if (!currentKey || !Array.isArray(data[currentKey])) continue
      const rest = line.slice(2).trim()
      const itemKv = rest.match(/^([A-Za-z_][\w-]*)\s*:\s*([\s\S]*)$/)
      const arr = data[currentKey] as unknown[]
      arr.push(itemKv ? { [itemKv[1]]: unquote(itemKv[2]) } : unquote(rest))
      continue
    }
    if (!indented && kv) {
      // Clé de premier niveau : scalaire, ou liste si la valeur est vide.
      currentKey = kv[1]
      data[currentKey] = kv[2].trim() === "" ? [] : unquote(kv[2])
      continue
    }
    // Ligne indentée sans tiret : continuation de l'objet en cours dans la liste
    // (ex. « resource: "*" » sous « - action: read » des permissions).
    if (indented && kv && currentKey && Array.isArray(data[currentKey])) {
      const arr = data[currentKey] as Record<string, unknown>[]
      const last = arr[arr.length - 1]
      if (last && typeof last === "object") last[kv[1]] = unquote(kv[2])
    }
  }
  return { data, body: text.slice(m[0].length).trim() }
}

/** Corps du prompt sans frontmatter. */
export function stripFrontmatter(markdown: string): string {
  return parseFrontmatter(markdown).body
}

/** Traduction des permissions OpenCode en outillage Freebuff : les agents « lecture
 * seule » (tout est refusé sauf read/glob/grep) reçoivent les outils d'analyse sans
 * écriture ; les autres reçoivent le jeu complet d'édition. Les subagents cachés
 * (code-reviewer) ne sont PAS spawnables depuis Freebuff (ils le restent via l'agent
 * code d'Aven, qui garde la permission de délégation côté OpenCode). */
export function toToolNames(permissions: unknown, mode: string | undefined): string[] {
  const rows = Array.isArray(permissions) ? (permissions as { action?: unknown; resource?: unknown; effect?: unknown }[]) : []
  const deniedAll = rows.some((r) => r?.action === "*" && r?.effect === "deny")
  const readOnlyTool = (r: { action?: unknown }) => r?.action === "read" || r?.action === "glob" || r?.action === "grep"
  const allowedReadOnly = rows.some((r) => readOnlyTool(r) && r?.effect === "allow")
  if (mode === "subagent" || (deniedAll && allowedReadOnly)) {
    return ["read_files", "code_search", "find_files", "think_deeply", "set_output", "end_turn"]
  }
  return ["read_files", "write_file", "str_replace", "code_search", "find_files", "run_terminal_command", "web_search", "end_turn"]
}

export type AgentSource = { id: string; markdown: string }

/** Définition TypeScript d'un agent Freebuff, miroir fidèle de l'agent OpenCode :
 * mêmes nom affiché, même prompt, même rôle (orchestrateur / spécialiste / relecteur). */
export function toAgentFileContent(source: AgentSource): string {
  const { data, body } = parseFrontmatter(source.markdown)
  const id = freeAgentId(source.id)
  const displayName = String(data.description ?? source.id)
  const mode = typeof data.mode === "string" ? data.mode : undefined
  const tools = toToolNames(data.permissions, mode)
  const isReviewer = source.id === "code-reviewer"
  // Instructions : le corps OpenCode + le cadre Aven (français, espace de travail).
  const instructions = [
    `Tu es « ${displayName} », l'agent « ${source.id} » de l'application Aven.`,
    "Réponds en français, de façon concise, et travaille dans le dossier courant (l'espace de travail Aven).",
    isReviewer
      ? "Relis le code demandé sans jamais le modifier : cherche bugs, incohérences, régressions et problèmes de conception, puis rends un rapport structuré."
      : body,
  ].filter(Boolean).join("\n\n")
  const spawner = isReviewer
    ? "Relire du code sans le modifier : rapport de bugs, régressions et problèmes de conception."
    : String(data.description ?? `Agent ${source.id} d'Aven.`)
  const lines = [
    GENERATED_BANNER,
    `// Miroir de .opencode/agents/${source.id}.md — source de vérité : Aven.`,
    "const definition = {",
    `  id: ${JSON.stringify(id)},`,
    `  displayName: ${JSON.stringify(displayName)},`,
    `  model: ${JSON.stringify(FREE_AGENT_MODEL)}, // gratuit ; remplace-le par tout modèle OpenRouter si tu le souhaites`,
    `  toolNames: ${JSON.stringify(tools)},`,
    `  spawnableAgents: [],`,
    `  inputSchema: { prompt: { type: "string", description: "La demande pour cet agent" } },`,
    `  includeMessageHistory: ${mode === "subagent" ? "false" : "true"},`,
    `  outputMode: "last_message",`,
    `  spawnerPrompt: ${JSON.stringify(spawner)},`,
    "  systemPrompt: `Tu fais partie d'Aven, une application de bureau qui orchestre des agents gratuits sur un espace de travail Windows.`,",
    `  instructionsPrompt: ${JSON.stringify(instructions)},`,
    "}",
    "export default definition",
    "",
  ]
  return lines.join("\n")
}

/** Définitions des types attendus par le CLI (version minimale fidèle : le champ
 * model accepte tout modèle OpenRouter, les outils nos gratuits inclus). */
export const AGENT_TYPES_FILE = [
  GENERATED_BANNER,
  "// Types minimaux pour les agents Freebuff d'Aven (le modèle est une chaîne :",
  "// tout modèle OpenRouter est accepté, y compris les gratuits « :free » et « opencode/*-free »).",
  "export type ToolName =",
  "  | 'add_message' | 'code_search' | 'end_turn' | 'find_files' | 'lookup_agent_info'",
  "  | 'read_docs' | 'read_files' | 'run_file_change_hooks' | 'run_terminal_command'",
  "  | 'set_messages' | 'set_output' | 'spawn_agents' | 'str_replace' | 'think_deeply'",
  "  | 'web_search' | 'write_file' | (string & {})",
  "export type ModelName = (string & {})",
  "export interface AgentDefinition {",
  "  id: string",
  "  version?: string",
  "  publisher?: string",
  "  displayName: string",
  "  model: ModelName",
  "  toolNames?: ToolName[]",
  "  spawnableAgents?: string[]",
  "  inputSchema?: { prompt?: { type: 'string'; description?: string }; params?: Record<string, unknown> }",
  "  includeMessageHistory?: boolean",
  "  outputMode?: 'last_message' | 'all_messages' | 'structured_output'",
  "  outputSchema?: Record<string, unknown>",
  "  spawnerPrompt?: string",
  "  systemPrompt?: string",
  "  instructionsPrompt?: string",
  "  stepPrompt?: string",
  "  handleSteps?: (context: { agentState: unknown; prompt?: string; params?: Record<string, unknown>; logger: unknown }) => Generator<unknown, void, unknown>",
  "}",
  "export default AgentDefinition",
  "",
].join("\n")

/** README du dossier .agents (documente le pont pour l'utilisateur). */
export const AGENTS_README = [
  "# Agents Freebuff de cet espace",
  "",
  "Ce dossier est le pont entre Aven et le CLI Freebuff : les agents d'Aven",
  "(définitions `.opencode/agents/*.md`) sont recopiés ici au format TypeScript",
  "que le CLI comprend. Aven lance Freebuff avec `--trust-agents` : le TUI propose",
  "donc les MÊMES agents que l'interface (aven-projet, aven-code, aven-recherche,",
  "aven-analyse, aven-code-reviewer), sur des modèles gratuits.",
  "",
  "- Les fichiers marqués « Généré par Aven » sont resynchronisés à chaque lancement :",
  "  modifie la source dans l'app (ou `.opencode/agents/*.md`), pas ici.",
  "- Tes PROPRES fichiers `.agents/*.ts` ne sont jamais touchés : tu peux ajouter",
  "  des agents Freebuff spécifiques à cet espace.",
  "- Le champ `model` accepte tout modèle OpenRouter (gratuits inclus).",
  "- `mcp.json` expose les notes Aven à Freebuff (serveur MCP embarqué).",
  "",
].join("\n")

/** Config MCP générée pour l'espace : le serveur embarqué d'Aven expose les notes
 * (dossier passé en argument --notes-dir — le serveur vit dans l'installation d'Aven,
 * pas dans l'espace). */
export function toMcpConfig(serverPath: string, notesDir: string): string {
  return JSON.stringify({
    mcpServers: {
      aven: {
        command: "node",
        args: [serverPath.replace(/\\/g, "/"), "--notes-dir", notesDir.replace(/\\/g, "/")],
      },
    },
  }, null, 2) + "\n"
}

/** Synchronise le dossier .agents de l'espace : fichiers GÉNÉRÉS (marqueur) écrits ou
 * mis à jour, fichiers de l'utilisateur JAMAIS touchés. Retourne les chemins relatifs
 * écrits, pour les sondes et les avis. `serverPath` pointe vers aven-mcp-server.mjs
 * (racine du projet en dev, resources/ packagé). */
export function buildAgentsDir(workspace: string, agentSources: AgentSource[], serverPath: string): string[] {
  const dir = path.join(workspace, ".agents")
  const typesDir = path.join(dir, "types")
  mkdirSync(typesDir, { recursive: true })
  const notesDir = path.join(workspace, ".opencodeapp", "notes")
  const written: string[] = []
  const put = (rel: string, content: string) => {
    const file = path.join(dir, rel)
    if (existsSync(file) && readFileSync(file, "utf8") === content) return
    writeTextAtomic(file, content)
    written.push(".agents/" + rel.replace(/\\/g, "/"))
  }
  put("types/agent-definition.ts", AGENT_TYPES_FILE)
  put("README.md", AGENTS_README)
  put("mcp.json", toMcpConfig(serverPath, notesDir))
  put("tools.ts", [GENERATED_BANNER, "// Réexport minimal : les agents Aven n'utilisent que ToolName.", "export type ToolName = import('./types/agent-definition').ToolName", ""].join("\n"))
  const ordered = [...agentSources].sort((a, b) => {
    const ia = AGENT_ORDER.indexOf(a.id as (typeof AGENT_ORDER)[number])
    const ib = AGENT_ORDER.indexOf(b.id as (typeof AGENT_ORDER)[number])
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.id.localeCompare(b.id)
  })
  for (const source of ordered) put(`${freeAgentId(source.id)}.ts`, toAgentFileContent(source))
  return written
}

/** Lit les agents OpenCode du gabarit (sources du pont). */
export function readTemplateAgents(templateDir: string): AgentSource[] {
  const dir = path.join(templateDir, ".opencode", "agents")
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => ({
    id: f.replace(/\.md$/i, ""),
    markdown: readFileSync(path.join(dir, f), "utf8"),
  }))
}

/** Le modèle par défaut est bien gratuit (garde de cohérence du catalogue). */
export function assertFreeCatalog(): void {
  if (!isFreeModelRef(FREE_AGENT_MODEL)) throw new Error(`Le modèle d'agents Freebuff n'est pas gratuit : ${FREE_AGENT_MODEL}`)
}

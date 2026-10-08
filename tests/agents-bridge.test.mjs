import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  GENERATED_BANNER,
  FREE_AGENT_MODEL,
  freeAgentId,
  parseFrontmatter,
  stripFrontmatter,
  toToolNames,
  toAgentFileContent,
  buildAgentsDir,
  readTemplateAgents,
  toMcpConfig,
} from "../host/agents-bridge.ts"

test("freeAgentId : préfixe aven-, ids sûrs (minuscules, tirets)", () => {
  assert.equal(freeAgentId("code"), "aven-code")
  assert.equal(freeAgentId("Code Reviewer"), "aven-code-reviewer")
  assert.equal(freeAgentId("  Éclair! "), "aven-eclair")
  assert.throws(() => freeAgentId(""))
})

test("parseFrontmatter : clés, listes et corps sans frontmatter", () => {
  const { data, body } = parseFrontmatter("---\ndescription: Agent de code\nmode: primary\npermissions:\n  - action: \"*\"\n    resource: \"*\"\n    effect: ask\n---\n\nTu es l'agent de code.")
  assert.equal(data.description, "Agent de code")
  assert.equal(data.mode, "primary")
  assert.equal(data.permissions.length, 1)
  assert.deepEqual(data.permissions[0], { action: "*", resource: "*", effect: "ask" })
  assert.ok(body.includes("Tu es l'agent de code"))
  // Sans frontmatter : corps entier.
  const bare = parseFrontmatter("juste du texte")
  assert.deepEqual(bare.data, {})
  assert.equal(bare.body, "juste du texte")
})

test("stripFrontmatter retire le YAML et garde le prompt", () => {
  const md = "---\ndescription: X\n---\nCorps utile"
  assert.equal(stripFrontmatter(md), "Corps utile")
})

test("toToolNames : lecture seule pour le relecteur, édition pour les autres", () => {
  const denyAll = [{ action: "*", effect: "deny" }, { action: "read", effect: "allow" }]
  const readOnly = toToolNames(denyAll, "subagent")
  assert.ok(!readOnly.includes("write_file"))
  assert.ok(!readOnly.includes("run_terminal_command"))
  assert.ok(readOnly.includes("read_files"))
  assert.ok(readOnly.includes("end_turn"))
  const full = toToolNames([{ action: "*", effect: "ask" }], "primary")
  assert.ok(full.includes("write_file") && full.includes("run_terminal_command"))
})

test("toAgentFileContent : miroir fidèle, modèle gratuit, marqueur généré", () => {
  const md = "---\ndescription: Agent principal pour le code\nmode: primary\n---\n\nTu écris du code propre."
  const content = toAgentFileContent({ id: "code", markdown: md })
  assert.ok(content.startsWith(GENERATED_BANNER))
  assert.ok(content.includes('id: "aven-code"'))
  assert.ok(content.includes('displayName: "Agent principal pour le code"'))
  assert.ok(content.includes(`model: ${JSON.stringify(FREE_AGENT_MODEL)}`))
  assert.ok(content.includes("includeMessageHistory: true"))
  assert.ok(content.includes("Tu écris du code propre"))
  assert.ok(content.includes("export default definition"))
  // Le relecteur a son cadre spécifique.
  const reviewer = toAgentFileContent({ id: "code-reviewer", markdown: "---\ndescription: Relecteur\nmode: subagent\n---\nCorps" })
  assert.ok(reviewer.includes("includeMessageHistory: false"))
  assert.ok(reviewer.includes("sans jamais le modifier"))
})

test("buildAgentsDir : fichiers générés synchronisés, fichiers utilisateur intacts", () => {
  const ws = mkdtempSync(path.join(tmpdir(), "aven-agents-"))
  try {
    const sources = [
      { id: "code", markdown: "---\ndescription: Code\nmode: primary\n---\nCorps" },
      { id: "projet", markdown: "---\ndescription: Orchestrateur\nmode: primary\n---\nCorps" },
    ]
    const serverPath = "C:/app/resources/aven-mcp-server.mjs"
    const first = buildAgentsDir(ws, sources, serverPath)
    assert.ok(first.includes(".agents/aven-code.ts"))
    assert.ok(first.includes(".agents/aven-projet.ts"))
    assert.ok(first.includes(".agents/types/agent-definition.ts"))
    assert.ok(first.includes(".agents/mcp.json"))
    const mcp = JSON.parse(readFileSync(path.join(ws, ".agents", "mcp.json"), "utf8"))
    assert.equal(mcp.mcpServers.aven.command, "node")
    assert.ok(mcp.mcpServers.aven.args[0].endsWith("aven-mcp-server.mjs"))

    // Second passage sans changement : rien n'est réécrit.
    assert.deepEqual(buildAgentsDir(ws, sources, serverPath), [])

    // Un fichier utilisateur existant (sans marqueur) n'est jamais touché.
    const custom = path.join(ws, ".agents", "mon-agent.ts")
    writeFileSync(custom, "export default {}", "utf8")
    buildAgentsDir(ws, sources, serverPath)
    assert.equal(readFileSync(custom, "utf8"), "export default {}")
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test("readTemplateAgents lit le gabarit .opencode/agents", () => {
  const tpl = mkdtempSync(path.join(tmpdir(), "aven-tpl-"))
  try {
    mkdirSync(path.join(tpl, ".opencode", "agents"), { recursive: true })
    writeFileSync(path.join(tpl, ".opencode", "agents", "code.md"), "---\ndescription: C\n---\nB", "utf8")
    const sources = readTemplateAgents(tpl)
    assert.deepEqual(sources.map((s) => s.id), ["code"])
    assert.ok(sources[0].markdown.includes("description: C"))
  } finally {
    rmSync(tpl, { recursive: true, force: true })
  }
})

test("toMcpConfig : chemins normalisés (slashs), JSON valide, dossier notes en argument", () => {
  const parsed = JSON.parse(toMcpConfig("C:\\chemin\\avec\\backslash.mjs", "C:\\espace\\.opencodeapp\\notes"))
  assert.equal(parsed.mcpServers.aven.command, "node")
  assert.equal(parsed.mcpServers.aven.args[0], "C:/chemin/avec/backslash.mjs")
  assert.equal(parsed.mcpServers.aven.args[1], "--notes-dir")
  assert.equal(parsed.mcpServers.aven.args[2], "C:/espace/.opencodeapp/notes")
})

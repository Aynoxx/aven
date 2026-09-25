import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { seedWorkspace, trackedAgentFiles } from "../electron/settings.ts"

const temp = mkdtempSync(path.join(tmpdir(), "aven-agent-sync-"))
process.on("exit", () => { try { rmSync(temp, { recursive: true, force: true }) } catch { /* Windows peut retarder */ } })

const md = (dir, rel, content) => {
  const p = path.join(dir, rel)
  mkdirSync(path.dirname(p), { recursive: true })
  writeFileSync(p, content)
  return p
}

// Gabarit de l'app : deux agents livrés (situation d'une mise à jour qui ajoute « projet »).
const template = path.join(temp, "template")
md(template, path.join(".opencode", "agents", "code.md"), "# code (v2)")
md(template, path.join(".opencode", "agents", "projet.md"), "# projet : orchestrateur")

// Espace existant créé par une version ANTÉRIEURE : « code.md » connu (avec baseline),
// pas de « projet.md » — exactement l'état qui bloquait le démarrage en v9.0.0.
const workspace = path.join(temp, "workspace")
md(workspace, path.join(".opencode", "agents", "code.md"), "# code (v2)")
md(workspace, path.join(".opencode-app", "baseline", ".opencode__agents__code.md"), "# code (v2)")

test("trackedAgentFiles : découvre tous les .md du gabarit ; dossier d'agents absent → liste vide", () => {
  assert.deepEqual([...trackedAgentFiles(template)].sort(), [
    path.join(".opencode", "agents", "code.md"),
    path.join(".opencode", "agents", "projet.md"),
  ])
  assert.deepEqual(trackedAgentFiles(path.join(temp, "inexistant")), [])
})

test("seedWorkspace : le NOUVEL agent du gabarit est copié dans un espace existant", () => {
  const sync = seedWorkspace(workspace, template)
  const created = sync.sync.find((s) => s.file === path.join(".opencode", "agents", "projet.md"))
  assert.equal(created?.status, "created")
  const dest = path.join(workspace, ".opencode", "agents", "projet.md")
  assert.equal(readFileSync(dest, "utf8"), "# projet : orchestrateur")
  // La baseline est posée : le prochain démarrage saura distinguer une personnalisation.
  assert.equal(
    readFileSync(path.join(workspace, ".opencode-app", "baseline", ".opencode__agents__projet.md"), "utf8"),
    "# projet : orchestrateur",
  )
})

test("seedWorkspace : un agent personnalisé par l'utilisateur n'est JAMAIS écrasé", () => {
  const custom = path.join(workspace, ".opencode", "agents", "code.md")
  writeFileSync(custom, "# code (perso Liam)")
  const sync = seedWorkspace(workspace, template)
  assert.equal(sync.sync.find((s) => s.file === path.join(".opencode", "agents", "code.md"))?.status, "custom")
  assert.equal(readFileSync(custom, "utf8"), "# code (perso Liam)")
})

test("seedWorkspace : idempotent — un second passage ne change rien", () => {
  const first = seedWorkspace(workspace, template)
  const second = seedWorkspace(workspace, template)
  assert.deepEqual(
    second.sync.map((s) => s.status).sort(),
    first.sync.map((s) => s.status).sort(),
  )
  assert.ok(second.sync.every((s) => s.status === "unchanged" || s.status === "custom"))
})

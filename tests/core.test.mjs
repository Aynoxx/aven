import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, readdirSync as _readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
const fsModule = { readdirSync: _readdirSync }
import { tmpdir } from "node:os"
import path from "node:path"
import { parseRef, refOf } from "../electron/model-ref.ts"
import {
  TASKS,
  addDiscoveredFreeModels,
  buildChains,
  isFreeModelRef,
  loadTable,
} from "../electron/priorities.ts"
import { mergeNewModels, prunePaidModels, syncTrackedFiles } from "../electron/workspace-sync.ts"
import { writeTextAtomic, writeJsonAtomic, writeJsonAtomicPretty } from "../electron/atomic-file.ts"
import { isArchived, listArchived, setArchived } from "../electron/archive.ts"
import { loadNames, setName } from "../electron/agent-names.ts"
import { emptyLive, applyEvent } from "../web/src/stream.ts"

// ── model-ref ────────────────────────────────────────────────────────────────
assert.deepEqual(parseRef("opencode/deepseek-v4-flash-free"), { providerID: "opencode", id: "deepseek-v4-flash-free" })
assert.deepEqual(parseRef("groq/openai/gpt-oss-120b"), { providerID: "groq", id: "openai/gpt-oss-120b" }) // premier « / » seulement
assert.equal(refOf(undefined), undefined)
assert.equal(refOf({ providerID: "a", id: "b/c" }), "a/b/c")

// ── priorities : catalogue strictement gratuit ───────────────────────────────
assert.equal(isFreeModelRef("opencode/deepseek-v4-flash-free"), true)
assert.equal(isFreeModelRef("opencode/big-pickle"), true) // connu sans suffixe
assert.equal(isFreeModelRef("opencode/marque-nouveau-modele-free"), true) // découverte dynamique par suffixe
assert.equal(isFreeModelRef("openrouter/x/y:free"), true)
assert.equal(isFreeModelRef("openrouter/openrouter/free"), false) // l'ancien faux secours est retiré
assert.equal(isFreeModelRef("opencode/gpt-6"), false)
assert.equal(isFreeModelRef("openai/gpt-6"), false)
assert.equal(isFreeModelRef("google/gemini-3.8-flash"), false)
assert.equal(isFreeModelRef("opencode/foo"), false) // pas de suffixe, pas dans la liste

test("loadTable rejette un JSON invalide et retombe sur le fichier suivant", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aven-test-"))
  try {
    const bad = path.join(dir, "bad.json")
    const good = path.join(dir, "good.json")
    writeFileSync(bad, "{ pas du json", "utf8")
    writeJsonAtomicPretty(good, { models: { "opencode/big-pickle": { label: "Big Pickle", priority: { code: 1 } } } })
    const { table, source } = loadTable(bad, good)
    assert.equal(source, good)
    assert.ok(table["opencode/big-pickle"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("loadTable filtre les modèles payants d'une table personnalisée", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aven-test-"))
  try {
    const f = path.join(dir, "t.json")
    writeJsonAtomicPretty(f, {
      models: {
        "opencode/big-pickle": { label: "Big Pickle", priority: { code: 1 } },
        "openai/gpt-6": { label: "Payant", priority: { code: 0 } },
      },
    })
    const { table } = loadTable(f)
    assert.ok(table["opencode/big-pickle"])
    assert.equal(table["openai/gpt-6"], undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("addDiscoveredFreeModels n'ajoute que des modèles gratuits réellement disponibles", () => {
  const table = { "opencode/big-pickle": { label: "Big Pickle", priority: { code: 7 } } }
  const { table: next, added } = addDiscoveredFreeModels(table, [
    { ref: "opencode/nouveau-free", label: "Nouveau" },
    { ref: "openai/gpt-6", label: "Payant" },
    { ref: "opencode/big-pickle", label: "déjà là" },
  ])
  assert.deepEqual(added, ["opencode/nouveau-free"])
  assert.ok(next["opencode/nouveau-free"].priority.code >= 60)
  assert.equal(next["openai/gpt-6"], undefined)
})

test("buildChains trie par priorité et filtre par disponibilité", () => {
  const table = {
    "opencode/a-free": { label: "A", priority: { code: 2 } },
    "opencode/b-free": { label: "B", priority: { code: 1 } },
    "opencode/c-free": { label: "C", priority: { code: 3 } },
    "opencode/absent-free": { label: "Absent", priority: { code: 0 } },
  }
  const chains = buildChains(table, new Set(["opencode/a-free", "opencode/b-free", "opencode/c-free"]))
  assert.deepEqual(chains.code.map((m) => m.ref), ["opencode/b-free", "opencode/a-free", "opencode/c-free"])
  const empty = buildChains(table, new Set())
  assert.deepEqual(empty.code, [])
})

test("chaque tâche de TASKS a une chaîne définie même vide", () => {
  const chains = buildChains({}, new Set())
  for (const task of TASKS) assert.deepEqual(chains[task], [])
})

// ── workspace-sync ───────────────────────────────────────────────────────────
test("syncTrackedFiles : création, mise à jour des fichiers intacts, respect des fichiers personnalisés", () => {
  const ws = mkdtempSync(path.join(tmpdir(), "aven-ws-"))
  const tpl = mkdtempSync(path.join(tmpdir(), "aven-tpl-"))
  try {
    writeFileSync(path.join(tpl, "cfg.jsonc"), "v1", "utf8")
    const [created] = syncTrackedFiles(ws, tpl, ["cfg.jsonc"])
    assert.equal(created.status, "created")

    writeFileSync(path.join(tpl, "cfg.jsonc"), "v2", "utf8")
    const [updated] = syncTrackedFiles(ws, tpl, ["cfg.jsonc"])
    assert.equal(updated.status, "updated")
    assert.equal(readFileSync(path.join(ws, "cfg.jsonc"), "utf8"), "v2")

    writeFileSync(path.join(ws, "cfg.jsonc"), "modifié par l'utilisateur", "utf8")
    writeFileSync(path.join(tpl, "cfg.jsonc"), "v3", "utf8")
    const [custom] = syncTrackedFiles(ws, tpl, ["cfg.jsonc"])
    assert.equal(custom.status, "custom")
    assert.equal(readFileSync(path.join(ws, "cfg.jsonc"), "utf8"), "modifié par l'utilisateur")
  } finally {
    rmSync(ws, { recursive: true, force: true })
    rmSync(tpl, { recursive: true, force: true })
  }
})

test("mergeNewModels ajoute les nouveaux modèles sans toucher aux priorités existantes", () => {
  const ws = mkdtempSync(path.join(tmpdir(), "aven-ws-"))
  const tpl = mkdtempSync(path.join(tmpdir(), "aven-tpl-"))
  try {
    writeJsonAtomicPretty(path.join(ws, "model-priorities.json"), {
      models: { "opencode/big-pickle": { label: "Big Pickle", priority: { code: 7 } } },
    })
    writeJsonAtomicPretty(path.join(tpl, "model-priorities.json"), {
      models: {
        "opencode/big-pickle": { label: "Big Pickle (nouveau libellé livré)", priority: { code: 99 } },
        "opencode/north-mini-code-free": { label: "North Mini", priority: { code: 2 } },
      },
    })
    const added = mergeNewModels(ws, tpl)
    assert.deepEqual(added, ["opencode/north-mini-code-free"])
    const merged = JSON.parse(readFileSync(path.join(ws, "model-priorities.json"), "utf8"))
    assert.equal(merged.models["opencode/big-pickle"].priority.code, 7) // priorité utilisateur intacte
    assert.ok(merged.models["opencode/north-mini-code-free"])
  } finally {
    rmSync(ws, { recursive: true, force: true })
    rmSync(tpl, { recursive: true, force: true })
  }
})

test("prunePaidModels retire physiquement les modèles payants", () => {
  const ws = mkdtempSync(path.join(tmpdir(), "aven-ws-"))
  try {
    writeJsonAtomicPretty(path.join(ws, "model-priorities.json"), {
      models: {
        "opencode/big-pickle": { label: "ok", priority: { code: 1 } },
        "openai/gpt-6": { label: "payant", priority: { code: 2 } },
      },
    })
    const removed = prunePaidModels(ws)
    assert.deepEqual(removed, ["openai/gpt-6"])
    const after = JSON.parse(readFileSync(path.join(ws, "model-priorities.json"), "utf8"))
    assert.equal(after.models["openai/gpt-6"], undefined)
    assert.ok(after.models["opencode/big-pickle"])
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

// ── atomic-file ──────────────────────────────────────────────────────────────
test("écritures atomiques : pas de fichier temporaire résiduel", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aven-atomic-"))
  try {
    const f = path.join(dir, "dossier", "fichier.txt")
    writeTextAtomic(f, "contenu")
    assert.equal(readFileSync(f, "utf8"), "contenu")
    writeJsonAtomic(f, { a: 1 })
    assert.deepEqual(JSON.parse(readFileSync(f, "utf8")), { a: 1 })
    writeJsonAtomicPretty(f, { a: 2 })
    assert.deepEqual(JSON.parse(readFileSync(f, "utf8")), { a: 2 })
    const { readdirSync } = fsModule
    assert.deepEqual(readdirSync(path.join(dir, "dossier")).filter((n) => n.includes(".tmp-")), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── archive & agent-names (fichiers dans l'espace de travail) ───────────────
test("archive : set / is / list / unset", () => {
  const ws = mkdtempSync(path.join(tmpdir(), "aven-archive-"))
  try {
    assert.equal(isArchived(ws, "s1"), false)
    setArchived(ws, "s1", true)
    assert.equal(isArchived(ws, "s1"), true)
    assert.deepEqual([...listArchived(ws)], ["s1"])
    setArchived(ws, "s1", false)
    assert.equal(isArchived(ws, "s1"), false)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test("agent-names : nom vide = retour au nom d'origine", () => {
  const ws = mkdtempSync(path.join(tmpdir(), "aven-names-"))
  try {
    setName(ws, "code", "Mon Codeur")
    assert.equal(loadNames(ws).code, "Mon Codeur")
    setName(ws, "code", "")
    assert.equal(loadNames(ws).code, undefined)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

// ── stream.ts : réducteur pur des événements temps réel ─────────────────────
test("applyEvent : deltas regroupés, outils suivis, fin de tour détectée", () => {
  let live = emptyLive
  const step = (ev) => {
    const r = applyEvent(live, ev)
    live = r.live
    return r.finished
  }

  assert.equal(step({ type: "session.execution.started", child: false, data: {} }), false)
  assert.equal(live.busy, true)

  step({ type: "session.text.delta", child: false, data: { assistantMessageID: "m1", delta: "Bonjour " } })
  step({ type: "session.text.delta", child: false, data: { assistantMessageID: "m1", delta: "monde" } })
  assert.equal(live.order.length, 1)
  assert.equal(live.texts.m1.text, "Bonjour monde")

  step({ type: "session.tool.input.started", child: false, data: { id: "t1", name: "read" } })
  assert.equal(live.tools.t1.status, "running")
  step({ type: "session.tool.success", child: false, data: { id: "t1" } })
  assert.equal(live.tools.t1.status, "completed")

  assert.equal(step({ type: "session.execution.succeeded", child: false, data: {} }), true)
  assert.equal(live.busy, false)
})

test("applyEvent : les messages de sous-agents sont marqués child sans polluer l'ordre principal", () => {
  let live = emptyLive
  live = applyEvent(live, { type: "session.text.delta", child: true, data: { assistantMessageID: "c1", delta: "revue" } }).live
  assert.equal(live.texts.c1.child, true)
  assert.equal(live.order.length, 1)
})

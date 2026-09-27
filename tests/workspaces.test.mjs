import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

// v9.1.5 : plus aucun espace « Par défaut » imposé. Ces tests verrouillent le nouveau
// contrat : un registre absent/vide est un état NORMAL (l'utilisateur doit choisir son
// espace), et le retrait du dernier espace ramène à cet état de choix.

// workspaces.ts importe "electron" (stub) et lit/écrit workspaces.json dans
// app.getPath("userData") : chaque test isole son registre dans un dossier temporaire.
const { app } = await import(new URL("./electron-stub.mjs", import.meta.url).href)
const { listWorkspaces, activeWorkspace, registerWorkspace, setActiveWorkspace, removeWorkspace, validateWorkspacePath } = await import("../electron/workspaces.ts")

/** Redirige le registre vers un dossier temporaire frais et y sème éventuellement un état initial. Renvoie { cleanup, base }. */
function useTempRegistry(initial) {
  const base = mkdtempSync(path.join(tmpdir(), "aven-ws-test-"))
  app.getPath = () => base
  if (initial) writeFileSync(path.join(base, "workspaces.json"), JSON.stringify(initial), "utf8")
  return { cleanup: () => rmSync(base, { recursive: true, force: true }), base }
}

test("registre absent : liste vide, aucun espace actif (plus de « Par défaut »)", () => {
  const { cleanup } = useTempRegistry(undefined)
  try {
    assert.deepEqual(listWorkspaces(), [])
    assert.equal(activeWorkspace(), null)
  } finally { cleanup() }
})

test("registre sans espace : registerWorkspace crée le PREMIER espace, sans rien imposer", () => {
  const { cleanup, base } = useTempRegistry(undefined)
  try {
    const entry = registerWorkspace(base, "Mon espace")
    assert.equal(entry.name, "Mon espace")
    assert.deepEqual(listWorkspaces(), [entry])
    // Fallback historique : sans choix explicite, le premier connu devient l'espace
    // renvoyé (le boot démarre dessus). Le null n'arrive qu'à la liste vide.
    assert.deepEqual(activeWorkspace(), entry)
  } finally { cleanup() }
})

test("activeWorkspace : espace activé puis bascule — la sélection suit l'enregistrement", () => {
  const { cleanup, base } = useTempRegistry(undefined)
  try {
    const dirA = path.join(base, "a")
    const dirB = path.join(base, "b")
    mkdirSync(dirA); mkdirSync(dirB) // setActiveWorkspace exige des dossiers existants
    registerWorkspace(dirA, "A")
    registerWorkspace(dirB, "B")
    assert.equal(activeWorkspace().path, dirA) // fallback : premier connu tant qu'aucun choix
    setActiveWorkspace(dirB)
    assert.equal(activeWorkspace().path, dirB)
    setActiveWorkspace(dirA)
    assert.equal(activeWorkspace().path, dirA)
  } finally { cleanup() }
})

test("removeWorkspace du dernier espace : retour à l'état « à choisir » (liste vide)", () => {
  const { cleanup, base } = useTempRegistry(undefined)
  try {
    const entry = registerWorkspace(base, "Seul")
    setActiveWorkspace(base)
    assert.equal(activeWorkspace().path, entry.path)
    removeWorkspace(base)
    assert.deepEqual(listWorkspaces(), [])
    assert.equal(activeWorkspace(), null)
  } finally { cleanup() }
})

test("removeWorkspace de l'espace actif parmi plusieurs : plus d'active fantôme", () => {
  const { cleanup, base } = useTempRegistry(undefined)
  try {
    const dirA = path.join(base, "a")
    const dirB = path.join(base, "b")
    mkdirSync(dirA); mkdirSync(dirB)
    registerWorkspace(dirA, "A")
    registerWorkspace(dirB, "B")
    setActiveWorkspace(dirA)
    removeWorkspace(dirA)
    assert.deepEqual(listWorkspaces().map((w) => w.path), [dirB])
    // L'« active » pointant l'espace retiré est effacé : activeWorkspace retombe sur le
    // premier restant (jamais un espace fantôme). Avec la liste vide, il renvoie null.
    assert.equal(activeWorkspace().path, dirB)
  } finally { cleanup() }
})

test("activeWorkspace : liste non vide sans actif → premier connu (jamais un espace retiré)", () => {
  const { cleanup } = useTempRegistry({ list: [{ path: "C:\\x", name: "X" }] })
  try {
    assert.equal(activeWorkspace().path, "C:\\x")
  } finally { cleanup() }
})

test("validateWorkspacePath continue de refuser un dossier hors liste", () => {
  const { cleanup, base } = useTempRegistry(undefined)
  try {
    registerWorkspace(base, "Connu")
    setActiveWorkspace(base)
    assert.throws(() => validateWorkspacePath("C:\\inconnu-aven"), /non autorisé/)
  } finally { cleanup() }
})

import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

// v9.1.6 : plus AUCUN projet par défaut — même implicite. Un registre sans « active »
// explicite est un état « à choisir » : activeWorkspace renvoie null même si la liste
// n'est pas vide, et l'écran de choix liste les projets connus. Ces tests verrouillent
// ce contrat (l'ancien repli « premier connu » a été retiré).

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

test("registre rempli sans choix : liste présente mais activeWorkspace null (à choisir)", () => {
  const { cleanup } = useTempRegistry({ list: [{ path: "C:\\x", name: "X" }] })
  try {
    assert.deepEqual(listWorkspaces().map((w) => w.name), ["X"])
    // v9.1.6 : l'ancien repli « premier connu » démarrait un espace sans choix — retiré.
    assert.equal(activeWorkspace(), null)
  } finally { cleanup() }
})

test("registre sans espace : registerWorkspace crée le PREMIER espace, sans l'activer", () => {
  const { cleanup, base } = useTempRegistry(undefined)
  try {
    const entry = registerWorkspace(base, "Mon espace")
    assert.equal(entry.name, "Mon espace")
    assert.deepEqual(listWorkspaces(), [entry])
    // v9.1.6 : l'enregistrement n'active rien — seul un choix explicite (setActiveWorkspace
    // via l'écran de choix ou le sélecteur) démarre un espace.
    assert.equal(activeWorkspace(), null)
  } finally { cleanup() }
})

test("activeWorkspace : null tant qu'aucun choix, puis l'espace activé suit l'enregistrement", () => {
  const { cleanup, base } = useTempRegistry(undefined)
  try {
    const dirA = path.join(base, "a")
    const dirB = path.join(base, "b")
    mkdirSync(dirA); mkdirSync(dirB) // setActiveWorkspace exige des dossiers existants
    registerWorkspace(dirA, "A")
    registerWorkspace(dirB, "B")
    assert.equal(activeWorkspace(), null) // rien n'est choisi : l'écran de choix s'affiche
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

test("removeWorkspace de l'espace actif parmi plusieurs : plus d'active fantôme, choix redemandé", () => {
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
    // v9.1.6 : l'actif retiré laisse la sélection vide — l'écran de choix repropose B,
    // mais rien ne démarre tout seul (plus de bascule « premier restant »).
    assert.equal(activeWorkspace(), null)
  } finally { cleanup() }
})

test("registre avec active pointant un espace retiré : état « à choisir » (jamais un fantôme)", () => {
  const { cleanup } = useTempRegistry({ list: [{ path: "C:\\x", name: "X" }], active: "C:\\y" })
  try {
    assert.equal(activeWorkspace(), null)
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

import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import {
  MAX_RECENT_FILES,
  cleanRelativePath,
  loadRecentFiles,
  parseRecentFiles,
  rememberFile,
  rememberWorkspaceFile,
} from "../host/recent-files.ts"

// v12.3.0 : l'accueil affiche le dernier document RÉELLEMENT ouvert. Ces tests
// fixent les refus : pas de chemin absolu, pas de traversée, pas de doublon, pas
// d'historique hors de l'espace.

const at = (n) => 1_700_000_000_000 + n

test("cleanRelativePath : refuse absolu, lecteur et traversée", () => {
  assert.equal(cleanRelativePath("src/main.ts"), "src/main.ts")
  assert.equal(cleanRelativePath("src\\main.ts"), "src/main.ts")
  assert.equal(cleanRelativePath("/etc/passwd"), "")
  assert.equal(cleanRelativePath("C:\\Windows\\win.ini"), "")
  assert.equal(cleanRelativePath("../secret.md"), "")
  assert.equal(cleanRelativePath("a/../../b.md"), "")
  assert.equal(cleanRelativePath("   "), "")
  assert.equal(cleanRelativePath(null), "")
})

test("rememberFile : l'entrée remonte en tête et ne se duplique jamais", () => {
  let list = []
  list = rememberFile(list, { path: "a.md" }, at(1))
  list = rememberFile(list, { path: "b.md" }, at(2))
  list = rememberFile(list, { path: "a.md" }, at(3))
  assert.deepEqual(list.map((file) => file.path), ["a.md", "b.md"])
  assert.equal(list[0].opened, at(3))
  assert.equal(list[0].name, "a.md")
})

test("rememberFile : un chemin invalide ne touche pas à l'historique", () => {
  const list = rememberFile([], { path: "ok.md" }, at(1))
  assert.equal(rememberFile(list, { path: "../hors.md" }, at(2)), list)
})

test("rememberFile : borne respectée, la plus ancienne sort", () => {
  let list = []
  for (let i = 0; i < MAX_RECENT_FILES + 3; i += 1) list = rememberFile(list, { path: `f${i}.md` }, at(i))
  assert.equal(list.length, MAX_RECENT_FILES)
  assert.equal(list[0].path, `f${MAX_RECENT_FILES + 2}.md`)
  assert.ok(!list.some((file) => file.path === "f0.md"))
})

test("parseRecentFiles : écarte ce qui n'est pas un chemin valide ou déjà vu", () => {
  const files = parseRecentFiles({
    files: [
      { path: "src/a.ts", name: "a.ts", opened: at(5) },
      { path: "../evade.md", name: "evade.md", opened: at(6) },
      { path: "src/a.ts", name: "doublon", opened: at(7) },
      { path: "doc/b.md", opened: at(8) },
      "pas un objet",
    ],
  })
  assert.deepEqual(files.map((file) => file.path), ["src/a.ts", "doc/b.md"])
  assert.equal(files[1].name, "b.md")
})

test("parseRecentFiles : un fichier illisible ou mal formé donne une liste vide", () => {
  assert.deepEqual(parseRecentFiles(null), [])
  assert.deepEqual(parseRecentFiles({}), [])
  assert.deepEqual(parseRecentFiles({ files: "non" }), [])
})

test("rememberWorkspaceFile : écrit dans les métadonnées de l'espace et relit", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "aven-recent-"))
  try {
    rememberWorkspaceFile(workspace, "src/main.ts", at(10))
    const list = loadRecentFiles(workspace)
    assert.equal(list.length, 1)
    assert.equal(list[0].path, "src/main.ts")
    const raw = JSON.parse(readFileSync(path.join(workspace, ".opencode-app", "recent-files.json"), "utf8"))
    assert.equal(raw.files[0].path, "src/main.ts")
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test("loadRecentFiles : un espace sans historique ne lève pas", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "aven-recent-vide-"))
  try {
    assert.deepEqual(loadRecentFiles(workspace), [])
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

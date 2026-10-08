// Tests v9.3.0 : explorateur de fichiers de l'espace (host/workspace-files.ts).
// Accent sur safeResolve : c'est la barrière de sécurité qui cloisonne toute lecture
// à la racine de l'espace. Node pur, pas de syntaxe TS dans les .mjs.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { breadcrumbOf, listWorkspaceDir, looksBinary, readWorkspaceFile, safeResolve } from "../host/workspace-files.ts"

const makeWs = () => {
  const root = mkdtempSync(path.join(tmpdir(), "aven-ws-files-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "src", "app.ts"), "const x = 1\n")
  writeFileSync(path.join(root, "README.md"), "# Titre\n\nBonjour.\n")
  writeFileSync(path.join(root, "bin.dat"), Buffer.from([0x00, 0x01, 0x02]))
  return root
}

// ── safeResolve : la barrière ────────────────────────────────────────────────────
{
  const root = makeWs()
  try {
    // Cas légitimes.
    assert.equal(safeResolve(root, ""), path.resolve(root))
    assert.equal(safeResolve(root, "."), path.resolve(root))
    assert.equal(safeResolve(root, "src"), path.join(path.resolve(root), "src"))
    assert.equal(safeResolve(root, "src/app.ts"), path.join(path.resolve(root), "src", "app.ts"))
    // Séparateurs Windows normalisés.
    assert.equal(safeResolve(root, "src\\app.ts"), path.join(path.resolve(root), "src", "app.ts"))
    // Attaques refusées.
    assert.throws(() => safeResolve(root, ".."), /Traversée|hors de l'espace/i)
    assert.throws(() => safeResolve(root, "src/../../../etc"), /Traversée/)
    assert.throws(() => safeResolve(root, "C:\\Windows"), /absolu/i)
    assert.throws(() => safeResolve(root, "/etc/passwd"), /absolu/i)
    // Racine vide : rien n'est résoluble.
    assert.throws(() => safeResolve("", "src"), /Aucun espace/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// ── listWorkspaceDir : listing, tri, dossiers cachés exclus à la racine ─────────
{
  const root = makeWs()
  try {
    const entries = listWorkspaceDir(root, "")
    const names = entries.map((e) => e.name)
    assert.ok(names.includes("src") && names.includes("README.md") && names.includes("bin.dat"))
    assert.ok(!names.includes(".opencode-app"), "les dossiers internes sont exclus de la racine")
    const src = entries.find((e) => e.name === "src")
    assert.equal(src.kind, "dir")
    const sub = listWorkspaceDir(root, "src")
    assert.deepEqual(sub.map((e) => e.name), ["app.ts"])
    // Hors racine : refusé même si le dossier existe.
    assert.throws(() => listWorkspaceDir(root, "../"), /Traversée|hors de l'espace/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// ── readWorkspaceFile : texte OK, binaire refusé, bornes ────────────────────────
{
  const root = makeWs()
  try {
    const md = readWorkspaceFile(root, "README.md")
    assert.match(md.content, /^# Titre/)
    assert.equal(md.truncated, false)
    assert.equal(md.path, "README.md")
    const ts = readWorkspaceFile(root, "src\\app.ts")
    assert.equal(ts.content, "const x = 1\n")
    assert.throws(() => readWorkspaceFile(root, "bin.dat"), /binaire/i)
    assert.throws(() => readWorkspaceFile(root, "src"), /dossier/i)
    assert.throws(() => readWorkspaceFile(root, "../outside.txt"), /Traversée|hors de l'espace/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// ── looksBinary : NUL = binaire, texte pur = non ────────────────────────────────
{
  assert.equal(looksBinary(Buffer.from([0x23, 0x20, 0x74])), false)
  assert.equal(looksBinary(Buffer.from([0x23, 0x00, 0x74])), true)
}

// ── breadcrumbOf : fil d'ariane ──────────────────────────────────────────────────
{
  const crumbs = breadcrumbOf("src/lib/deep")
  assert.deepEqual(crumbs, [
    { label: "Espace", path: "" },
    { label: "src", path: "src" },
    { label: "lib", path: "src/lib" },
    { label: "deep", path: "src/lib/deep" },
  ])
  assert.deepEqual(breadcrumbOf(""), [{ label: "Espace", path: "" }])
  assert.deepEqual(breadcrumbOf("a\\b"), [
    { label: "Espace", path: "" },
    { label: "a", path: "a" },
    { label: "b", path: "a/b" },
  ])
}

console.log("workspace-files: OK")

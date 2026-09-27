import assert from "node:assert/strict"
import { test } from "node:test"
import {
  buildPtyCommand,
  ptyBackoffMs,
  isPtyBootCrash,
  isFreebuffPtyActive,
  ptyModulePath,
  MAX_PTY_BOOT_ATTEMPTS,
  MAX_PTY_SCROLLBACK,
  PTY_BOOT_GRACE_MS,
  DEFAULT_PTY_COLS,
  DEFAULT_PTY_ROWS,
} from "../electron/freebuff-pty.ts"

// Contrat du protocole freebuff-pty (v9.2.0, revue v9.2.1) : commande PTY correcte,
// backoff de boot, scrollback borné, singleton visible pour les garde-fous de main.ts.
// Les chemins spawn/session ne sont pas testés unitairement (process réel).

test("buildPtyCommand : cmd.exe /c freebuff --cwd, sans guillemets imbriqués (spawn-safe)", () => {
  const cmd = buildPtyCommand("C:\\Mon Espace")
  assert.equal(cmd.file, "cmd.exe") // extension explicite : ConPTY n'effectue pas de recherche PATHEXT
  // /c (et non /k) : la mort du CLI doit se voir dans la vue (statut « terminé »).
  assert.deepEqual(cmd.args, ["/c", "freebuff", "--cwd", "C:\\Mon Espace"])
})

test("buildPtyCommand : refuse un espace vide (requireWorkspace en amont)", () => {
  assert.throws(() => buildPtyCommand(""), /Aucun espace/)
  assert.throws(() => buildPtyCommand("   "), /Aucun espace/)
})

test("ptyBackoffMs : backoff 1 s, 2 s, 4 s (tentatives 1, 2, 3)", () => {
  assert.equal(ptyBackoffMs(1), 1000)
  assert.equal(ptyBackoffMs(2), 2000)
  assert.equal(ptyBackoffMs(3), 4000)
  assert.equal(ptyBackoffMs(0), 1000) // jamais négatif ni nul
})

test("isPtyBootCrash : reconnaît les échecs de boot natifs (ECONNRESET connu du CLI)", () => {
  assert.equal(isPtyBootCrash(new Error("read ECONNRESET")), true)
  assert.equal(isPtyBootCrash(new Error("exited with code 1")), true)
  assert.equal(isPtyBootCrash(new Error("spawn ENOENT")), true)
  assert.equal(isPtyBootCrash(new Error("write EPIPE")), true)
  assert.equal(isPtyBootCrash(new Error("erreur inconnue")), false)
  assert.equal(isPtyBootCrash(undefined), false)
})

test("limites du protocole : 3 tentatives de boot, grâce 5 s, scrollback 256 Kio", () => {
  assert.equal(MAX_PTY_BOOT_ATTEMPTS, 3)
  assert.equal(PTY_BOOT_GRACE_MS, 5000)
  assert.equal(MAX_PTY_SCROLLBACK, 256 * 1024)
})

test("singleton : aucun PTY actif hors session (garde mono-session v9.1.5)", () => {
  assert.equal(isFreebuffPtyActive(), false)
})

test("ptyModulePath : chemin dev (node_modules) vs packagé (app.asar.unpacked)", () => {
  const dev = ptyModulePath("C:\\app\\dist-electron", false)
  assert.ok(dev.includes("node_modules") && dev.includes("@lydell") && dev.includes("node-pty"))
  const packed = ptyModulePath("C:\\app\\dist-electron", true)
  assert.ok(packed.includes("app.asar.unpacked"), "les binaires natifs doivent vivre HORS de l'asar")
  assert.ok(packed.includes("@lydell"))
})

test("défauts de vue terminal : 120×30 (l'émulateur ajustera via resize)", () => {
  assert.equal(DEFAULT_PTY_COLS, 120)
  assert.equal(DEFAULT_PTY_ROWS, 30)
})

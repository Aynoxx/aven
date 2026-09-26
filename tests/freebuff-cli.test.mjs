import assert from "node:assert/strict"
import { test } from "node:test"
import { buildLaunchCommand, freebuffMissingMessage, parseVersionOutput, unsupportedPlatform } from "../electron/freebuff-cli.ts"

test("buildLaunchCommand : start /D sur l'espace, arguments séparés (spawn-safe)", () => {
  const cmd = buildLaunchCommand("C:\\Users\\Liam\\Documents\\Aven-workspace")
  assert.equal(cmd.command, "cmd")
  assert.deepEqual(cmd.args, [
    "/c", "start", "Freebuff", "/D", "C:\\Users\\Liam\\Documents\\Aven-workspace",
    "cmd", "/k", "freebuff", "--cwd", "C:\\Users\\Liam\\Documents\\Aven-workspace",
  ])
})

test("buildLaunchCommand : chemin avec espaces préservé comme un seul argument", () => {
  const cmd = buildLaunchCommand("C:\\Mes Projets\\Mon Espace")
  assert.ok(cmd.args.includes("C:\\Mes Projets\\Mon Espace"))
  assert.ok(!cmd.args.join(" ").includes("cd /d")) // plus de cd imbriqué, plus de guillemets à dé Doubler
})

test("buildLaunchCommand : login sur l'espace, install = npm global sans dossier", () => {
  const login = buildLaunchCommand("C:\\ws", "login")
  assert.deepEqual(login.args.slice(-2), ["freebuff", "login"])
  const install = buildLaunchCommand("C:\\ws", "install")
  assert.deepEqual(install.args.slice(-4), ["npm", "install", "-g", "freebuff"])
  assert.ok(!install.args.includes("/D"))
  assert.throws(() => buildLaunchCommand(""), /Aucun espace/)
})

test("freebuffMissingMessage : message d'installation clair (v9.1.3, plus de terminal « freebuff introuvable »)", () => {
  const msg = freebuffMissingMessage()
  assert.match(msg, /pas install/)
  assert.match(msg, /npm install -g freebuff/)
  assert.match(msg, /Param[eè]tres/i)
})

test("parseVersionOutput : installe avec version, ou non installé", () => {
  assert.deepEqual(parseVersionOutput("0.0.203\n"), { installed: true, version: "0.0.203" })
  assert.deepEqual(parseVersionOutput("freebuff/0.1.0"), { installed: true, version: "0.1.0" })
  assert.deepEqual(parseVersionOutput(""), { installed: false })
  assert.deepEqual(parseVersionOutput("command not found"), { installed: false })
  assert.deepEqual(parseVersionOutput("", "npm error could not determine executable to run"), { installed: false })
})

test("unsupportedPlatform : message clair avec la plateforme", () => {
  assert.match(unsupportedPlatform("darwin"), /darwin/)
  assert.match(unsupportedPlatform("linux"), /npm install -g freebuff/)
})

import assert from "node:assert/strict"
import { test } from "node:test"
import { buildLaunchCommand, freebuffBusyMessage, freebuffMissingMessage, parseVersionOutput, unsupportedPlatform } from "../electron/freebuff-cli.ts"

test("buildLaunchCommand : start /D sur l'espace, arguments séparés (spawn-safe)", () => {
  const cmd = buildLaunchCommand("C:\\Users\\Liam\\Documents\\Aven-workspace")
  assert.equal(cmd.command, "cmd")
  // v9.1.4 : titre de fenêtre VIDE quoté — sinon `start` prend le 1er argument quoté
  // pour le programme à lancer (« Windows ne trouve pas 'Freebuff' »).
  assert.deepEqual(cmd.args, [
    "/c", "start", "\"\"", "/D", "C:\\Users\\Liam\\Documents\\Aven-workspace",
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

test("buildLaunchCommand : le titre vide quoté précède toujours la cible (anti-régression v9.1.4)", () => {
  for (const action of ["launch", "login", "install"]) {
    const cmd = buildLaunchCommand("C:\\ws", action)
    const i = cmd.args.indexOf("start")
    assert.equal(cmd.args[i + 1], "\"\"", `action ${action} : le titre vide doit venir juste après start`)
    assert.ok(!cmd.args.includes("Freebuff"), "plus aucun titre quoté interprétable comme programme")
  }
})

test("freebuffMissingMessage : message d'installation clair (v9.1.3, plus de terminal « freebuff introuvable »)", () => {
  const msg = freebuffMissingMessage()
  assert.match(msg, /pas install/)
  assert.match(msg, /npm install -g freebuff/)
  assert.match(msg, /Param[eè]tres/i)
})

test("freebuffBusyMessage : refuse le 2e terminal, explique le takeover de session (v9.1.5)", () => {
  const msg = freebuffBusyMessage()
  assert.match(msg, /déjà ouvert/)
  assert.match(msg, /une seule session/i)
  assert.match(msg, /taken over/) // l'erreur exacte vue par l'utilisateur doit être expliquée
  assert.match(msg, /ferme-le/i)
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

import assert from "node:assert/strict"
import { test } from "node:test"
import { createCliManager } from "../host/freebuff-cli-manager.ts"

// v10.3.0 : le CLI Freebuff est vérifié/installé PAR UN SEUL gestionnaire, au
// démarrage de l'app. Ces tests figent les garanties qui manquaient aux trois
// installations concurrentes précédentes : une seule installation à la fois,
// aucune réinstallation quand le CLI répond, et « réussi » SEULEMENT si
// `freebuff --version` le confirme.

const instant = async () => {}
const fixedNow = () => 1_000

test("CLI déjà installé : aucune installation, état ready avec la version", async () => {
  let installs = 0
  const manager = createCliManager({
    check: async () => ({ installed: true, version: "1.2.3" }),
    install: async () => { installs++ },
    sleep: instant,
    now: fixedNow,
  })

  const status = await manager.ensure()

  assert.equal(installs, 0, "un CLI qui répond ne doit jamais être réinstallé")
  assert.equal(status.state, "ready")
  assert.equal(status.installed, true)
  assert.equal(status.version, "1.2.3")
})

test("CLI absent : une installation, confirmée par la vérification", async () => {
  let installs = 0
  let installed = false
  const manager = createCliManager({
    check: async () => (installed ? { installed: true, version: "0.9.0" } : { installed: false }),
    install: async () => { installs++; installed = true },
    sleep: instant,
    now: fixedNow,
  })

  const status = await manager.ensure()

  assert.equal(installs, 1)
  assert.equal(status.state, "ready")
  assert.equal(status.version, "0.9.0")
})

test("installation terminée mais binaire muet : état failed, pas « installé »", async () => {
  let installs = 0
  const manager = createCliManager({
    check: async () => ({ installed: false }),
    install: async () => { installs++ },
    sleep: instant,
    now: fixedNow,
    verifyAttempts: 3,
  })

  const status = await manager.ensure()

  assert.equal(installs, 1)
  assert.equal(status.installed, false)
  assert.equal(status.state, "failed")
  assert.match(status.error ?? "", /ne répond pas/)
})

test("plusieurs appels concurrents (App + page Projet) ne lancent qu'une installation", async () => {
  let installs = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const manager = createCliManager({
    check: async () => ({ installed: false }),
    install: async () => { installs++; await gate },
    sleep: instant,
    now: fixedNow,
  })

  const first = manager.ensure()
  const second = manager.ensure()
  const third = manager.ensure()
  release()
  const results = await Promise.all([first, second, third])

  assert.equal(installs, 1, "le singleton est la seule protection contre les npm concurrents")
  assert.ok(results.every((r) => r.state === "failed"))
})

test("après un échec, pas de nouvelle tentative automatique pendant le cooldown", async () => {
  let installs = 0
  let clock = 0
  const manager = createCliManager({
    check: async () => ({ installed: false }),
    install: async () => { installs++; throw new Error("réseau indisponible") },
    sleep: instant,
    now: () => clock,
    retryCooldownMs: 60_000,
  })

  const first = await manager.ensure()
  assert.equal(first.state, "failed")
  assert.match(first.error ?? "", /réseau indisponible/)

  clock = 30_000
  const second = await manager.ensure()
  assert.equal(installs, 1, "le cooldown absorbe un second appel automatique")
  assert.equal(second.state, "failed")

  // L'utilisateur peut forcer (bouton « Installer ») : le cooldown ne le bloque pas.
  await manager.ensure(true)
  assert.equal(installs, 2)
})

test("un abonné qui lève ne casse pas l'installation", async () => {
  let installs = 0
  const states = []
  const manager = createCliManager({
    check: async () => (installs ? { installed: true, version: "1.0.0" } : { installed: false }),
    install: async () => { installs++ },
    sleep: instant,
    now: fixedNow,
    onChange: (snapshot) => {
      states.push(snapshot.state)
      throw new Error("abonné fautif")
    },
  })

  const status = await manager.ensure()

  assert.equal(status.state, "ready")
  assert.deepEqual(states, ["checking", "installing", "ready"], "l'installation continue après une erreur d'abonné")
})

test("status() reflète l'état courant sans relancer d'installation", async () => {
  const manager = createCliManager({
    check: async () => ({ installed: true, version: "3.0.0" }),
    install: async () => {},
    sleep: instant,
    now: fixedNow,
  })

  assert.equal(manager.status().state, "unknown")
  await manager.ensure()
  const status = manager.status()
  assert.equal(status.state, "ready")
  assert.equal(status.installed, true)
  assert.equal(status.version, "3.0.0")
  assert.equal(status.error, undefined)
})

import assert from "node:assert/strict"
import { test } from "node:test"
import { effectiveIntent } from "../web/src/dictation-routing.ts"

// v10.4.0 : la provenance d'une dictée décide de tout. Le composeur ne doit JAMAIS
// déclencher une action (sinon « ouvre les paramètres » dicté dans une conversation
// quittait la conversation) ; le hub, lui, exécute la commande au lieu de l'envoyer
// à l'agent comme du texte.

const AGENTS = ["projet", "code", "recherche", "analyse"]

test("composeur : une commande d'application reste une dictée ordinaire", () => {
  for (const action of ["open-settings", "open-project", "new-chat", "go-home"]) {
    assert.deepEqual(
      effectiveIntent({ intent: "app", action }, "composer", AGENTS),
      { intent: "chat" },
      `${action} ne doit rien exécuter depuis le composeur`,
    )
  }
})

test("composeur : aucune bascule d'agent", () => {
  assert.deepEqual(
    effectiveIntent({ intent: "agent", target: "code" }, "composer", AGENTS),
    { intent: "chat" },
  )
})

test("hub : la commande d'application traverse telle quelle", () => {
  assert.deepEqual(
    effectiveIntent({ intent: "app", action: "open-project" }, "workbench", AGENTS),
    { intent: "app", action: "open-project" },
  )
  assert.deepEqual(
    effectiveIntent({ intent: "app", action: "open-settings" }, "workbench", AGENTS),
    { intent: "app", action: "open-settings" },
  )
})

test("hub : une cible d'agent connue bascule, une cible inconnue devient une dictée", () => {
  assert.deepEqual(
    effectiveIntent({ intent: "agent", target: "recherche" }, "workbench", AGENTS),
    { intent: "agent", target: "recherche" },
  )
  assert.deepEqual(
    effectiveIntent({ intent: "agent", target: "superadmin" }, "workbench", AGENTS),
    { intent: "chat" },
  )
  assert.deepEqual(effectiveIntent({ intent: "agent" }, "workbench", AGENTS), { intent: "chat" })
})

test("hub : dictée ordinaire ou intention absente restent des dictées", () => {
  assert.deepEqual(effectiveIntent({ intent: "chat" }, "workbench", AGENTS), { intent: "chat" })
  assert.deepEqual(effectiveIntent(undefined, "workbench", AGENTS), { intent: "chat" })
})

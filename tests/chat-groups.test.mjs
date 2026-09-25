import assert from "node:assert/strict"
import { test } from "node:test"
import { groupChatsByAgent } from "../web/src/chat-groups.ts"

test("groupChatsByAgent : regroupe par agent, actif en premier, tri par mise à jour", () => {
  const chats = [
    { id: "1", agent: "recherche", updated: 3 },
    { id: "2", agent: "code", updated: 9 },
    { id: "3", agent: "code", updated: 5 },
    { id: "4", agent: "analyse", updated: 1 },
  ]
  const groups = groupChatsByAgent(chats, ["code", "recherche", "analyse"])
  assert.deepEqual(groups.map((g) => g.agent), ["code", "recherche", "analyse"]) // ordre des agents respecté
  assert.deepEqual(groups[0].chats.map((c) => c.id), ["2", "3"]) // mise à jour décroissante
})

test("groupChatsByAgent : conversations sans agent connu = groupe « autre » en dernier", () => {
  const chats = [
    { id: "1", agent: "inconnu", updated: 2 },
    { id: "2", agent: "code", updated: 1 },
    { id: "3", updated: 5 },
  ]
  const groups = groupChatsByAgent(chats, ["code"])
  assert.equal(groups.length, 2)
  assert.deepEqual(groups[1], { agent: "", chats: [{ id: "3", updated: 5 }, { id: "1", agent: "inconnu", updated: 2 }] })
})

test("groupChatsByAgent : liste vide = aucun groupe", () => {
  assert.deepEqual(groupChatsByAgent([], ["code"]), [])
})

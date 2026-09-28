import assert from "node:assert/strict"
import { test } from "node:test"
import { makeOps } from "../electron/operations.ts"

// v9.4.0 : le sélecteur de modèle de l'interface passe par setChatModel/chainFor.
// Stub minimal du Bridge OpenCode : seuls client.session.switchModel/get sont
// appelés (switchModel met à jour la session stub, comme le serveur le ferait).
function stubBridge() {
  const sessions = {
    s1: { id: "s1", agent: "code", model: { providerID: "opencode", id: "big-pickle" } },
  }
  return {
    workspace: "/tmp/aven-ws",
    client: { session: {
      async switchModel(arg) { sessions[arg.sessionID].model = arg.model },
      async get(arg) { return sessions[arg.sessionID] },
    } },
  }
}

function stubRouter() {
  return {
    chains: {
      code: [
        { ref: "opencode/a-free", label: "A", priority: 1 },
        { ref: "opencode/b-free", label: "B", priority: 2 },
      ],
    },
    pick() { return "opencode/a-free" },
  }
}

test("setChatModel épingle le modèle via session.switchModel", async () => {
  const ops = makeOps(() => stubBridge(), () => stubRouter())
  const chat = await ops.setChatModel("s1", "openrouter/x/y:free")
  assert.equal(chat.model, "openrouter/x/y:free")
})

test("setChatModel sans ref = Auto : le routeur reprend la main", async () => {
  const picked = []
  const router = stubRouter()
  router.pick = (task) => { picked.push(task); return "opencode/b-free" }
  const ops = makeOps(() => stubBridge(), () => router)
  const chat = await ops.setChatModel("s1")
  assert.deepEqual(picked, ["projet"])
  assert.equal(chat.model, "opencode/b-free")
})

test("chainFor expose la chaîne du routeur (ref + label), vide sinon", () => {
  const ops = makeOps(() => stubBridge(), () => stubRouter())
  assert.deepEqual(ops.chainFor("code"), [
    { ref: "opencode/a-free", label: "A" },
    { ref: "opencode/b-free", label: "B" },
  ])
  assert.deepEqual(ops.chainFor("inconnu"), [])
  const sansRouteur = makeOps(() => stubBridge(), () => null)
  assert.deepEqual(sansRouteur.chainFor("code"), [])
})

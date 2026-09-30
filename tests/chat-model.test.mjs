import assert from "node:assert/strict"
import { test } from "node:test"
import { makeOps } from "../electron/operations.ts"

// v9.8.0 (phase 1) : makeOps parle au host du moteur via un BridgeHost — le SDK
// est un proxy JSON-RPC. Le stub mime le host : seules session.switchModel/get
// sont appelées ici (switchModel met à jour la session stub, comme le serveur).
function stubHost() {
  const sessions = {
    s1: { id: "s1", agent: "code", model: { providerID: "opencode", id: "big-pickle" } },
  }
  return {
    workspace: "/tmp/aven-ws",
    loadNames: () => ({}),
    archived: () => [],
    client: { session: {
      async switchModel(arg) { sessions[arg.sessionID].model = arg.model },
      async get(arg) { return sessions[arg.sessionID] },
    } },
    chains: {
      code: [
        { ref: "opencode/a-free", label: "A", priority: 1 },
        { ref: "opencode/b-free", label: "B", priority: 2 },
      ],
    },
    router: {
      pick() { return "opencode/a-free" },
      async beforeSend() {},
      forget() {},
    },
  }
}

test("setChatModel épingle le modèle via session.switchModel", async () => {
  const ops = makeOps(() => stubHost())
  const chat = await ops.setChatModel("s1", "openrouter/x/y:free")
  assert.equal(chat.model, "openrouter/x/y:free")
})

test("setChatModel sans ref = Auto : le routeur reprend la main", async () => {
  const picked = []
  const host = stubHost()
  host.router.pick = (task) => { picked.push(task); return "opencode/b-free" }
  const ops = makeOps(() => host)
  const chat = await ops.setChatModel("s1")
  assert.deepEqual(picked, ["projet"])
  assert.equal(chat.model, "opencode/b-free")
})

test("chainFor expose la chaîne du routeur (ref + label), vide sinon", () => {
  const ops = makeOps(() => stubHost())
  assert.deepEqual(ops.chainFor("code"), [
    { ref: "opencode/a-free", label: "A" },
    { ref: "opencode/b-free", label: "B" },
  ])
  assert.deepEqual(ops.chainFor("inconnu"), [])
})

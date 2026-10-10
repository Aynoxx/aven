import assert from "node:assert/strict"
import { test } from "node:test"
import { rpcObjectParam } from "../host/rpc-params.ts"

test("déplie un objet passé comme argument positionnel depuis Rust", () => {
  const input = { workspace: "C:/tmp/aven-smoke", templateDir: "C:/repo" }
  assert.deepEqual(rpcObjectParam([input]), input)
})

test("accepte aussi un objet JSON-RPC nommé", () => {
  const input = { workspace: "C:/tmp/aven-smoke" }
  assert.deepEqual(rpcObjectParam(input), input)
})

test("refuse les paramètres objet absents ou invalides", () => {
  for (const input of [undefined, null, [], ["text"], "text", 3]) {
    assert.throws(() => rpcObjectParam(input), /Paramètre objet JSON-RPC absent ou invalide/)
  }
})

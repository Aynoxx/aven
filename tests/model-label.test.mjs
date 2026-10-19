// Tests v10.2.2 : libellé du modèle actif (web/src/model-label.ts).
import assert from "node:assert/strict"
import { test } from "node:test"
import { AUTO_MODEL_LABEL, usableModelRef } from "../web/src/model-label.ts"

test("usableModelRef garde une ref réelle", () => {
  assert.equal(usableModelRef("openrouter/x/y:free"), "openrouter/x/y:free")
  assert.equal(usableModelRef("  opencode/big-pickle  "), "opencode/big-pickle")
})

test("usableModelRef écarte les valeurs dégénérées", () => {
  for (const value of [undefined, null, "", "   ", "null", "NULL", "undefined", "null/", "null/provider/model", "undefined/x"]) {
    assert.equal(usableModelRef(value), null, `attendu null pour ${String(value)}`)
  }
})

test("le libellé Auto est explicite", () => {
  assert.match(AUTO_MODEL_LABEL, /Auto/)
})

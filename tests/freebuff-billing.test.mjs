import assert from "node:assert/strict"
import { test } from "node:test"
import { isBillingError } from "../electron/freebuff.ts"

// Le repli v9.1.1 ne doit se déclencher QUE sur un problème de facturation Codebuff :
// toute autre erreur (réseau, clé manquante, bug) doit rester visible.
test("isBillingError : reconnaît les erreurs de crédits Codebuff", () => {
  assert.equal(isBillingError(new Error("Freebuff : Payment Required")), true)
  assert.equal(isBillingError(new Error("Freebuff : 402 — compte sans crédits")), true)
  assert.equal(isBillingError(new Error("insufficient credits for this run")), true)
  assert.equal(isBillingError(new Error("HTTP 402")), true)
  assert.equal(isBillingError("Freebuff : plus de crédit disponible"), true)
})

test("isBillingError : refuse tout le reste (réseau, clé, bug)", () => {
  assert.equal(isBillingError(new Error("getaddrinfo ENOTFOUND api.codebuff.com")), false)
  assert.equal(isBillingError(new Error("Configure une clé Codebuff dans Paramètres")), false)
  assert.equal(isBillingError(new Error("Freebuff a signalé une erreur.")), false)
  assert.equal(isBillingError(new Error("Réponse Freebuff invalide.")), false)
  assert.equal(isBillingError(undefined), false)
})

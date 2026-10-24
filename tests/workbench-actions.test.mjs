import assert from "node:assert/strict"
import { test } from "node:test"
import { planFor, verbsFor, VERB_LABELS } from "../web/src/workbench/actions.ts"

test("verbsFor : chaque objet a ses verbes, jamais tous", () => {
  assert.deepEqual(verbsFor("message"), ["transmit", "cite", "terminal", "copy"])
  assert.deepEqual(verbsFor("note"), ["transmit", "terminal", "pin", "copy"])
  assert.deepEqual(verbsFor("file"), ["transmit", "terminal", "copy"])
  assert.deepEqual(verbsFor("terminal"), ["transmit", "cite", "copy"])
  assert.equal(verbsFor("file").includes("pin"), false)
})

test("planFor transmettre : prépare le composeur, ne l'envoie jamais", () => {
  const plan = planFor("transmit", { kind: "message", body: "Bonjour", title: "Échange" })
  assert.equal(plan?.mode, "compose")
  assert.equal(plan?.text, "Bonjour")
  // Aucun mode « send » n'existe : le contrat interdit l'envoi implicite.
  assert.equal(Object.values(VERB_LABELS).some((label) => /envoyer/i.test(label)), false)
})

test("planFor transmettre un fichier : demande d'analyse avec le chemin", () => {
  const plan = planFor("transmit", { kind: "file", path: "src/app.ts", title: "app.ts" })
  assert.equal(plan?.mode, "compose")
  assert.match(plan?.text ?? "", /src\/app\.ts/)
  assert.match(plan?.text ?? "", /Analyse le fichier/)
})

test("planFor citer : transforme le corps en citation datée par le titre", () => {
  const plan = planFor("cite", { kind: "message", body: "ligne 1\nligne 2", title: "Réponse" })
  assert.equal(plan?.mode, "note")
  assert.match(plan?.text ?? "", /^> ligne 1\n> ligne 2/)
  assert.match(plan?.text ?? "", /— Réponse$/)
})

test("planFor terminal : un fichier transmet son chemin, un texte son corps", () => {
  assert.deepEqual(planFor("terminal", { kind: "file", path: "README.md" }), { mode: "terminal", text: "README.md" })
  assert.deepEqual(planFor("terminal", { kind: "message", body: "npm test" }), { mode: "terminal", text: "npm test" })
})

test("planFor épingler : seulement une note avec identifiant", () => {
  assert.deepEqual(planFor("pin", { kind: "note", id: "note-1" }), { mode: "pin", id: "note-1" })
  assert.equal(planFor("pin", { kind: "note" }), null)
  assert.equal(planFor("pin", { kind: "message", id: "x" }), null)
})

test("planFor : un verbe absent de l'objet renvoie null", () => {
  assert.equal(planFor("pin", { kind: "file", path: "a" }), null)
  assert.equal(planFor("cite", { kind: "file", path: "a" }), null)
})

// v11.4.4 : le dictionnaire de prononciation réécrit les noms propres pour la
// voix locale, et JAMAIS pour une voix distante — c'est la convention que ce
// test protège. Un nom propre avalé par la synthèse a coûté quatre écoutes
// comparatives (v11.4.4) : il ne doit pas revenir en silence.
// v11.14.0 : les voix neuronales ont été retirées ; le dictionnaire reste PAR
// MOTEUR — chaque table ne couvre que ce qui existe encore.
import assert from "node:assert/strict"
import test from "node:test"
import { PRONUNCIATIONS, applyPronunciations } from "../host/pronunciation.ts"

test("la voix locale reçoit la graphie phonétique des deux noms", () => {
  const spoken = applyPronunciations("J'ai enregistré la note dans Aven, et Freebuff a fini.", "sapi")
  assert.equal(spoken, "J'ai enregistré la note dans Aveun, et Fribeuf a fini.")
})

test("la casse n'empêche pas la réécriture", () => {
  assert.equal(applyPronunciations("FREEBUFF", "sapi"), "Fribeuf")
  assert.equal(applyPronunciations("aven", "sapi"), "Aveun")
})

test("un mot plus long qui contient l'entrée n'est pas touché", () => {
  assert.equal(applyPronunciations("l'avenir de Freebufferie", "sapi"), "l'avenir de Freebufferie")
})

test("la ponctuation qui colle au nom reste intacte", () => {
  assert.equal(applyPronunciations("Dans Aven. Puis Freebuff, enfin.", "sapi"), "Dans Aveun. Puis Fribeuf, enfin.")
})

test("le dictionnaire ne couvre que les moteurs qui existent encore", () => {
  // v11.14.0 : « edge » et « piper » ont disparu du type — la table ne doit pas
  // les ressusciter en silence.
  assert.deepEqual(Object.keys(PRONUNCIATIONS).sort(), ["pocket", "sapi"])
})

test("la voix locale Pocket reçoit les mêmes graphies que la voix Windows", () => {
  const text = "J'ai enregistré la note dans Aven, et Freebuff a fini."
  assert.equal(applyPronunciations(text, "pocket"), "J'ai enregistré la note dans Aveun, et Fribeuf a fini.")
  assert.equal(PRONUNCIATIONS.pocket.Freebuff, "Fribeuf")
  assert.equal(PRONUNCIATIONS.pocket.Aven, "Aveun")
})

test("la table locale porte bien les deux entrées validées à l'oreille", () => {
  assert.equal(PRONUNCIATIONS.sapi.Freebuff, "Fribeuf")
  assert.equal(PRONUNCIATIONS.sapi.Aven, "Aveun")
})

test("un texte vide ou absent ne lève pas", () => {
  assert.equal(applyPronunciations("", "sapi"), "")
  // Le host peut recevoir un texte absent d'un IPC : le module ne doit pas lever.
  assert.equal(applyPronunciations(undefined, "sapi"), "")
})

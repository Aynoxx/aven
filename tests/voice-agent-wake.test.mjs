import assert from "node:assert/strict"
import { test } from "node:test"
import {
  detectWakeWord,
  hasWakeWord,
  normalizeVoiceText,
  stripPoliteness,
  stripWakeWord,
} from "../host/voice-agent-wake.ts"

// v11.1.0 : le mot d'activation est « Aven », jamais un autre nom. La détection
// tolère accents, casse et coupe « a ven », mais ne réveille pas l'agent sur un
// mot qui CONTIENT « aven » (« aventure », « événement »).

test("normalisation : minuscules, sans accents, ponctuation en espaces", () => {
  assert.equal(normalizeVoiceText("Avène, ouvre les notes !"), "avene ouvre les notes")
  assert.equal(normalizeVoiceText("  S'IL TE PLAÎT  "), "s'il te plait")
})

test("mot d'activation : variantes acceptées", () => {
  for (const phrase of ["Aven, ouvre les notes", "avène", "a ven", "Avenne", "hey Aven", "OK Aven, stop"]) {
    assert.equal(hasWakeWord(phrase), true, `${phrase} réveille l'agent`)
  }
})

// v11.2.1 : prononcé « Aveun » (A français, « ven » à l'anglaise), le STT écrit
// « Haven » — le réveil échouait sans trace alors que la transcription était juste.
// Chaque graphie mesurée sur une vraie dictée doit réveiller l'agent.
 test("mot d'activation : les graphies du STT (« Haven », « Aveun », « Avin »)", () => {
  for (const phrase of [
    "Haven, ouvre les notes",
    "haven quelle heure est-il",
    "Havenne, ouvre une note",
    "Aveun, ouvre les notes",
    "Avin, quelle heure est-il",
    "haven, stop",
  ]) {
    assert.equal(hasWakeWord(phrase), true, `${phrase} réveille l'agent`)
  }
})

test("mot d'activation : la graphie acceptée est retirée comme les autres", () => {
  assert.equal(stripWakeWord("Haven, ouvre les notes"), "ouvre les notes")
  assert.equal(stripWakeWord("Aveun ouvre les notes"), "ouvre les notes")
  assert.equal(detectWakeWord("s'il te plaît Haven, ouvre les notes").command, "ouvre les notes")
})

test("mot d'activation : aucun faux positif sur un mot qui le contient", () => {
  for (const phrase of ["une aventure", "cet événement", "avant de partir", "l'avent", "avenir"] ) {
    assert.equal(hasWakeWord(phrase), false, `${phrase} ne réveille pas l'agent`)
  }
  // v11.2.1 : l'élargissement des graphies ne doit pas absorber les mots voisins.
  for (const phrase of ["l'avenue est longue", "un avenant au contrat", "il a vécu un an"]) {
    assert.equal(hasWakeWord(phrase), false, `${phrase} ne réveille pas l'agent`)
  }
})

// v11.1.1 : Whisper écrit souvent « Aven » en « Avant ». La pause prouve que le
// mot ouvre une adresse ; sans elle, « avant de partir » reste du texte.
test("homophones : « Avant, » et « Avent, » réveillent, pas « avant de… »", () => {
  assert.equal(hasWakeWord("Avant, ouvre une note"), true)
  assert.equal(hasWakeWord("Avent : ouvre les notes"), true)
  assert.equal(hasWakeWord("Avant de partir"), false)
  assert.equal(hasWakeWord("Avant je pensais que"), false)
})

test("retrait de l'homophone : la demande reste entière", () => {
  assert.equal(stripWakeWord("Avant, ouvre une note"), "ouvre une note")
  assert.equal(detectWakeWord("Avant, quelle heure est-il ?").command, "quelle heure est-il ?")
})

test("retrait du mot d'activation : le texte utile reste entier", () => {
  assert.equal(stripWakeWord("Aven, ouvre les notes"), "ouvre les notes")
  assert.equal(stripWakeWord("a ven ouvre les notes"), "ouvre les notes")
  assert.equal(stripWakeWord("Aven"), "")
})

test("politesses retirées en début et en fin, contenu conservé", () => {
  assert.equal(stripPoliteness("s'il te plaît, ouvre les notes"), "ouvre les notes")
  assert.equal(stripPoliteness("ouvre les notes, merci"), "ouvre les notes")
  assert.equal(stripPoliteness(": ouvre les notes"), "ouvre les notes")
})

test("détection complète : politesse avant le mot d'activation", () => {
  const result = detectWakeWord("s'il te plaît Aven, ouvre les notes")
  assert.equal(result.woken, true)
  assert.equal(result.command, "ouvre les notes")
})

test("transcription vide ou sans demande : aucun crash", () => {
  assert.deepEqual(detectWakeWord(""), { woken: false, command: "" })
  assert.deepEqual(detectWakeWord("Aven"), { woken: true, command: "" })
})

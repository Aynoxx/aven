import assert from "node:assert/strict"
import { test } from "node:test"
import {
  detectWakeWord,
  hasWakeWord,
  isSleepPhrase,
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

// v11.11.1 : « Aven » prononcé à la française revient souvent transcrit « Raven »
// (le STT entend une consonne avant le « A »). Chaque graphie mesurée doit
// réveiller l'agent — et les mots français proches ne doivent pas.
test("mot d'activation : « Raven » (consonne entendue avant le A)", () => {
  for (const phrase of ["Raven, ouvre les notes", "raven quelle heure est-il", "Ravenne, ouvre une note"]) {
    assert.equal(hasWakeWord(phrase), true, `${phrase} réveille l'agent`)
  }
  assert.equal(stripWakeWord("Raven, ouvre les notes"), "ouvre les notes")
  assert.equal(detectWakeWord("Raven, note que la réunion est à 14 h").command, "note que la réunion est à 14 h")
  // Le « r » n'est admis que sur la famille en « e » : ravin et ravine sont des
  // mots français, et une phrase ordinaire ne réveille rien.
  for (const phrase of ["un ravin profond", "la ravine est sèche", "le ravin longe la route"]) {
    assert.equal(hasWakeWord(phrase), false, `${phrase} ne réveille pas l'agent`)
  }
})

// v11.12.0 : la veille se quitte par un ordre NOMMÉ. La phrase doit être entière —
// « comment je dors mieux ? » est une demande, et « silence »/« stop » restent les
// commandes d'interruption qu'elles étaient (elles coupent la lecture sans fermer
// la conversation).
test("ordre de repos : la phrase entière, jamais un mot dans une demande", () => {
  for (const phrase of ["dors", "Dors.", "rendors-toi", "mets-toi en veille", "au repos", "tu peux te reposer", "s'il te plaît dors"]) {
    assert.equal(isSleepPhrase(phrase), true, `${phrase} rendort l'agent`)
  }
  for (const phrase of ["comment je dors mieux ?", "la dorsale du dossier", "je dors mal la nuit", "silence", "stop", "arrête", "repose la note sur le bureau"]) {
    assert.equal(isSleepPhrase(phrase), false, `${phrase} n'est pas un ordre de repos`)
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

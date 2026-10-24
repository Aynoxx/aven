import assert from "node:assert/strict"
import { test } from "node:test"
import { interpretVoiceText, routeVoiceCommand } from "../host/voice-agent-commands.ts"

// v11.1.0 : les commandes fiables sont codées ; une question ou une demande de
// contenu ne doit JAMAIS être absorbée par un motif de navigation.

test("commandes de navigation reconnues", () => {
  assert.equal(routeVoiceCommand("ouvre les notes"), "open-notes")
  assert.equal(routeVoiceCommand("affiche les réglages"), "open-settings")
  assert.equal(routeVoiceCommand("ouvre les paramètres"), "open-settings")
  assert.equal(routeVoiceCommand("ouvre les fichiers"), "open-workspace")
  assert.equal(routeVoiceCommand("ouvre le dossier du projet"), "open-workspace")
  assert.equal(routeVoiceCommand("lance le terminal Freebuff"), "open-project")
  assert.equal(routeVoiceCommand("ouvre l'orchestration"), "open-agents")
  assert.equal(routeVoiceCommand("retourne à l'accueil"), "go-home")
  assert.equal(routeVoiceCommand("nouvelle conversation"), "new-chat")
})

test("commandes locales : micro et lecture", () => {
  assert.equal(routeVoiceCommand("coupe le micro"), "mute-microphone")
  assert.equal(routeVoiceCommand("arrête de parler"), "stop-speaking")
  assert.equal(routeVoiceCommand("tais-toi"), "stop-speaking")
})

// v11.1.2 : les formulations naturelles de sourdine ne doivent plus partir au
// LLM (qui répondait « c'est fait » sans couper le micro).
test("sourdine : les formulations naturelles sont des commandes", () => {
  for (const phrase of [
    "coupe le micro",
    "ferme le microphone",
    "désactive l'écoute",
    "mets en sourdine le micro",
    "mets le micro en sourdine",
    "mets-toi en sourdine",
    "mets-toi en mode silencieux",
    "passe en mode silencieux",
    "active le mode silencieux",
    "mode silencieux",
  ]) {
    assert.equal(routeVoiceCommand(phrase), "mute-microphone", phrase)
  }
  assert.deepEqual(interpretVoiceText("Aven, mets le micro en sourdine"), {
    woken: true,
    command: "mute-microphone",
    demand: "",
  })
})

test("sourdine : aucun faux positif sur un autre son", () => {
  for (const phrase of ["mets la musique en sourdine", "baisse le volume", "coupe la musique"]) {
    assert.equal(routeVoiceCommand(phrase), null, phrase)
  }
})

test("une question n'est pas une commande", () => {
  assert.equal(routeVoiceCommand("comment ouvrir les notes ?"), null)
  assert.equal(routeVoiceCommand("pourquoi les paramètres sont-ils vides ?"), null)
  assert.equal(routeVoiceCommand("quelle heure est-il ?"), null)
})

test("une demande de contenu n'est pas une commande", () => {
  assert.equal(routeVoiceCommand("ouvre le fichier main.ts et corrige le bug"), null)
  assert.equal(routeVoiceCommand("explique la fonction ouvrir les notes"), null)
})

test("une phrase trop longue n'est jamais une commande", () => {
  const long = "ouvre les notes " + "et ".repeat(60) + "puis résume tout"
  assert.ok(long.length > 120)
  assert.equal(routeVoiceCommand(long), null)
})

test("interprétation : mot d'activation puis commande", () => {
  assert.deepEqual(interpretVoiceText("Aven, ouvre les notes"), {
    woken: true,
    command: "open-notes",
    demand: "",
  })
})

test("interprétation : demande libre sans commande", () => {
  assert.deepEqual(interpretVoiceText("Aven, quelle heure est-il ?"), {
    woken: true,
    command: null,
    demand: "quelle heure est-il ?",
  })
})

// v11.1.1 : le STT écrit « Avant » pour « Aven ». Une commande derrière
// l'homophone vaut réveil, même si Whisper a mangé la virgule.
// v11.1.1 : la phrase exacte signalée par l'utilisateur doit ouvrir les notes.
test("interprétation : « Aven, ouvre une note » ouvre les notes", () => {
  assert.deepEqual(interpretVoiceText("Aven, ouvre une note"), {
    woken: true,
    command: "open-notes",
    demand: "",
  })
  assert.deepEqual(interpretVoiceText("Avant, ouvre une note"), {
    woken: true,
    command: "open-notes",
    demand: "",
  })
})

test("interprétation : « Avant » suivi d'une commande réveille l'agent", () => {
  assert.deepEqual(interpretVoiceText("Avant ouvre une note"), {
    woken: true,
    command: "open-notes",
    demand: "",
  })
  assert.deepEqual(interpretVoiceText("Avent, quelle heure est-il ?"), {
    woken: true,
    command: null,
    demand: "quelle heure est-il ?",
  })
})

test("interprétation : « avant » dans une phrase ne réveille pas l'agent", () => {
  assert.deepEqual(interpretVoiceText("Avant de partir, ouvre les notes"), {
    woken: false,
    command: "open-notes",
    demand: "",
  })
})

test("interprétation : sans mot d'activation, le renderer décide", () => {
  assert.deepEqual(interpretVoiceText("ouvre les notes"), {
    woken: false,
    command: "open-notes",
    demand: "",
  })
  assert.deepEqual(interpretVoiceText(""), { woken: false, command: null, demand: "" })
})

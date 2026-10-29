import assert from "node:assert/strict"
import { test } from "node:test"
import { isBargeInPhrase, shouldInterruptSpeech } from "../web/src/voice-agent/barge-in.ts"

// v11.4.2 : une vraie reprise coupe la lecture ; la voix de l'agent ne tronque
// pas sa propre question de confirmation.
// v11.11.1 : la règle vaut pour TOUTES les lectures, et elle ne regarde plus le
// niveau du micro — il mesure la voix de l'agent reprise par les haut-parleurs.
// v11.15.0 : le bruit de la pièce ne coupe plus la réponse. La coupe n'est
// décidée que par le verdict d'adresse du host, ou par une reprise directe
// (« attends », « chut »). Ce que ces tests protègent : un écho ne coupe rien,
// jamais ; hors lecture, il n'y a rien à couper ; une parole adressée coupe ; un
// bruit non adressé laisse la réponse aller au bout.

test("une parole adressée coupe la lecture en cours", () => {
  assert.equal(shouldInterruptSpeech({ echo: false, reading: true, addressed: true }), true)
})

test("un bruit non adressé ne coupe pas la lecture", () => {
  for (const heard of ["euh", "il fait beau aujourd'hui", "bon on y va", "j'ai oublié mes clés"]) {
    assert.equal(
      shouldInterruptSpeech({ echo: false, reading: true, addressed: false, heard }),
      false,
      heard,
    )
  }
})

test("« attends » et « chut » restent des reprises même seuls", () => {
  for (const heard of ["attends", "Attends.", "attendez", "chut"]) {
    assert.equal(isBargeInPhrase(heard), true, heard)
    assert.equal(
      shouldInterruptSpeech({ echo: false, reading: true, addressed: false, heard }),
      true,
      heard,
    )
  }
  assert.equal(isBargeInPhrase("attends un instant"), false, "une phrase n'est pas le mot seul")
})

test("l'écho de la voix de l'agent ne coupe jamais rien", () => {
  assert.equal(shouldInterruptSpeech({ echo: true, reading: true, addressed: true }), false)
  assert.equal(shouldInterruptSpeech({ echo: true, reading: false, addressed: true }), false)
})

test("hors lecture, il n'y a rien à couper", () => {
  assert.equal(shouldInterruptSpeech({ echo: false, reading: false, addressed: true }), false)
  assert.equal(shouldInterruptSpeech({ echo: false, reading: false, addressed: false, heard: "attends" }), false)
})

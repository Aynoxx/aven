import assert from "node:assert/strict"
import { test } from "node:test"
import { EDGE_VOICE_OPTIONS, isNeuralVoice, voiceIdOf, voiceLabel } from "../web/src/voice-agent/voices.ts"
import { decodeBase64 } from "../web/src/voice-agent/playback.ts"

// v11.3.0 : le menu des Réglages doit montrer des libellés lisibles et retrouver
// une préférence enregistrée avant l'arrivée des préfixes (nom Windows brut).

test("identifiants : préfixe ajouté aux anciennes préférences, jamais aux nouvelles", () => {
  assert.equal(voiceIdOf("Microsoft Hortense Desktop"), "sapi:Microsoft Hortense Desktop")
  assert.equal(voiceIdOf("edge:fr-FR-DeniseNeural"), "edge:fr-FR-DeniseNeural")
  assert.equal(voiceIdOf("sapi:Microsoft Julie Desktop"), "sapi:Microsoft Julie Desktop")
  assert.equal(voiceIdOf(""), "")
  assert.equal(voiceIdOf(undefined), "")
})

test("libellés : aucun identifiant technique affiché", () => {
  assert.equal(voiceLabel("edge:fr-FR-DeniseNeural"), "Denise — française, posée")
  assert.equal(voiceLabel("sapi:Microsoft Hortense Desktop"), "Microsoft Hortense Desktop")
  assert.equal(voiceLabel("edge:fr-FR-InconnueNeural"), "fr-FR-InconnueNeural")
  assert.ok(!voiceLabel("edge:fr-FR-HenriNeural").includes("edge:"))
})

test("voix neuronales : reconnues par préfixe, le reste est local", () => {
  assert.equal(isNeuralVoice("edge:fr-FR-DeniseNeural"), true)
  assert.equal(isNeuralVoice("sapi:Microsoft Zira Desktop"), false)
  assert.equal(EDGE_VOICE_OPTIONS.every((voice) => isNeuralVoice(voice.id)), true)
  // Le catalogue du renderer est le miroir de celui du host : identifiants uniques.
  assert.equal(new Set(EDGE_VOICE_OPTIONS.map((voice) => voice.id)).size, EDGE_VOICE_OPTIONS.length)
})

test("base64 : le MP3 rendu par le host est décodé à l'identique", () => {
  const original = Uint8Array.from([0, 1, 2, 127, 128, 254, 255])
  const encoded = Buffer.from(original).toString("base64")
  assert.deepEqual([...decodeBase64(encoded)], [...original])
  assert.deepEqual([...decodeBase64("")], [])
})

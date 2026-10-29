import assert from "node:assert/strict"
import { test } from "node:test"
import { POCKET_VOICE_OPTIONS, voiceIdOf, voiceLabel } from "../web/src/voice-agent/voices.ts"
import { decodeBase64 } from "../web/src/voice-agent/playback.ts"

// v11.3.0 : le menu des Réglages doit montrer des libellés lisibles et retrouver
// une préférence enregistrée avant l'arrivée des préfixes (nom Windows brut).
// v11.14.0 : les préfixes retirés (« edge: », « piper: ») n'ont plus d'entrée au
// menu — on affiche la voix par défaut plutôt qu'un faux choix.

test("identifiants : préfixe ajouté aux anciennes préférences, jamais aux nouvelles", () => {
  assert.equal(voiceIdOf("Microsoft Hortense Desktop"), "sapi:Microsoft Hortense Desktop")
  assert.equal(voiceIdOf("sapi:Microsoft Julie Desktop"), "sapi:Microsoft Julie Desktop")
  assert.equal(voiceIdOf("pocket:fr"), "pocket:fr")
  assert.equal(voiceIdOf(""), "")
  assert.equal(voiceIdOf(undefined), "")
})

test("les préfixes retirés retombent sur la voix par défaut, jamais sur un faux choix", () => {
  assert.equal(voiceIdOf("edge:fr-FR-DeniseNeural"), "")
  assert.equal(voiceIdOf("piper:fr_FR-tom-medium"), "")
})

test("libellés : aucun identifiant technique affiché", () => {
  assert.equal(voiceLabel("pocket:fr"), "Pocket TTS — locale, voix française")
  assert.equal(voiceLabel("sapi:Microsoft Hortense Desktop"), "Microsoft Hortense Desktop")
  assert.equal(voiceLabel("pocket:clone"), "Pocket TTS — locale, voix clonée")
})

test("le catalogue Pocket est unique et couvert par les libellés", () => {
  assert.equal(new Set(POCKET_VOICE_OPTIONS.map((voice) => voice.id)).size, POCKET_VOICE_OPTIONS.length)
  for (const voice of POCKET_VOICE_OPTIONS) assert.equal(voiceLabel(voice.id), voice.label)
})

test("base64 : le WAV rendu par le host est décodé à l'identique", () => {
  const original = Uint8Array.from([0, 1, 2, 127, 128, 254, 255])
  const encoded = Buffer.from(original).toString("base64")
  assert.deepEqual([...decodeBase64(encoded)], [...original])
  assert.deepEqual([...decodeBase64("")], [])
})

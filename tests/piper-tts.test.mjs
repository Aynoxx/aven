// v11.5.0 : la voix locale Piper remplace Hortense. Ce que ces tests protègent :
// le chemin Piper reçoit bien le texte nettoyé, rend un WAV, et n'écrit jamais
// de fichier permanent. Aucun processus réel n'est lancé : le lanceur est injecté.
import assert from "node:assert/strict"
import test from "node:test"
import path from "node:path"
import { PIPER_LENGTH_SCALE, PIPER_VOICE_ID, piperArgs, piperLayout, synthesizePiperSpeech } from "../host/piper-tts.ts"

test("l'emplacement du binaire et du modèle est déduit du dossier fourni", () => {
  const layout = piperLayout("C:\\Aven\\piper")
  assert.equal(layout.binary, path.join("C:\\Aven\\piper", "piper", "piper.exe"))
  assert.equal(layout.model, path.join("C:\\Aven\\piper", "voices", "fr_FR-siwis-medium.onnx"))
})

test("une autre voix se demande par son nom", () => {
  const layout = piperLayout("/tmp/piper", "fr_FR-upmc-medium")
  assert.match(layout.model, /fr_FR-upmc-medium\.onnx$/)
})

test("la synthèse rend les octets du lanceur, sans les transformer", async () => {
  const audio = new Uint8Array([1, 2, 3, 4])
  let seen = null
  const out = await synthesizePiperSpeech("Bonjour Aveun.", {
    dir: "/tmp/piper",
    run: async (layout, text) => {
      seen = { layout, text }
      return audio
    },
  })
  assert.equal(out, audio)
  assert.equal(seen.text, "Bonjour Aveun.")
  assert.match(seen.layout.model, /fr_FR-siwis-medium\.onnx$/)
})

test("un texte vide ne lance aucun processus", async () => {
  let called = 0
  await assert.rejects(
    synthesizePiperSpeech("   ", {
      dir: "/tmp/piper",
      run: async () => {
        called++
        return new Uint8Array([1])
      },
    }),
    /Aucun texte à prononcer/,
  )
  assert.equal(called, 0)
})

test("un audio vide est une erreur lisible, pas un silence", async () => {
  await assert.rejects(
    synthesizePiperSpeech("Bonjour.", { dir: "/tmp/piper", run: async () => new Uint8Array() }),
    /n'a produit aucun audio/,
  )
})

test("l'identifiant de préférence est préfixé comme les autres moteurs", () => {
  assert.equal(PIPER_VOICE_ID, "piper:fr_FR-siwis-medium")
})

// v11.5.1 : siwis parlait 44 % plus vite que Denise à texte égal. La parité
// mesurée (1,44) a été écoutée puis REJETÉE, trop lente ; le réglage retenu est
// 1,10. Le débit se règle par `length_scale`, un argument du binaire — donc
// testable sans lancer Piper, et jamais laissé à la valeur du modèle (1,0).
test("le débit par défaut reste proche de celui du modèle", () => {
  assert.equal(PIPER_LENGTH_SCALE, 1.1)
  const args = piperArgs({ binary: "piper.exe", model: "siwis.onnx" }, "out.wav")
  assert.deepEqual(args, ["--model", "siwis.onnx", "--output_file", "out.wav", "--length_scale", "1.1"])
})

test("une prosodie explicite remplace le débit par défaut", () => {
  const args = piperArgs({ binary: "piper.exe", model: "siwis.onnx" }, "out.wav", {
    lengthScale: 1.2,
    noiseScale: 0.5,
    noiseW: 1.0,
  })
  assert.deepEqual(args.slice(4), ["--length_scale", "1.2", "--noise_scale", "0.5", "--noise_w", "1"])
})

test("la synthèse transmet les réglages au lanceur", async () => {
  let seen = null
  await synthesizePiperSpeech("Bonjour.", {
    dir: "/tmp/piper",
    speech: { noiseW: 1.1 },
    run: async (_layout, _text, speech) => {
      seen = speech
      return new Uint8Array([1])
    },
  })
  assert.deepEqual(seen, { noiseW: 1.1 })
})

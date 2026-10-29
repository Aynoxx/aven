// v11.14.0 : le routage vocal ne connaît plus que Pocket TTS et la voix Windows.
// Ce que ces tests protègent : un préfixe retiré (« edge: », « piper: ») ne
// fabrique JAMAIS un nom de voix Windows inconnu — il retombe sur la voix par
// défaut — et la préférence vide parle toujours (jamais un agent muet).
import assert from "node:assert/strict"
import test from "node:test"
import { resolveVoiceRoute } from "../host/voice-route.ts"

test("la voix Pocket TTS est routée vers le moteur local", () => {
  assert.deepEqual(resolveVoiceRoute({ voiceName: "pocket:fr" }), { kind: "pocket", voice: "fr" })
  assert.deepEqual(resolveVoiceRoute({ voiceName: "pocket:clone" }), { kind: "pocket", voice: "clone" })
})

test("une voix Windows explicite reste locale", () => {
  assert.deepEqual(resolveVoiceRoute({ voiceName: "sapi:Microsoft Hortense Desktop" }), {
    kind: "sapi",
    voice: "Microsoft Hortense Desktop",
  })
})

test("une préférence vide parle avec la voix Windows par défaut", () => {
  assert.deepEqual(resolveVoiceRoute({ voiceName: "" }), { kind: "sapi", voice: "" })
  assert.deepEqual(resolveVoiceRoute({ voiceName: "   " }), { kind: "sapi", voice: "" })
  assert.deepEqual(resolveVoiceRoute({}), { kind: "sapi", voice: "" })
})

test("les préfixes retirés (edge, piper) retombent sur la voix par défaut", () => {
  assert.deepEqual(resolveVoiceRoute({ voiceName: "edge:fr-FR-DeniseNeural" }), { kind: "sapi", voice: "" })
  assert.deepEqual(resolveVoiceRoute({ voiceName: "piper:fr_FR-tom-medium" }), { kind: "sapi", voice: "" })
})

test("une préférence v11.1.0 (nom Windows brut) est toujours lisible", () => {
  assert.deepEqual(resolveVoiceRoute({ voiceName: "Microsoft Hortense Desktop" }), {
    kind: "sapi",
    voice: "Microsoft Hortense Desktop",
  })
})

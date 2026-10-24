import assert from "node:assert/strict"
import { test } from "node:test"
import {
  DEFAULT_EDGE_VOICE,
  EDGE_COOLDOWN_MS,
  EDGE_QUOTA_MESSAGE,
  EDGE_VOICE_IDS,
  EDGE_TRUSTED_TOKEN,
  describeEdgeFailure,
  edgeCooldownActive,
  edgeSpeechToken,
  edgeVoiceName,
  escapeSsml,
  isEdgeRateLimit,
  isEdgeVoice,
  resolveVoiceRoute,
} from "../host/voice-agent-edge.ts"

// v11.3.0 : la voix neuronale passe par le service d'Edge — gratuit, sans compte,
// mais non contractuel. Les tests figent la décision de voix (préfixes, préférence
// héritée) et la reconnaissance d'une limite de débit, qui déclenche le repli.

test("routage : préfixes, défaut neuronal, préférence héritée", () => {
  assert.deepEqual(resolveVoiceRoute({ voiceName: "edge:fr-FR-HenriNeural" }), {
    kind: "edge", voice: "fr-FR-HenriNeural",
  })
  assert.deepEqual(resolveVoiceRoute({ voiceName: "sapi:Microsoft Julie Desktop" }), {
    kind: "sapi", voice: "Microsoft Julie Desktop",
  })
  assert.deepEqual(resolveVoiceRoute({ voiceName: "Microsoft Hortense Desktop" }), {
    kind: "sapi", voice: "Microsoft Hortense Desktop",
  })
  // v11.5.0 : la voix locale Piper est une route à part entière, jamais un repli
  // silencieux de la voix neuronale.
  assert.deepEqual(resolveVoiceRoute({ voiceName: "piper:fr_FR-siwis-medium" }), {
    kind: "piper", voice: "fr_FR-siwis-medium",
  })
  // Aucune préférence : la voix de meilleure qualité, sans réglage.
  assert.deepEqual(resolveVoiceRoute({ voiceName: "" }), { kind: "edge", voice: "fr-FR-DeniseNeural" })
  assert.deepEqual(resolveVoiceRoute({ voiceName: "   " }), { kind: "edge", voice: "fr-FR-DeniseNeural" })
})

test("identifiants : le préfixe ne fuit jamais dans le nom de voix", () => {
  assert.equal(edgeVoiceName("edge:fr-FR-DeniseNeural"), "fr-FR-DeniseNeural")
  assert.equal(edgeVoiceName("fr-FR-DeniseNeural"), "fr-FR-DeniseNeural")
  assert.equal(isEdgeVoice("edge:fr-FR-DeniseNeural"), true)
  assert.equal(isEdgeVoice("sapi:Microsoft Zira Desktop"), false)
  assert.ok(EDGE_VOICE_IDS.includes(DEFAULT_EDGE_VOICE))
  assert.equal(new Set(EDGE_VOICE_IDS).size, EDGE_VOICE_IDS.length)
})

// v11.3.0 : le jeton du service n'est pas recopié depuis une bibliothèque : il est
// calculé à partir de l'horloge. La valeur attendue a été produite indépendamment
// par `sha256sum`, pas par ce module — sinon le test ne prouverait rien.
test("jeton du service : horodatage Windows, fenêtre de cinq minutes", () => {
  const at = 1_761_200_000_000
  assert.equal(edgeSpeechToken(at), "E0E42C58A834A342434991C2396E0905B0E4487C7ABC71EA6AE738DBE594EA4C")
  // La fenêtre courante se termine à 1761200100 s : +60 s reste dedans, +300 s non.
  assert.equal(edgeSpeechToken(at + 60_000), edgeSpeechToken(at))
  assert.notEqual(edgeSpeechToken(at + 300_000), edgeSpeechToken(at))
  assert.match(edgeSpeechToken(at), /^[0-9A-F]{64}$/)
  assert.equal(EDGE_TRUSTED_TOKEN.length, 32, "la constante publique du client Edge")
})

test("SSML : les caractères réservés ne cassent pas la demande de synthèse", () => {
  assert.equal(escapeSsml("R&D <test> \"ok\" l'agent"), "R&amp;D &lt;test&gt; &quot;ok&quot; l&apos;agent")
})

test("limite de débit et échecs : messages lisibles, jamais un code nu", () => {
  assert.equal(isEdgeRateLimit(new Error("Edge TTS WebSocket error: Unexpected server response: 429")), true)
  assert.equal(isEdgeRateLimit(new Error("429 Too Many Requests")), true)
  assert.equal(isEdgeRateLimit(new Error("ECONNRESET")), false)
  assert.equal(describeEdgeFailure(new Error("429")), EDGE_QUOTA_MESSAGE)
  assert.match(describeEdgeFailure(new Error("Unexpected server response: 500")), /500/)
  // Le service nomme la voix refusée : le message le dit en français, sans jargon.
  assert.equal(
    describeEdgeFailure(new Error("Unsupported voice fr-FR-InconnueNeural.")),
    "Le service vocal Edge ne connaît pas la voix « fr-FR-InconnueNeural ».",
  )
  // Un échec sans message ne produit jamais une chaîne vide.
  assert.ok(describeEdgeFailure(undefined).length > 10)
})

// v11.4.3 : après un 429, insister à chaque phrase entretient la limite. Le
// service est laissé tranquille une minute, puis redevient la voix par défaut.
test("blocage après 429 : une minute, puis retour au service", () => {
  const now = 1_000_000
  assert.equal(edgeCooldownActive(now + EDGE_COOLDOWN_MS, now), true)
  assert.equal(edgeCooldownActive(now + EDGE_COOLDOWN_MS - 1, now), true)
  assert.equal(edgeCooldownActive(now, now), false)
  assert.equal(edgeCooldownActive(0, now), false, "aucun blocage au démarrage")
  assert.equal(EDGE_COOLDOWN_MS, 60_000)
})

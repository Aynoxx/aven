import assert from "node:assert/strict"
import { test } from "node:test"
import {
  AWAKE_IDLE_MS,
  initialVoiceSession,
  isAwake,
  reduceVoiceSession,
  voiceStatusLabel,
} from "../web/src/voice-agent/session.ts"

// v11.1.0 : l'interruption et l'anti-mélange de demandes vivent dans une
// machine à états pure — testable sans micro, sans TTS, sans Tauri.
// v11.12.0 : la veille (mode éveillé) aussi.

test("état initial : écoute, ou micro coupé si la préférence le dit", () => {
  assert.equal(initialVoiceSession(false).phase, "listening")
  assert.equal(initialVoiceSession(true).phase, "muted")
})

test("couper le micro arrête la lecture et invalide la demande en cours", () => {
  let state = { ...initialVoiceSession(false), phase: "speaking", requestId: 4, awakeUntil: 9_999 }
  state = reduceVoiceSession(state, { type: "mic", muted: true })
  assert.equal(state.phase, "muted")
  assert.equal(state.requestId, 5)
  assert.equal(isAwake(state, Date.now()), false, "micro coupé : la veille est terminée")
})

test("découper la micro ouvre l'écoute", () => {
  let state = initialVoiceSession(true)
  state = reduceVoiceSession(state, { type: "mic", muted: false })
  assert.equal(state.phase, "listening")
  assert.equal(state.micMuted, false)
})

test("parole détectée puis terminée : capture puis transcription", () => {
  let state = initialVoiceSession(false)
  state = reduceVoiceSession(state, { type: "speech-start" })
  assert.equal(state.phase, "capturing")
  state = reduceVoiceSession(state, { type: "speech-end" })
  assert.equal(state.phase, "transcribing")
})

test("reprendre la parole pendant la lecture interrompt la réponse", () => {
  let state = initialVoiceSession(false)
  state = reduceVoiceSession(state, { type: "thinking", requestId: 2 }, 0)
  const before = state.requestId
  state = reduceVoiceSession(state, { type: "speech-start" }, 100)
  assert.equal(state.phase, "capturing")
  assert.equal(state.requestId, before + 1)
})

// v11.11.1 : pendant une LECTURE, la parole détectée vient d'abord de la voix de
// l'agent reprise par le micro. La requête ne doit donc PAS changer : la changer
// annulait le lecteur au retour de la synthèse, et la fin de la réponse
// disparaissait sans que personne ait parlé.
test("parole détectée pendant une lecture : la réponse garde sa requête", () => {
  let state = { ...initialVoiceSession(false), phase: "speaking", requestId: 5, reply: "une réponse" }
  state = reduceVoiceSession(state, { type: "speech-start" }, 100)
  assert.equal(state.phase, "capturing")
  assert.equal(state.requestId, 5, "la lecture en cours n'est pas invalidée")
})

// v11.11.1 : l'écho de la voix de l'agent ne fait RIEN à la session — il ne
// coupait pas seulement la lecture, il changeait sa requête et le lecteur était
// annulé au retour de la synthèse.
test("un écho ne change rien : la lecture reste annoncée", () => {
  let state = { ...initialVoiceSession(false), phase: "speaking", requestId: 5, reply: "une réponse" }
  state = reduceVoiceSession(state, { type: "speech-start" }, 10)
  state = reduceVoiceSession(state, { type: "speech-end" }, 20)
  state = reduceVoiceSession(state, { type: "ignored", reading: true }, 30)
  assert.equal(state.phase, "speaking")
  assert.equal(state.requestId, 5)
  const after = reduceVoiceSession(state, { type: "ignored", reading: false }, 40)
  assert.equal(after.phase, "listening", "sans lecture en cours, on revient à l'écoute")
})

// v11.15.2 : la fin de lecture écrasait la phase d'une capture commencée pendant
// la réponse (voix de l'agent reprise par le micro, ou vraie reprise de parole).
// L'enregistreur restait ouvert sans phase « capturing » : son speech-end était
// ignoré, la réponse suivante n'était jamais transcrite et l'agent semblait ne
// plus se rappeler la question qu'il venait de poser.
test("la fin de lecture ne referme pas une capture en cours", () => {
  let state = { ...initialVoiceSession(false), phase: "speaking", requestId: 5, reply: "une réponse" }
  state = reduceVoiceSession(state, { type: "speech-start" }, 100)
  assert.equal(state.phase, "capturing")
  state = reduceVoiceSession(state, { type: "done" }, 200)
  assert.equal(state.phase, "capturing", "la capture garde sa phase après la lecture")
  state = reduceVoiceSession(state, { type: "speech-end" }, 300)
  assert.equal(state.phase, "transcribing", "le speech-end arrête bien l'enregistreur")
})

test("la fin de lecture rend la main quand rien n'est capturé", () => {
  let state = { ...initialVoiceSession(false), phase: "speaking", requestId: 5, reply: "une réponse" }
  state = reduceVoiceSession(state, { type: "done" }, 200)
  assert.equal(state.phase, "listening")
})

test("une réponse d'une demande périmée ne prend jamais la parole", () => {
  let state = initialVoiceSession(false)
  state = reduceVoiceSession(state, { type: "thinking", requestId: 3 }, 0)
  const stale = reduceVoiceSession(state, { type: "speaking", requestId: 2, reply: "vieille réponse" }, 10)
  assert.equal(stale.phase, "thinking")
  const fresh = reduceVoiceSession(state, { type: "speaking", requestId: 3, reply: "bonne réponse" }, 10)
  assert.equal(fresh.phase, "speaking")
  assert.equal(fresh.reply, "bonne réponse")
})

// ── v11.12.0 : le mode éveillé ───────────────────────────────────────────────
// La fenêtre de suivi de dix secondes ne servait à rien : `speech-start` la
// remettait à zéro au moment même de la capture, donc la transcription qui
// suivait la trouvait fermée. Le défaut est ici figé dans un test.
test("le mot d'activation ouvre la veille, et la capture de la parole ne la ferme pas", () => {
  let state = initialVoiceSession(false)
  assert.equal(isAwake(state, 1_000), false, "sans mot d'activation, rien n'est adressé")
  state = reduceVoiceSession(state, { type: "wake" }, 1_000)
  assert.equal(isAwake(state, 1_000 + AWAKE_IDLE_MS - 1), true)
  assert.equal(isAwake(state, 1_000 + AWAKE_IDLE_MS), false, "la veille expire au silence")
  // Le défaut d'origine : la parole capturée fermait la veille avant sa transcription.
  const capturing = reduceVoiceSession(state, { type: "speech-start" }, 1_500)
  assert.equal(capturing.phase, "capturing")
  assert.equal(isAwake(capturing, 2_000), true, "la parole en cours ne referme pas la veille")
  const transcribing = reduceVoiceSession(capturing, { type: "speech-end" }, 2_500)
  assert.equal(isAwake(transcribing, 2_600), true, "la transcription est encore adressée")
})

test("chaque parole adressée prolonge la veille", () => {
  let state = reduceVoiceSession(initialVoiceSession(false), { type: "wake" }, 1_000)
  state = reduceVoiceSession(state, { type: "wake" }, 40_000)
  assert.equal(state.awakeUntil, 40_000 + AWAKE_IDLE_MS)
})

test("trois sorties seulement : le repos, le silence, le micro coupé", () => {
  const awake = () => reduceVoiceSession(initialVoiceSession(false), { type: "wake" }, 1_000)
  // 1. ordre de repos explicite.
  assert.equal(isAwake(reduceVoiceSession(awake(), { type: "sleep" }, 2_000), 2_000), false)
  // 2. silence : l'échéance suffit.
  assert.equal(isAwake(awake(), 1_000 + AWAKE_IDLE_MS), false)
  // 3. micro coupé (et l'erreur, qui interrompt tout).
  assert.equal(isAwake(reduceVoiceSession(awake(), { type: "mic", muted: true }, 2_000), 2_000), false)
  assert.equal(isAwake(reduceVoiceSession(awake(), { type: "error", message: "x" }, 2_000), 2_000), false)
  // Interrompre la lecture ne rendort PAS : on reprend la parole pour parler.
  const interrupted = reduceVoiceSession(awake(), { type: "interrupt" }, 2_000)
  assert.equal(isAwake(interrupted, 2_000), true)
  // Et la fin de lecture ne la prolonge pas non plus (un écho ne fait pas vivre la veille).
  const done = reduceVoiceSession(awake(), { type: "done" }, 30_000)
  assert.equal(done.awakeUntil, 1_000 + AWAKE_IDLE_MS)
})

test("l'état se dit : « Éveillé » remplace « Écoute », et redevient « Écoute » après", () => {
  const awake = reduceVoiceSession(initialVoiceSession(false), { type: "wake" }, 1_000)
  assert.equal(voiceStatusLabel(awake, 2_000), "Éveillé")
  assert.equal(voiceStatusLabel(awake, 1_000 + AWAKE_IDLE_MS), "Écoute")
  // La veille ne masque jamais l'état réel : une lecture reste « Lecture ».
  const speaking = { ...awake, phase: "speaking" }
  assert.equal(voiceStatusLabel(speaking, 2_000), "Lecture")
  assert.equal(voiceStatusLabel(initialVoiceSession(true), 2_000), "Micro coupé")
})

test("une transcription vide ramène à l'écoute sans réponse", () => {
  let state = { ...initialVoiceSession(false), phase: "transcribing", heard: "ancien" }
  state = reduceVoiceSession(state, { type: "heard", text: "   " })
  assert.equal(state.phase, "listening")
  assert.equal(state.heard, undefined)
})

test("erreur lisible puis reprise par interruption", () => {
  let state = initialVoiceSession(false)
  state = reduceVoiceSession(state, { type: "error", message: "Quota gratuit Groq atteint." })
  assert.equal(state.phase, "error")
  assert.match(state.error ?? "", /Quota gratuit/)
  state = reduceVoiceSession(state, { type: "interrupt" })
  assert.equal(state.phase, "listening")
  assert.equal(state.error, undefined)
})

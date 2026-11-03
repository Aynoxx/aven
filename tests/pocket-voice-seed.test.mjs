// v12.9.0 : un profil de voix peut être fourni avec un installeur local. Ces
// tests protègent la décision pure : on ne remplace jamais un profil existant,
// on ne fait pas revenir un profil retiré, et on ne pose rien sans profil fourni.
import assert from "node:assert/strict"
import test from "node:test"
import path from "node:path"
import {
  POCKET_BUNDLED_CONSENT_FILE,
  POCKET_SEED_MARKER_FILE,
  pocketBundledProfile,
  pocketSeedDecision,
  pocketVoiceSeedMarker,
} from "../host/pocket-tts.ts"

test("le profil embarqué est cherché à côté du moteur", () => {
  assert.equal(pocketBundledProfile("C:\\Aven\\pocket-tts", () => false), null)
  assert.equal(
    pocketBundledProfile("C:\\Aven\\pocket-tts", (file) => file.endsWith("aven.safetensors")),
    path.join("C:\\Aven\\pocket-tts", "voices", "aven.safetensors"),
  )
})

test("l'attestation et le marqueur ont des noms stables", () => {
  assert.equal(POCKET_BUNDLED_CONSENT_FILE, "voice-consent.json")
  assert.equal(POCKET_SEED_MARKER_FILE, "seed.json")
})

test("le marqueur de pose vit dans les données de l'app", () => {
  assert.equal(
    pocketVoiceSeedMarker("C:\\Aven"),
    path.join("C:\\Aven", "pocket-tts", "voices", "seed.json"),
  )
})

test("un profil installé n'est jamais écrasé", () => {
  assert.equal(pocketSeedDecision({ bundled: true, installed: true, removed: false }), "keep")
  assert.equal(pocketSeedDecision({ bundled: true, installed: true, removed: true }), "keep")
})

test("un retrait volontaire empêche le retour du profil fourni", () => {
  assert.equal(pocketSeedDecision({ bundled: true, installed: false, removed: true }), "skip-removed")
})

test("le profil fourni est posé seulement quand rien n'existe", () => {
  assert.equal(pocketSeedDecision({ bundled: true, installed: false, removed: false }), "seed")
  assert.equal(pocketSeedDecision({ bundled: false, installed: false, removed: false }), "none")
  assert.equal(pocketSeedDecision({ bundled: false, installed: true, removed: false }), "none")
})

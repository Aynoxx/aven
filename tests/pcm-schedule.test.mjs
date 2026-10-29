// v11.10.0 : ce que ces tests protègent dans la lecture du flux PCM — le
// démarrage ne se fait jamais dans le passé (deux paquets ne se chevauchent
// pas), un paquet impair ne perd pas d'octet, et une réponse courte n'attend pas
// un volume qu'elle n'atteindra jamais. Aucun navigateur n'est requis.
import assert from "node:assert/strict"
import test from "node:test"
import {
  PCM_MIN_BUFFER_MS,
  PCM_SAMPLE_RATE,
  PCM_START_DELAY_S,
  pcmChunkPlan,
  pcmSamples,
  pcmSeconds,
  shouldStartPlayback,
} from "../web/src/voice-agent/pcm-schedule.ts"

test("les paquets s'enchaînent sans trou", () => {
  // Premier paquet : le curseur est à zéro, l'horloge à 10 s.
  const first = pcmChunkPlan(0, 10, 0.55)
  assert.equal(first.startAt, 10 + PCM_START_DELAY_S)
  assert.equal(first.gap, 0)
  // Second paquet : il suit exactement le premier, sans repasser par startDelay.
  const second = pcmChunkPlan(first.cursor, 10.1, 0.55)
  assert.equal(second.startAt, first.cursor)
  assert.equal(second.cursor, first.cursor + 0.55)
  assert.equal(second.gap, 0)
})

test("un paquet en retard repart de maintenant, sans chevaucher le précédent", () => {
  // Le curseur (audio programmé) est à 5 s, l'horloge est déjà à 7 s.
  const plan = pcmChunkPlan(5, 7, 0.55)
  assert.equal(plan.startAt, 7 + PCM_START_DELAY_S)
  assert.equal(plan.gap, 2 + PCM_START_DELAY_S)
  assert.ok(plan.startAt > 7, "jamais programmé dans le passé")
  assert.equal(plan.cursor, plan.startAt + 0.55)
})

test("une file d'attente vide ne produit aucun retard signalé", () => {
  const plan = pcmChunkPlan(0, 0, 0.55)
  assert.equal(plan.startAt, PCM_START_DELAY_S)
  assert.equal(plan.gap, 0)
})

test("un octet orphelin est reporté sur le paquet suivant", () => {
  // 3 octets = un échantillon (0x0001) + la moitié du suivant (0x02).
  const first = pcmSamples(new Uint8Array([1, 0, 2]))
  assert.equal(first.samples.length, 1)
  assert.equal(first.samples[0], 1)
  assert.deepEqual([...first.carry], [2])
  // Le paquet suivant commence par 0x00 : l'échantillon vaut 2, pas 512.
  const second = pcmSamples(new Uint8Array([0, 3, 0]), first.carry)
  assert.equal(second.samples.length, 2)
  assert.equal(second.samples[0], 2)
  assert.equal(second.samples[1], 3)
  assert.equal(second.carry.length, 0)
})

test("les échantillons signés sont lus tels quels, en petit-boutiste", () => {
  const { samples } = pcmSamples(new Uint8Array([0xff, 0xff, 0x00, 0x80, 0x00, 0x00]))
  assert.equal(samples.length, 3)
  assert.equal(samples[0], -1)
  assert.equal(samples[1], -32768)
  assert.equal(samples[2], 0)
})

test("la durée d'un lot se déduit de la fréquence du moteur", () => {
  assert.equal(PCM_SAMPLE_RATE, 24000)
  assert.equal(pcmSeconds(24000), 1)
  assert.equal(pcmSeconds(12000), 0.5)
  assert.equal(pcmSeconds(0), 0)
})

test("la lecture démarre sur un flux terminé, même sans volume d'avance", () => {
  assert.equal(shouldStartPlayback(0, true), true)
  assert.equal(shouldStartPlayback(0, false), false)
  assert.equal(shouldStartPlayback(PCM_MIN_BUFFER_MS - 1, false), false)
  assert.equal(shouldStartPlayback(PCM_MIN_BUFFER_MS, false), true)
  assert.equal(shouldStartPlayback(3000, false), true)
})

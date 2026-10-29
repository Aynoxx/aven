// v11.10.0 : la mise en forme du PCM local (niveau, silences) est une décision
// pure, donc testée ici, sans AudioContext ni moteur. Ce que ces tests protègent :
// le silence de tête et de queue disparaît, une pause courte traverse intacte, une
// pause trop longue est ramenée au rythme d'Edge, et un paquet coupé au milieu d'un
// échantillon ne décale rien (le défaut le plus vicieux d'un flux 16 bits).
import assert from "node:assert/strict"
import test from "node:test"
import {
  PCM_LEVEL_GAIN_DB,
  PCM_PAUSE_MAX_MS,
  PCM_PAUSE_TARGET_MS,
  PCM_SILENCE_THRESHOLD,
  PCM_TRIM_MARGIN_MS,
  applyPcmGain,
  createPcmShaper,
  shapePcm,
} from "../host/pcm-audio.ts"

const RATE = 24000
const frameMs = 10
/** Convertit des millisecondes en échantillons. */
const at = (value) => Math.round((value / 1000) * RATE)

function silence(ms) {
  return new Int16Array(at(ms))
}

function tone(ms, amplitude = 9000) {
  const samples = new Int16Array(at(ms))
  for (let index = 0; index < samples.length; index++) {
    // Onde carrée : son énergie est franche, ce qui rend la détection binaire.
    samples[index] = index % 2 ? amplitude : -amplitude
  }
  return samples
}

function concat(segments) {
  const total = segments.reduce((sum, segment) => sum + segment.length, 0)
  const out = new Int16Array(total)
  let offset = 0
  for (const segment of segments) {
    out.set(segment, offset)
    offset += segment.length
  }
  return out
}

function toBytes(samples) {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < samples.length; index++) view.setInt16(index * 2, samples[index], true)
  return bytes
}

function toSamples(bytes) {
  const samples = new Int16Array(Math.floor(bytes.length / 2))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length - (bytes.length % 2))
  for (let index = 0; index < samples.length; index++) samples[index] = view.getInt16(index * 2, true)
  return samples
}

/** Durée en millisecondes d'un signal, silence de tête et de queue compris. */
const durationMs = (samples) => (samples.length / RATE) * 1000

/** Vrai si l'échantillon porte du son. */
const voiced = (value) => Math.abs(value) > PCM_SILENCE_THRESHOLD

function headSilenceMs(samples) {
  let count = 0
  while (count < samples.length && !voiced(samples[count])) count++
  return (count / RATE) * 1000
}

function tailSilenceMs(samples) {
  let count = 0
  while (count < samples.length && !voiced(samples[samples.length - 1 - count])) count++
  return (count / RATE) * 1000
}

function longestPauseMs(samples) {
  let longest = 0
  let current = 0
  for (const value of samples) {
    current = voiced(value) ? 0 : current + 1
    longest = Math.max(longest, current)
  }
  return (longest / RATE) * 1000
}

test("le gain est appliqué et saturé, jamais replié de signe", () => {
  const samples = new Int16Array([100, -20000, 32767, -32768])
  applyPcmGain(samples, 6)
  assert.equal(samples[0], 200)
  // Sans saturation, −39900 deviendrait un grand positif : un craquement.
  assert.equal(samples[1], -32768)
  assert.equal(samples[2], 32767)
  assert.equal(samples[3], -32768)
})

test("un gain nul ne touche pas les échantillons", () => {
  const samples = new Int16Array([1, -2, 3])
  applyPcmGain(samples, 0)
  assert.deepEqual([...samples], [1, -2, 3])
})

test("le silence de tête est jeté, la marge d'attaque conservée", () => {
  const shaper = createPcmShaper({ sampleRate: RATE })
  const pieces = [shaper.push(toBytes(concat([silence(300), tone(200)]))), shaper.end()]
  const out = concat(pieces.map((piece) => toSamples(piece)))
  const head = headSilenceMs(out)
  assert.ok(head <= PCM_TRIM_MARGIN_MS + frameMs, `silence de tête rogné (${head} ms)`)
  assert.ok(head >= 0)
  // La parole est intacte : 200 ms de son, à une trame près.
  assert.ok(Math.abs(durationMs(out) - head - 200) <= frameMs + 1, `durée utile conservée (${durationMs(out)} ms)`)
})

test("le silence de queue est jeté", () => {
  const out = toSamples(shapePcm(toBytes(concat([tone(200), silence(600)])), { sampleRate: RATE }))
  assert.ok(tailSilenceMs(out) <= frameMs, `queue rognée (${tailSilenceMs(out)} ms)`)
  assert.ok(Math.abs(durationMs(out) - 200) <= 2 * frameMs, `durée proche du son (${durationMs(out)} ms)`)
})

test("une pause interne courte traverse intacte", () => {
  const out = toSamples(shapePcm(toBytes(concat([tone(100), silence(300), tone(100)])), { sampleRate: RATE }))
  assert.ok(Math.abs(longestPauseMs(out) - 300) <= frameMs, `pause conservée (${longestPauseMs(out)} ms)`)
  assert.ok(Math.abs(durationMs(out) - 500) <= 2 * frameMs, `durée conservée (${durationMs(out)} ms)`)
})

test("une pause trop longue est ramenée au rythme d'Edge", () => {
  const out = toSamples(shapePcm(toBytes(concat([tone(100), silence(1000), tone(100)])), { sampleRate: RATE }))
  const pause = longestPauseMs(out)
  assert.ok(Math.abs(pause - PCM_PAUSE_TARGET_MS) <= frameMs, `pause ramenée à ${pause} ms`)
  assert.ok(pause < 1000, "la pause mesurée ne reste pas à sa longueur d'origine")
})

test("un paquet coupé au milieu d'un échantillon ne décale rien", () => {
  const source = toBytes(concat([silence(120), tone(80), silence(500), tone(60)]))
  const whole = shapePcm(source, { sampleRate: RATE })
  const shaper = createPcmShaper({ sampleRate: RATE })
  // Coupure impaire : les octets ne tombent pas sur une frontière d'échantillon.
  const first = shaper.push(source.subarray(0, 333))
  const second = shaper.push(source.subarray(333, 1000))
  const third = shaper.push(source.subarray(1000))
  const tail = shaper.end()
  const pieces = concat([first, second, third, tail])
  assert.deepEqual([...pieces], [...whole])
})

test("le résultat ne dépend pas du découpage des paquets", () => {
  const source = toBytes(concat([tone(150), silence(900), tone(150)]))
  const whole = shapePcm(source, { sampleRate: RATE })
  const shaper = createPcmShaper({ sampleRate: RATE })
  const parts = []
  for (let at = 0; at < source.length; at += 1000) {
    parts.push(shaper.push(source.subarray(at, Math.min(source.length, at + 1000))))
  }
  parts.push(shaper.end())
  assert.deepEqual([...concat(parts)], [...whole])
})

test("un flux entièrement silencieux ne livre rien du tout", () => {
  const shaper = createPcmShaper({ sampleRate: RATE })
  assert.equal(shaper.push(toBytes(silence(700))).length, 0)
  assert.equal(shaper.end().length, 0)
  assert.equal(shapePcm(toBytes(silence(300)), { sampleRate: RATE }).length, 0)
})

test("le gain de la voix clonée et les seuils viennent des mesures d'Edge", () => {
  // Le profil cloné sort 2,4 dB sous Piper Tom (trames voisées, même phrase) :
  // +2,5 le place à 0,1 dB de Tom.
  assert.equal(PCM_LEVEL_GAIN_DB, 2.5)
  // Mêmes valeurs que trim.ts et pause.ts : deux voix, une seule règle.
  assert.equal(PCM_TRIM_MARGIN_MS, 40)
  assert.equal(PCM_PAUSE_MAX_MS, 650)
  assert.equal(PCM_PAUSE_TARGET_MS, 420)
  assert.equal(PCM_SILENCE_THRESHOLD, 65)
})

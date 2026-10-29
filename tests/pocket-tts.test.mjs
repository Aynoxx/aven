// v11.10.0 : la voix Pocket TTS est locale et en flux. Ce que ces tests
// protègent : le langage français est TOUJOURS demandé (le défaut du binaire est
// l'anglais), le cache du modèle vit dans l'application, l'en-tête du flux WAV
// est retrouvé même coupé en deux morceaux, et l'attente de démarrage rend la
// main au lieu de boucler. Aucun processus n'est lancé, aucune requête n'est faite.
import assert from "node:assert/strict"
import test from "node:test"
import path from "node:path"
import {
  POCKET_CLONE_TERMS_URL,
  POCKET_CLONE_VOICE_ID,
  POCKET_LANGUAGE,
  POCKET_PCM_MIME,
  POCKET_SAMPLE_RATE,
  POCKET_VOICE_ID,
  isPocketVoice,
  normalizePocketPreference,
  pocketCloneBlockedReason,
  pocketClonePaths,
  pocketCloneProfile,
  pocketCloneRepoDir,
  pocketCloneWeightsPresent,
  pocketExportArgs,
  pocketExportEnv,
  profileTensorCount,
  pocketHealthUrl,
  pocketInstalled,
  pocketLayout,
  pocketModelDir,
  pocketServerArgs,
  pocketVoiceId,
  pocketVoicesDir,
  pocketServerEnv,
  pocketSpeechUrl,
  pocketUnavailableReason,
  pocketVoiceName,
  streamKindForVoice,
  waitForPocketReady,
  wavDataOffset,
  wrapPcmAsWav,
} from "../host/pocket-tts.ts"

/**
 * WAV standard (bloc `fmt` de 16 octets), avec possibilité d'insérer un bloc
 * avant les données — c'est le cas qu'un « 44 octets » supposé en dur rate.
 * L'en-tête correspond à ce que le serveur envoie : 24 kHz, mono, 16 bits.
 */
function wav(pcm, { extra = null } = {}) {
  const fmt = Buffer.alloc(24)
  fmt.write("fmt ", 0, "ascii")
  fmt.writeUInt32LE(16, 4)
  fmt.writeUInt16LE(1, 8)
  fmt.writeUInt16LE(1, 10)
  fmt.writeUInt32LE(24000, 12)
  fmt.writeUInt32LE(48000, 16)
  fmt.writeUInt16LE(2, 20)
  fmt.writeUInt16LE(16, 22)
  const parts = [fmt]
  let extraBytes = 0
  if (extra) {
    const pad = extra.size % 2
    const block = Buffer.alloc(8 + extra.size + pad)
    block.write(extra.id, 0, "ascii")
    block.writeUInt32LE(extra.size, 4)
    parts.push(block)
    extraBytes = 8 + extra.size + pad
  }
  const dataHeader = Buffer.alloc(8)
  dataHeader.write("data", 0, "ascii")
  dataHeader.writeUInt32LE(pcm.length, 4)
  parts.push(dataHeader, pcm)
  const body = Buffer.concat(parts)
  const head = Buffer.alloc(12)
  head.write("RIFF", 0, "ascii")
  head.writeUInt32LE(4 + body.length, 4)
  head.write("WAVE", 8, "ascii")
  const bytes = new Uint8Array(Buffer.concat([head, body]))
  return { bytes, dataOffset: 12 + 24 + extraBytes + 8 }
}

test("le binaire est attendu à la racine du dossier fourni", () => {
  const layout = pocketLayout("C:\\Aven\\pocket-tts")
  assert.equal(layout.binary, path.join("C:\\Aven\\pocket-tts", "pocket-tts.exe"))
})

test("le binaire absent ne fait pas croire à une voix disponible", () => {
  assert.equal(pocketInstalled("/tmp/pocket", () => false), false)
  assert.equal(pocketInstalled("/tmp/pocket", (file) => file.endsWith("pocket-tts.exe")), true)
})

test("le serveur est lancé en français, quantifié, sur la boucle locale", () => {
  const args = pocketServerArgs(8419)
  assert.deepEqual(args, ["serve", "--host", "127.0.0.1", "--port", "8419", "--language", "french", "--quantize"])
  assert.equal(POCKET_LANGUAGE, "french")
  // Le défaut du binaire est l'anglais : omettre le langage ferait lire du
  // français avec les règles anglaises, sans aucune erreur visible.
  assert.ok(args.includes("--language"))
})

test("le cache du modèle vit dans les données de l'application", () => {
  assert.equal(
    pocketModelDir("C:\\Users\\x\\AppData\\Roaming\\Aven"),
    path.join("C:\\Users\\x\\AppData\\Roaming\\Aven", "pocket-tts"),
  )
  const env = pocketServerEnv("/tmp/models")
  assert.equal(env.HF_HOME, "/tmp/models")
  assert.equal(env.HF_HUB_DISABLE_TELEMETRY, "1")
})

test("les adresses du serveur local sont celles de la boucle locale", () => {
  assert.equal(pocketHealthUrl(8419), "http://127.0.0.1:8419/health")
  assert.equal(pocketSpeechUrl(8419), "http://127.0.0.1:8419/tts")
})

test("la préférence est préfixée et se relit sans son préfixe", () => {
  assert.equal(POCKET_VOICE_ID, "pocket:fr")
  assert.equal(isPocketVoice("pocket:fr"), true)
  assert.equal(isPocketVoice("piper:fr_FR-tom-medium"), false)
  assert.equal(pocketVoiceName("pocket:fr"), "fr")
})

test("chaque voix annonce le lecteur qui lui correspond", () => {
  // v11.14.0 : Pocket livre des échantillons nus ; toutes les autres voix
  // (Windows, préfixes retirés) rendent l'audio d'un bloc.
  assert.equal(streamKindForVoice("pocket:fr"), "pcm")
  assert.equal(streamKindForVoice("pocket:clone"), "pcm")
  assert.equal(streamKindForVoice(""), "none")
  assert.equal(streamKindForVoice("edge:fr-FR-DeniseNeural"), "none")
  assert.equal(streamKindForVoice("piper:fr_FR-tom-medium"), "none")
  assert.equal(POCKET_PCM_MIME, "audio/pcm")
  assert.equal(POCKET_SAMPLE_RATE, 24000)
})

test("l'en-tête WAV est retrouvé, même avec un bloc avant les données", () => {
  const pcm = Buffer.alloc(64, 7)
  const plain = wav(pcm)
  assert.equal(plain.dataOffset, 44)
  assert.equal(wavDataOffset(plain.bytes), 44)
  assert.deepEqual([...plain.bytes.subarray(44, 48)], [7, 7, 7, 7])
  const withList = wav(pcm, { extra: { id: "LIST", size: 10 } })
  assert.equal(withList.dataOffset, 62)
  assert.equal(wavDataOffset(withList.bytes), 62)
})

test("un en-tête incomplet ne rend pas un offset faux", () => {
  const { bytes } = wav(Buffer.alloc(32))
  // Le flux arrive par morceaux : les 20 premiers octets ne disent rien de « data ».
  assert.equal(wavDataOffset(bytes.subarray(0, 20)), -1)
  assert.equal(wavDataOffset(bytes.subarray(0, 43)), -1)
  assert.equal(wavDataOffset(new Uint8Array(0)), -1)
  assert.equal(wavDataOffset(new Uint8Array(Buffer.from("BMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"))), -1)
})

test("le PCM enveloppé est un WAV valide, échantillon pour échantillon", () => {
  const pcm = Buffer.from([0, 1, 2, 3, 4, 5])
  const file = Buffer.from(wrapPcmAsWav(new Uint8Array(pcm), 24000))
  assert.equal(file.subarray(0, 4).toString("ascii"), "RIFF")
  assert.equal(file.subarray(8, 12).toString("ascii"), "WAVE")
  assert.equal(file.readUInt32LE(4), 36 + pcm.length)
  assert.equal(file.readUInt32LE(16), 16)
  assert.equal(file.readUInt16LE(22), 1)
  assert.equal(file.readUInt32LE(24), 24000)
  assert.equal(file.readUInt32LE(28), 48000)
  assert.equal(file.readUInt16LE(34), 16)
  assert.equal(file.readUInt32LE(40), pcm.length)
  assert.deepEqual([...file.subarray(44)], [...pcm])
  assert.equal(wavDataOffset(new Uint8Array(file)), 44)
})

test("l'attente de démarrage s'arrête dès que le serveur répond", async () => {
  let checks = 0
  let sleeps = 0
  const ready = await waitForPocketReady({
    check: async () => {
      checks++
      return checks === 2
    },
    sleep: async () => {
      sleeps++
    },
  })
  assert.equal(ready, true)
  assert.equal(checks, 2)
  assert.equal(sleeps, 1)
})

test("un serveur qui ne répond jamais rend la main, sans boucler", async () => {
  let now = 0
  let sleeps = 0
  const ready = await waitForPocketReady({
    check: async () => false,
    timeoutMs: 2000,
    intervalMs: 400,
    now: () => now,
    sleep: async (ms) => {
      sleeps++
      now += ms
    },
  })
  assert.equal(ready, false)
  // 2 s / 400 ms : on ne dort pas au-delà de l'échéance.
  assert.equal(sleeps, 5)
  assert.ok(now <= 2400, `l'attente ne dépasse pas l'échéance (${now} ms)`)
})

test("une vérification qui échoue ne fait pas tomber l'attente", async () => {
  let now = 0
  const ready = await waitForPocketReady({
    check: async () => {
      throw new Error("connexion refusée")
    },
    timeoutMs: 400,
    intervalMs: 400,
    now: () => now,
    sleep: async (ms) => {
      now += ms
    },
  })
  assert.equal(ready, false)
})

test("la raison du repli dit la cause et le remède", () => {
  assert.match(pocketUnavailableReason("Le modèle se charge encore"), /Le modèle se charge encore/)
  assert.match(pocketUnavailableReason(""), /n'a pas démarré/)
  assert.match(pocketUnavailableReason("panne"), /fetch:pocket-tts/)
})

test("le profil de voix clonée se lit dans les données de l'application", () => {
  assert.equal(pocketVoicesDir("C:\\Aven"), path.join("C:\\Aven", "pocket-tts", "voices"))
  const file = path.join("C:\\Aven", "pocket-tts", "voices", "aven.safetensors")
  assert.equal(pocketCloneProfile("C:\\Aven", (candidate) => candidate === file), file)
  // Le profil peut manquer : la voix intégrée doit rester disponible, sans erreur.
  assert.equal(pocketCloneProfile("C:\\Aven", () => false), null)
})

test("une seule voix Pocket est proposée : celle qui parlera vraiment", () => {
  assert.equal(POCKET_CLONE_VOICE_ID, "pocket:clone")
  assert.equal(pocketVoiceId(null), POCKET_VOICE_ID)
  assert.equal(pocketVoiceId("C:\\Aven\\pocket-tts\\voices\\aven.safetensors"), POCKET_CLONE_VOICE_ID)
  // Un profil posé ou retiré hors de l'app ne doit pas laisser le menu annoncer
  // « voix clonée » alors que le moteur lit la voix intégrée — ni l'inverse.
  assert.equal(normalizePocketPreference(null, "pocket:clone"), POCKET_VOICE_ID)
  assert.equal(normalizePocketPreference("C:\\Aven\\aven.safetensors", "pocket:fr"), POCKET_CLONE_VOICE_ID)
  assert.equal(normalizePocketPreference("C:\\Aven\\aven.safetensors", "edge:fr-FR-HenriNeural"), "edge:fr-FR-HenriNeural")
  assert.equal(normalizePocketPreference(null, ""), "")
  assert.equal(normalizePocketPreference(null, "piper:fr_FR-tom-medium"), "piper:fr_FR-tom-medium")
})

// ── v11.11.0 : le clonage se fait dans l'app, avec son propre cache ─────────

/** En-tête `.safetensors` minimal : 8 octets de taille, puis le JSON. */
function safetensors(header, { padding = 32, headerBytes = null } = {}) {
  const json = Buffer.from(JSON.stringify(header), "utf8")
  const head = Buffer.alloc(8)
  head.writeBigUInt64LE(BigInt(headerBytes ?? json.length))
  return new Uint8Array(Buffer.concat([head, json, Buffer.alloc(padding, 0)]))
}

const TENSOR = { "voice.embedding": { dtype: "F32", shape: [1, 2], data_offsets: [0, 8] } }

test("la conversion demande le langage et écrit le profil demandé", () => {
  assert.deepEqual(
    pocketExportArgs("C:\\ref.wav", "C:\\voix\\aven.safetensors.export"),
    ["export-voice", "--language", POCKET_LANGUAGE, "C:\\ref.wav", "C:\\voix\\aven.safetensors.export"],
  )
})

test("la conversion travaille dans le cache de l'application, jamais ailleurs", () => {
  const env = pocketExportEnv("C:\\Aven\\pocket-tts")
  assert.equal(env.HF_HOME, "C:\\Aven\\pocket-tts")
  assert.equal(env.HF_HUB_DISABLE_TELEMETRY, "1")
  // Sans jeton : le moteur doit pouvoir lire un cache déjà rempli sans réseau.
  assert.equal("HF_TOKEN" in env, false)
  // Le jeton ne sert qu'au premier téléchargement, et il est transmis au moteur
  // — jamais écrit dans un fichier de commande.
  assert.equal(pocketExportEnv("C:\\Aven", "  hf_abc  ").HF_TOKEN, "hf_abc")
  assert.equal("HF_TOKEN" in pocketExportEnv("C:\\Aven", "   "), false)
})

test("le dépôt du modèle de clonage se lit sous les données de l'app", () => {
  assert.equal(
    pocketCloneRepoDir("C:\\Aven\\pocket-tts"),
    path.join("C:\\Aven\\pocket-tts", "hub", "models--kyutai--pocket-tts"),
  )
})

test("les poids sont cherchés par révision, jamais sur un commit écrit en dur", () => {
  const modelDir = "C:\\Aven\\pocket-tts"
  const asked = []
  const present = pocketCloneWeightsPresent(modelDir, ["aaa111", "bbb222"], (file) => {
    asked.push(file)
    return file.includes("bbb222")
  })
  assert.equal(present, true)
  assert.deepEqual(asked, [
    path.join(modelDir, "hub", "models--kyutai--pocket-tts", "snapshots", "aaa111", "languages", "french", "model.safetensors"),
    path.join(modelDir, "hub", "models--kyutai--pocket-tts", "snapshots", "bbb222", "languages", "french", "model.safetensors"),
  ])
  // Cache vide (ou d'un autre modèle) : le téléchargement sera nécessaire.
  assert.equal(pocketCloneWeightsPresent(modelDir, [], () => true), false)
  assert.equal(pocketCloneWeightsPresent(modelDir, ["ccc333"], () => false), false)
})

test("le message de blocage nomme la page des conditions et le geste", () => {
  const message = pocketCloneBlockedReason("")
  assert.match(message, /conditions/)
  assert.ok(message.includes(POCKET_CLONE_TERMS_URL), "la page du modèle est citée")
  assert.match(message, /jeton/i)
  // Le détail du moteur (constat timestampé) passe devant, sans recopier le texte.
  assert.match(pocketCloneBlockedReason("We could not download"), /^We could not download(?!\.)/)
})

test("un profil est accepté sur son en-tête", () => {
  assert.equal(profileTensorCount(safetensors(TENSOR)), 1)
  assert.equal(
    profileTensorCount(safetensors({ ...TENSOR, second: { dtype: "F32", shape: [4], data_offsets: [8, 24] } })),
    2,
  )
})

test("un fichier qui n'est pas un profil est refusé, jamais installé", () => {
  // Trop court pour porter une taille d'en-tête.
  assert.throws(() => profileTensorCount(new Uint8Array([1, 2, 3])), /trop court/)
  // La taille annoncée dépasse le fichier : profile tronqué.
  assert.throws(() => profileTensorCount(safetensors(TENSOR, { headerBytes: 4096 })), /incohérente/)
  // En-tête annoncé de bonne taille, mais illisible : ce n'est pas du safetensors.
  const broken = Buffer.concat([Buffer.alloc(8), Buffer.from("pas du json"), Buffer.alloc(16)])
  broken.writeBigUInt64LE(BigInt(Buffer.byteLength("pas du json")))
  assert.throws(() => profileTensorCount(new Uint8Array(broken)), /illisible/)
  // JSON valide, mais qui ne décrit aucun tenseur.
  assert.throws(() => profileTensorCount(safetensors({ metadata: { voix: "référence" } })), /aucun tenseur/)
})

test("le profil cloné s'écrit à côté de la voix intégrée, via un staging", () => {
  const paths = pocketClonePaths("C:\\Aven")
  assert.equal(paths.dir, path.join("C:\\Aven", "pocket-tts", "voices"))
  assert.equal(paths.file, path.join(paths.dir, "aven.safetensors"))
  // Le moteur écrit d'abord le staging : un profil à moitié écrit ne remplace
  // jamais celui qui marche.
  assert.equal(paths.staged, `${paths.file}.export`)
})

test("le profil cloné est transmis au démarrage, la voix intégrée sans argument", () => {
  const plain = pocketServerArgs(8419)
  assert.equal(plain.includes("--default-voice"), false)
  const cloned = pocketServerArgs(8419, "C:\\Aven\\pocket-tts\\voices\\aven.safetensors")
  assert.deepEqual(cloned.slice(-2), ["--default-voice", "C:\\Aven\\pocket-tts\\voices\\aven.safetensors"])
  assert.deepEqual(cloned.slice(0, plain.length), plain)
})

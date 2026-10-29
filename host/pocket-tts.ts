// v11.10.0 : voix locale Pocket TTS (Kyutai), moteur choisi à l'oreille.
// Pourquoi ce module existe : sur la phrase de référence, cette voix a été
// préférée à l'écoute à Denise, à Henri (Edge) et à Tom (Piper), et elle tourne
// hors ligne. Le binaire Rust autonome (22 Mo, MIT, sans Python) sert la synthèse
// en flux : 1er son mesuré à 270 ms, 0,40 de facteur temps réel, et il ne
// décroche jamais la lecture (avance positive de 19 à 79 ms sur la phrase de
// référence, mesuré le 2026-10-27). Les poids français (209 Mo, CC-BY 4.0, dépôt
// ouvert sans jeton) sont mis en cache par le moteur lui-même ; le texte est
// envoyé au service HTTP local, jamais à un tiers.
//
// Ce qui n'est PAS dans ce module : le cycle de vie du serveur (processus, port,
// attente de disponibilité) est décidé par le host, qui seul connaît son
// environnement. Ici vivent la mise en page, les arguments, l'en-tête WAV et la
// disponibilité — tout ce qui se teste sans processus ni réseau.
//
// Pur : testable avec Node seul, sans dépendance desktop.
import path from "node:path"

/** Identifiant de préférence, préfixé comme ceux d'Edge, de Piper et de SAPI. */
export const POCKET_VOICE_ID = "pocket:fr"
/** Libellé du menu : le nom de la voix du modèle, pas un identifiant interne. */
export const POCKET_VOICE_LABEL = "Pocket TTS — locale, voix française"
/**
 * v11.10.0 : identifiant de la voix CLONÉE, et le libellé neutre qui l'accompagne.
 * Le profil vit dans les données de l'app (voir `npm run voice:pocket`), jamais
 * dans l'installeur : c'est un dérivé d'un enregistrement de référence, pas un
 * modèle qu'on redistribue. Deux identifiants, donc — et un seul proposé à la
 * fois, celui qui décrit vraiment ce que le moteur va dire.
 */
export const POCKET_CLONE_VOICE_ID = "pocket:clone"
export const POCKET_CLONE_VOICE_LABEL = "Pocket TTS — locale, voix clonée"
/** Nom du profil attendu dans le dossier des voix. */
export const POCKET_CLONE_FILE = "aven.safetensors"
/**
 * v11.11.0 : dépôt du modèle AVEC clonage — le seul maillon de la chaîne dont
 * l'accès est soumis à conditions (lire un profil, non : le moteur le lit avec
 * le modèle ouvert). Son nom et sa page sont ici parce que le message d'aide les
 * cite, et qu'un message recopié finit par mentir.
 */
export const POCKET_CLONE_REPO = "kyutai/pocket-tts"
export const POCKET_CLONE_TERMS_URL = `https://huggingface.co/${POCKET_CLONE_REPO}`
/** Chemin des poids français dans le dépôt de clonage, tel que le moteur le demande. */
export const POCKET_CLONE_WEIGHTS = "languages/french/model.safetensors"
/**
 * v11.11.0 : une conversion peut télécharger 209 Mo (mesuré) avant de travailler.
 * La borne est large — un lien lent ne doit pas être pris pour une panne — mais
 * elle existe : un moteur figé ne laisse pas l'app attendre indéfiniment.
 */
export const POCKET_CLONE_TIMEOUT_MS = 1_800_000
/** Modèle français, tel que le binaire le nomme (le défaut serait l'anglais). */
export const POCKET_LANGUAGE = "french"
/** Fréquence du modèle : 24 kHz mono, en PCM 16 bits signé. */
export const POCKET_SAMPLE_RATE = 24_000
/**
 * Type du flux PCM : les trames sont des échantillons BRUTS, sans conteneur.
 * MediaSource ne lit pas de PCM nu (son chemin est le WebM/Opus d'Edge) — la
 * webview les empile donc dans un AudioContext, et le type sert à choisir le
 * lecteur côté renderer.
 */
export const POCKET_PCM_MIME = "audio/pcm"
/** Version du binaire publié et empreinte du zip : le script de pose les vérifie. */
export const POCKET_RELEASE = "v4.0.1"
export const POCKET_BINARY_VERSION = "3.3.0"
export const POCKET_ZIP = `pocket-tts-${POCKET_BINARY_VERSION}-x86_64-pc-windows-msvc.zip`
export const POCKET_ZIP_SHA256 = "98753041f2e65744b989776f87bccb93f1f574a08afe1890c5427ec94cd6309c"
/** Commit du modèle français ouvert, celui que le moteur télécharge sans jeton. */
export const POCKET_MODEL_COMMIT = "1e08e6a23401048648a9fdcfde2f89348215c2a7"
/**
 * v11.10.0 : premier démarrage = chargement du modèle, mesuré à 12,7 s ; le
 * premier usage peut en plus télécharger 209 Mo. On attend, puis on le dit —
 * jamais un silence de deux minutes sans explication.
 */
export const POCKET_START_TIMEOUT_MS = 60_000
/** Intervalle entre deux interrogations de `/health` pendant le démarrage. */
export const POCKET_HEALTH_INTERVAL_MS = 400

export type PocketLayout = { binary: string }

/** Emplacement du binaire dans un dossier `pocket-tts/` fourni par l'installeur. */
export function pocketLayout(dir: string): PocketLayout {
  return { binary: path.join(dir, "pocket-tts.exe") }
}

/**
 * Cache du modèle : le moteur honore `HF_HOME`. On l'oriente vers un dossier de
 * l'application — les 209 Mo ne doivent pas retomber dans un dossier temporaire,
 * qui serait purgé et retéléchargé.
 */
export function pocketModelDir(dataDir: string): string {
  return path.join(dataDir, "pocket-tts")
}

/** Vrai si le binaire du moteur est présent. */
export function pocketInstalled(dir: string, exists: (file: string) => boolean): boolean {
  return exists(pocketLayout(dir).binary)
}

/**
 * Arguments du serveur local. `--language french` est OBLIGATOIRE : le défaut du
 * binaire est l'anglais, qui lirait le français avec les règles anglaises.
 * `--quantize` applique l'int8 mesuré à 0,40 de facteur temps réel (contre 0,53
 * sans quantification) sans changer la voix — écouté, l'int8 n'a pas été
 * distinguable du fp32.
 */
export function pocketServerArgs(port: number, cloneProfile?: string | null): string[] {
  const args = [
    "serve",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--language",
    POCKET_LANGUAGE,
    "--quantize",
  ]
  // v11.10.0 : la voix est celle du SERVEUR — le moteur n'accepte pas de voix par
  // requête. Le profil se transmet donc au démarrage : changer de profil demande
  // de redémarrer le moteur, ce que fait la fermeture de session.
  if (cloneProfile) args.push("--default-voice", cloneProfile)
  return args
}

/** Environnement du serveur : le cache du modèle vit dans l'application. */
export function pocketServerEnv(modelDir: string): Record<string, string> {
  return {
    HF_HOME: modelDir,
    // Aucune télémétrie : la voix ne dépend d'aucun compte, et rien ne sort d'ici.
    HF_HUB_DISABLE_TELEMETRY: "1",
  }
}

export function pocketHealthUrl(port: number): string {
  return `http://127.0.0.1:${port}/health`
}

export function pocketSpeechUrl(port: number): string {
  return `http://127.0.0.1:${port}/tts`
}

/** Vrai pour la voix Pocket — un moteur local, donc hors ligne. */
export function isPocketVoice(value: string): boolean {
  return String(value ?? "").startsWith("pocket:")
}

/** Nom de voix sans le préfixe de préférence. */
export function pocketVoiceName(value: string): string {
  return String(value ?? "").replace(/^pocket:/, "")
}

/**
 * Dossier des profils de voix clonées, sous les données de l'app — à côté du cache
 * du modèle, pour que tout ce qui vient du moteur se trouve au même endroit.
 */
export function pocketVoicesDir(dataDir: string): string {
  return path.join(dataDir, "pocket-tts", "voices")
}

/**
 * Chemin du profil installé, ou `null`. Un seul profil, à un emplacement
 * prévisible : c'est ce qui permet au script de pose de l'écrire et au host de le
 * trouver sans deviner. `exists` est injecté : la règle se teste sans disque.
 */
export function pocketCloneProfile(dataDir: string, exists: (file: string) => boolean): string | null {
  const file = path.join(pocketVoicesDir(dataDir), POCKET_CLONE_FILE)
  return exists(file) ? file : null
}

/** Voix Pocket à proposer : la clonée quand son profil est posé, l'intégrée sinon. */
export function pocketVoiceId(cloneProfile: string | null): string {
  return cloneProfile ? POCKET_CLONE_VOICE_ID : POCKET_VOICE_ID
}

/**
 * v11.11.0 : chemins du profil cloné sous les données de l'app. `staged` est le
 * fichier que le moteur écrit : il n'occupe la place du profil qu'une fois son
 * en-tête vérifié — un fichier à moitié écrit ne remplace jamais un profil qui
 * marche.
 */
export function pocketClonePaths(dataDir: string): { dir: string; file: string; staged: string } {
  const dir = pocketVoicesDir(dataDir)
  const file = path.join(dir, POCKET_CLONE_FILE)
  return { dir, file, staged: `${file}.export` }
}

/**
 * v11.11.0 : dossier du dépôt de clonage dans le cache du MOTEUR. Ce cache est
 * celui de l'application (données de l'app) : l'app n'utilise jamais un modèle
 * rangé par une autre installation.
 */
export function pocketCloneRepoDir(modelDir: string): string {
  return path.join(modelDir, "hub", "models--kyutai--pocket-tts")
}

/**
 * Vrai si les poids du modèle de clonage sont déjà dans CE cache-là. Le moteur
 * range un dépôt par révision (`snapshots/<commit>/…`) : la présence se teste sur
 * la liste des révisions, jamais sur un commit écrit en dur, qui changerait au
 * rythme des publications du modèle.
 */
export function pocketCloneWeightsPresent(
  modelDir: string,
  snapshots: string[],
  exists: (file: string) => boolean,
): boolean {
  const root = pocketCloneRepoDir(modelDir)
  return snapshots.some((name) => exists(path.join(root, "snapshots", name, POCKET_CLONE_WEIGHTS)))
}

/**
 * Arguments de la conversion d'un enregistrement en profil de voix. Même règle
 * que le serveur : le langage est dit explicitement, sinon la référence serait
 * encodée avec les règles anglaises.
 */
export function pocketExportArgs(audio: string, output: string): string[] {
  return ["export-voice", "--language", POCKET_LANGUAGE, audio, output]
}

/**
 * Environnement de la conversion. `HF_HOME` pointe le dossier de l'APPLICATION :
 * l'app installe elle-même ce qu'elle utilise (v11.11.0) — jamais le cache d'une
 * autre installation. Le jeton n'est transmis que s'il y en a un : il ne sert
 * qu'au premier téléchargement, le modèle de clonage étant soumis à conditions.
 */
export function pocketExportEnv(modelDir: string, token?: string): Record<string, string> {
  const env: Record<string, string> = { HF_HOME: modelDir, HF_HUB_DISABLE_TELEMETRY: "1" }
  const value = String(token ?? "").trim()
  if (value) env.HF_TOKEN = value
  return env
}

/**
 * Nombre de tenseurs décrits par l'en-tête d'un profil `.safetensors`. Un
 * `.safetensors` commence par la taille (entier 64 bits, petit-boutiste) de son
 * en-tête JSON : c'est le seul contrôle qu'on puisse faire sans charger 10 Mo de
 * poids, et il attrape le fichier tronqué comme le fichier étranger.
 */
export function profileTensorCount(bytes: Uint8Array): number {
  if (bytes.length < 9) throw new Error("fichier trop court pour un profil de voix")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const headerLength = Number(view.getBigUint64(0, true))
  if (!headerLength || headerLength > bytes.length - 8) throw new Error("en-tête de taille incohérente")
  let header: Record<string, { dtype?: unknown; shape?: unknown }>
  try {
    header = JSON.parse(Buffer.from(bytes.subarray(8, 8 + headerLength)).toString("utf8")) as typeof header
  } catch {
    throw new Error("en-tête illisible : ce n'est pas un fichier .safetensors")
  }
  const tensors = Object.values(header ?? {}).filter(
    (entry) => entry && typeof entry === "object" && "dtype" in entry && "shape" in entry,
  )
  if (!tensors.length) throw new Error("aucun tenseur décrit dans l'en-tête")
  return tensors.length
}

/**
 * v11.11.0 : message quand le clonage ne peut pas se faire faute de modèle. Il
 * nomme la cause, la page des conditions ET le geste — même modèle que
 * `pocketUnavailableReason` pour le repli de lecture : jamais un échec anonyme.
 */
export function pocketCloneBlockedReason(detail: string): string {
  const clean = String(detail ?? "").trim().replace(/\.$/, "")
  const remedy =
    `Le modèle de clonage n'est pas encore là : accepte les conditions sur ${POCKET_CLONE_TERMS_URL}, ` +
    "puis colle un jeton Hugging Face dans les Réglages (il sert une seule fois, au téléchargement)."
  return clean ? `${clean} ${remedy}` : remedy
}

/**
 * Recale une préférence Pocket sur la voix réellement disponible. Le profil se
 * pose ou se retire hors de l'app : sans ce recalage, le menu continuerait
 * d'annoncer « voix clonée » alors que le moteur lit la voix intégrée, et
 * l'inverse. Les autres préférences traversent la fonction sans être touchées.
 */
export function normalizePocketPreference(cloneProfile: string | null, requested: string | undefined): string {
  const stored = String(requested ?? "").trim()
  if (!isPocketVoice(stored)) return stored
  return pocketVoiceId(cloneProfile)
}

/**
 * Lecteur à préparer pour une préférence de voix : « pcm » pour Pocket (flux
 * d'échantillons bruts), « none » quand le host jouera lui-même l'audio (voix
 * Windows). v11.14.0 : le lecteur WebM/Opus des voix neuronales a été retiré
 * avec celles-ci.
 */
export function streamKindForVoice(voiceName: string): "pcm" | "none" {
  const value = String(voiceName ?? "").trim()
  if (isPocketVoice(value)) return "pcm"
  return "none"
}

/**
 * Offset du premier octet PCM dans un WAV `RIFF`. Rend -1 tant que l'en-tête
 * n'est pas complet : le flux du serveur arrive par morceaux, et l'en-tête peut
 * être coupé en deux. Les morceaux sont parcourus avec leur taille plutôt que de
 * supposer 44 octets : un WAV peut porter un bloc `LIST` avant les données.
 * Pur : c'est la seule subtilité du flux, elle mérite d'être testée.
 */
export function wavDataOffset(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (at: number): string =>
    String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!)
  if (bytes.length < 12 || ascii(0) !== "RIFF" || ascii(8) !== "WAVE") return -1
  let at = 12
  while (at + 8 <= bytes.length) {
    const id = ascii(at)
    const size = view.getUint32(at + 4, true)
    if (id === "data") return at + 8 <= bytes.length ? at + 8 : -1
    // Un morceau de taille impaire est suivi d'un octet de bourrage.
    at += 8 + size + (size % 2)
  }
  return -1
}

/**
 * Enveloppe du PCM brut dans un WAV, pour le chemin NON diffusé (aperçu des
 * Réglages, repli) : la webview joue un WAV complet par `decodeAudioData`, mais
 * pas un flux d'échantillons nus.
 */
export function wrapPcmAsWav(pcm: Uint8Array, sampleRate: number = POCKET_SAMPLE_RATE): Uint8Array {
  const header = Buffer.alloc(44)
  header.write("RIFF", 0, "ascii")
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write("WAVE", 8, "ascii")
  header.write("fmt ", 12, "ascii")
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36, "ascii")
  header.writeUInt32LE(pcm.length, 40)
  return new Uint8Array(Buffer.concat([header, Buffer.from(pcm)]))
}

/**
 * Attend que le serveur réponde. Injecté (`check`, `sleep`, `now`) : la règle
 * « on attend tant que le modèle se charge, puis on abandonne en le disant » se
 * teste sans lancer de processus ni attendre pour de vrai.
 */
export async function waitForPocketReady(options: {
  check: () => Promise<boolean>
  timeoutMs?: number
  intervalMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}): Promise<boolean> {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const deadline = now() + (options.timeoutMs ?? POCKET_START_TIMEOUT_MS)
  const interval = options.intervalMs ?? POCKET_HEALTH_INTERVAL_MS
  for (;;) {
    if (await options.check().catch(() => false)) return true
    if (now() + interval > deadline) return false
    await sleep(interval)
  }
}

/**
 * Message du repli : il nomme la cause ET la voix qui parle à la place, comme
 * pour Edge (v11.3.0) — sinon l'utilisateur croirait avoir changé de voix pour
 * rien. La préparation du modèle est citée, car c'est la cause la plus probable
 * du premier échec.
 */
export function pocketUnavailableReason(detail: string): string {
  const clean = String(detail ?? "").trim().replace(/\.$/, "")
  const hint = "prépare le modèle avec « npm run fetch:pocket-tts »"
  return clean ? `${clean} (${hint})` : `Le moteur Pocket TTS n'a pas démarré (${hint})`
}

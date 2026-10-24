// v11.5.0 : voix locale Piper, qui remplace la voix Windows Hortense en repli.
// Pourquoi ce module existe : mesuré le 2026-10-25 sur cette machine, la voix
// Windows (MSTTS 2016, 16 kHz) avale une syllabe de « Freebuff » et reste la même
// famille que Julie et Paul ; Piper siwis (VITS, 22,05 kHz) est huit fois plus
// rapide que le temps réel (0,12 de facteur) et c'est la voix que l'utilisateur a
// retenue à l'écoute. Aucun compte, aucun réseau, aucun quota : c'est le repli
// hors ligne, il ne peut pas tomber en 429.
//
// Le binaire et le modèle sont posés par `npm run fetch:piper` dans
// `src-tauri/resources/piper` puis embarqués par l'installeur ; le host reçoit
// leur dossier par `AVEN_PIPER_DIR` (résolu côté Rust).
//
// Pur : le lanceur de processus est injectable, donc testable sans binaire.
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/** Voix française retenue : la seule des six écoutées qui place les deux noms. */
export const PIPER_VOICE = "fr_FR-siwis-medium"
/** Identifiant de préférence, préfixé comme ceux d'Edge et de SAPI. */
export const PIPER_VOICE_ID = `piper:${PIPER_VOICE}`

/**
 * v11.5.1 : à texte égal, siwis parlait 44 % plus vite que Denise (2,45 s contre
 * 3,53 s, mesuré le 2026-10-25). La parité mesurée demandait `length_scale` 1,44
 * (101 % de la durée de Denise) — mais écoutée dans l'app, cette valeur a été
 * jugée TROP LENTE : à 1,44 le rythme traîne au lieu de presser. Le réglage
 * retenu est donc 1,10, presque le débit d'origine du modèle (+9 % de durée),
 * assez pour ne plus paraître essoufflé sans donner l'impression d'attendre.
 * Leçon conservée : une valeur calibrée sur la durée n'est pas une valeur
 * agréable à écouter — l'oreille tranche après la mesure.
 */
export const PIPER_LENGTH_SCALE = 1.1

/** Réglages de prosodie passés à Piper — surchargeables, donc testables. */
export type PiperSpeech = { lengthScale?: number; noiseScale?: number; noiseW?: number }

/**
 * Arguments du binaire Piper, dans un ordre stable et testable sans processus.
 * `--length_scale` est TOUJOURS transmis : la valeur par défaut du modèle (1,0)
 * est justement le débit trop rapide que la v11.5.1 corrige.
 */
export function piperArgs(layout: PiperLayout, output: string, speech: PiperSpeech = {}): string[] {
  const args = [
    "--model",
    layout.model,
    "--output_file",
    output,
    "--length_scale",
    String(speech.lengthScale ?? PIPER_LENGTH_SCALE),
  ]
  if (speech.noiseScale !== undefined) args.push("--noise_scale", String(speech.noiseScale))
  if (speech.noiseW !== undefined) args.push("--noise_w", String(speech.noiseW))
  return args
}

export type PiperLayout = { binary: string; model: string }

/** Emplacement des deux fichiers d'un dossier `piper/` fourni par l'installeur. */
export function piperLayout(dir: string, voice: string = PIPER_VOICE): PiperLayout {
  return {
    binary: path.join(dir, "piper", "piper.exe"),
    model: path.join(dir, "voices", `${voice}.onnx`),
  }
}

/**
 * Lance Piper sur un texte et rend le WAV complet.
 * `runner` est le point d'injection des tests : aucun processus réel n'y est lancé.
 */
export type PiperRunner = (layout: PiperLayout, text: string, speech: PiperSpeech) => Promise<Uint8Array>

export async function synthesizePiperSpeech(
  text: string,
  options: { dir: string; voice?: string; run?: PiperRunner; speech?: PiperSpeech },
): Promise<Uint8Array> {
  const clean = String(text ?? "").trim()
  if (!clean) throw new Error("Aucun texte à prononcer.")
  const layout = piperLayout(options.dir, options.voice ?? PIPER_VOICE)
  const run = options.run ?? runPiper
  const audio = await run(layout, clean, options.speech ?? {})
  if (!audio.length) throw new Error("La voix locale Piper n'a produit aucun audio.")
  return audio
}

/**
 * Lancement réel : Piper lit le texte sur son entrée standard et écrit un WAV.
 * Un processus par phrase — même coût qu'Hortense (~1,9 s de lancement), mais
 * le modèle est chargé en une fois et la synthèse prend ensuite ~0,9 s.
 */
const runPiper: PiperRunner = async (layout, text, speech) => {
  const output = path.join(os.tmpdir(), `aven-piper-${randomUUID()}.wav`)
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(layout.binary, piperArgs(layout, output, speech), {
        windowsHide: true,
        stdio: ["pipe", "ignore", "pipe"],
      })
      let detail = ""
      child.stderr?.on("data", (chunk: Buffer) => {
        detail += chunk.toString("utf8")
      })
      child.on("error", (error) => reject(new Error(`La voix locale Piper n'a pas démarré : ${error.message}`)))
      child.on("close", (code) => {
        if (code === 0) resolve()
        else reject(new Error(`La voix locale Piper a échoué (code ${code ?? "inconnu"})${detail ? ` : ${detail.trim().split("\n").pop()}` : ""}.`))
      })
      child.stdin?.end(text, "utf8")
    })
    return await readFile(output)
  } finally {
    await rm(output, { force: true }).catch(() => undefined)
  }
}

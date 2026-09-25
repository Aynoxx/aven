// Détection de build périmé : les correctifs v8.7.6 ont déjà été livrés avec un
// dist-electron/ antérieur aux sources (le vocal Gemini Live et la fusion de
// l'historique Freebuff ne s'exécutaient pas). Les autres scripts verify ne lisent
// que les sources : celui-ci vérifie que le BUILD correspond.
//
// Deux contrôles :
//  1. tous les modules sources ont un fichier compilé PLUS RÉCENT (mtime) ;
//  2. des sondes de contenu : les marqueurs du code courant sont présents dans le build.
// Idempotent, sans dépendance externe. Échec (exit 1) = il faut relancer npm run build:electron.
import { existsSync, statSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const srcDir = path.join(root, "electron")
const outDir = path.join(root, "dist-electron")

const problems = []

if (!existsSync(outDir)) {
  console.error(`✗ ${path.relative(root, outDir)} n'existe pas. Lance npm run build:electron.`)
  process.exit(1)
}

// 1. Fraîcheur : chaque .ts de electron/ doit avoir un .js compilé plus récent.
const sources = readdirSync(srcDir).filter((f) => f.endsWith(".ts"))
for (const src of sources) {
  const base = src.replace(/\.ts$/, "")
  // preload.cts → preload.cjs ; les autres → .js
  const candidates = src.endsWith(".cts") ? [`${base}.cjs`] : [`${base}.js`]
  const built = candidates.map((c) => path.join(outDir, c)).find((p) => existsSync(p))
  if (!built) {
    problems.push(`${src} : compilé ${candidates.join(" ou ")} introuvable`)
    continue
  }
  const srcTime = statSync(path.join(srcDir, src)).mtimeMs
  const builtTime = statSync(built).mtimeMs
  if (builtTime < srcTime - 1000) { // 1 s de tolérance filesystem
    problems.push(`${src} (${new Date(srcTime).toLocaleTimeString()}) plus récent que ${path.basename(built)} (${new Date(builtTime).toLocaleTimeString()}) → build périmé`)
  }
}

// 2. Sondes de contenu : marqueurs du code v8.7.9 courant dans le build compilé.
const probes = [
  { file: "main.js", marker: "notes:list", why: "page Notes conservée" },
  { file: "main.js", marker: "voice:transcribe", why: "dictée Groq branchée en IPC (v8.7.8)" },
  { file: "main.js", marker: "announcer:setEnabled", why: "annonceur vocal branché en IPC (v8.7.9)" },
  { file: "main.js", marker: "System.Speech", why: "voix SAPI Windows (annonceur)" },
  { file: "announcer.js", marker: "session.execution.interrupted", why: "grammaire d'événements annonceur complète" },
  { file: "voice.js", marker: "audio/transcriptions", why: "endpoint Whisper Groq présent" },
  { file: "voice.js", marker: "chat/completions", why: "passe de reformage présente" },
  { file: "main.js", marker: "auth_tokens", absent: true, why: "l'ancien endpoint vocal duplex (retiré) doit rester absent" },
  { file: "main.js", marker: "versionWarning", why: "avertissement d'écart de version OpenCode" },
  { file: "operations.js", marker: "getFreebuffMessages", why: "fusion de l'historique Freebuff dans messages()" },
  { file: "router.js", marker: "session.revert", why: "renvoi de message sans duplication (stage/commit)" },
  { file: "model-ref.js", marker: "parseRef", why: "module partagé model-ref présent" },
  { file: "priorities.js", marker: "-free", why: "détection dynamique des modèles gratuits OpenCode" },
  { file: "notes.js", marker: "listNotes", why: "module notes autonome présent" },
  { file: "voice-intent.js", marker: "open-notes", why: "classification d'intention de la dictée compilée (v8.8.0)" },
  { file: "voice.js", marker: "allSettled", why: "classification en parallèle du reformage (v8.8.0)" },
  { file: "main.js", marker: "intention:", why: "log d'intention de la dictée (v8.8.0)" },
]
for (const probe of probes) {
  const p = path.join(outDir, probe.file)
  if (!existsSync(p)) {
    problems.push(`${probe.file} introuvable (sonde : ${probe.why})`)
    continue
  }
  const content = readFileSync(p, "utf8")
  const present = content.includes(probe.marker)
  if (probe.absent ? present : !present) {
    problems.push(`${probe.file} : marqueur « ${probe.marker} » ${probe.absent ? "encore présent (devrait avoir disparu)" : "absent"} — ${probe.why}`)
  }
}

if (problems.length) {
  console.error(`✗ Build périmé ou incomplet (${problems.length}) :`)
  for (const p of problems) console.error(`  - ${p}`)
  console.error("→ Lance npm run build:electron puis relance la vérification.")
  process.exit(1)
}
console.log(`vérification du build : OK (${sources.length} modules, ${probes.length} sondes de contenu)`)

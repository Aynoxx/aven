// npm start — resynchronise puis ouvre l'app de production, en une seule commande.
//
// Deux propriétés non négociables :
//   1. JAMAIS d'app périmée : si `scripts/sync.mjs` échoue, on ne lance rien et
//      on ressort avec son code — un binaire dont le rebuild a raté ne doit pas
//      partir en faisant croire que tu as le dernier code.
//   2. Le terminal reste libre : le binaire est spawné DÉTACHÉ (+ unref), sinon
//      npm attend la fin de l'app et un Ctrl+C tuerait les deux.
//
// Les options sont transmises telles quelles à sync : `npm start -- --sans-build`
// saute le rebuild (quelques secondes) quand tu sais déjà que tout est à jour.
// `npm run dev` reste la voie du hot reload ; ici c'est la production.
import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const exe = path.join(root, "src-tauri", "target", "debug", process.platform === "win32" ? "aven.exe" : "aven")
const transmises = process.argv.slice(2)

// ── 0. Garde-fou lisible, AVANT que sync ne refuse de son côté ────────────────
// (sync fait le même contrôle pour son usage direct ; ici on donne le message
//  qui a du sens pour celui qui essaie juste d'ouvrir l'app.)
if (process.platform === "win32") {
  const t = spawnSync("tasklist", ["/FI", "IMAGENAME eq aven.exe"], { encoding: "utf8", windowsHide: true })
  if (/aven\.exe/i.test(t.stdout ?? "")) {
    console.error("KO Aven est déjà ouvert (instance unique) : ferme l'app, puis relance `npm start`.")
    process.exit(1)
  }
}

// ── 1. sync d'abord — pas de sync vert, pas d'app ─────────────────────────────
console.log("→ Étape 1/2 : sync " + (transmises.length ? transmises.join(" ") : "(fetch + avance rapide + verrous + rebuild)"))
const code = spawnSync(process.execPath, [path.join(root, "scripts", "sync.mjs"), ...transmises], {
  cwd: root, stdio: "inherit", windowsHide: true,
}).status ?? 1
if (code !== 0) {
  console.error(`KO sync a échoué (code ${code}) — rien n'est lancé, pour ne pas ouvrir un binaire périmé.`)
  process.exit(code)
}

// ── 2. Lancement détaché ──────────────────────────────────────────────────────
if (!existsSync(exe)) {
  console.error(`KO binaire introuvable : ${exe}`)
  process.exit(1)
}

const enfant = spawn(exe, [], { cwd: root, detached: true, stdio: "ignore", windowsHide: false })
enfant.on("error", (err) => {
  console.error(`KO lancement impossible : ${err.message}`)
  process.exit(1)
})
enfant.unref()

console.log("→ Étape 2/2 : application")
console.log(`✓ Aven lancé (pid ${enfant.pid}) — ${exe}`)

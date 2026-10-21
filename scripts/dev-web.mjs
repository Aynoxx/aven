// v10.3.2 : lanceur du serveur web de développement (`npm run dev:web`, appelé par
// `beforeDevCommand` de Tauri).
//
// Pourquoi ce fichier existe (constaté deux fois) : `tauri dev` démarre Vite, mais
// son arrêt (Ctrl+C, crash, fermeture de la fenêtre) ne tue pas toujours ce
// petit-fils. Au lancement suivant, Vite refuse le port 5173 (`strictPort`, le port
// est FIGÉ par `devUrl` dans tauri.conf.json) et `tauri dev` s'arrête sur
// « terminated with a non-zero status code » : l'app ne s'ouvre jamais, alors que
// le serveur orphelin servait encore le bon code.
//
// Donc : on SONDE le port avant de démarrer. Un Vite Aven déjà vivant est réutilisé
// (HMR intact, aucun rebuild) ; un intrus est nommé avec son pid au lieu de laisser
// une erreur de port opaque.
import { execFileSync, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HOST = "127.0.0.1"
const PORT = 5173
const DELAI_SONDE_MS = 1500

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const webDir = path.join(racine, "web")
const viteBin = path.join(webDir, "node_modules", "vite", "bin", "vite.js")

// Une seule requête GET : au-delà, le serveur est vivant mais on n'a pas besoin de
// son contenu entier pour l'identifier.
function sonder(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port, path: "/", timeout: DELAI_SONDE_MS }, (res) => {
      let corps = ""
      res.setEncoding("utf8")
      res.on("data", (morceau) => { if (corps.length < 20000) corps += morceau })
      res.on("end", () => resolve({ statut: res.statusCode ?? 0, corps }))
      res.on("error", (erreur) => resolve({ erreur: erreur.code ?? erreur.message }))
    })
    req.on("timeout", () => req.destroy(Object.assign(new Error("délai dépassé"), { code: "TIMEOUT" })))
    // ECONNREFUSED = personne n'écoute : c'est le cas NORMAL (port libre), pas une
    // panne — le distinguer évite un faux diagnostic « port occupé ».
    req.on("error", (erreur) => resolve({ erreur: erreur.code ?? erreur.message }))
  })
}

// Identité du serveur : la page d'accueil de Vite sert index.html tel quel, donc le
// titre et le point d'entrée sont ceux du dépôt. On ne teste PAS /src/main.tsx :
// une erreur de compilation le rendrait 500 alors que le serveur est bien le nôtre.
function estServeurAven(reponse) {
  if (!reponse || reponse.erreur || reponse.statut !== 200) return false
  return /<title>\s*Aven\s*<\/title>/i.test(reponse.corps) && /\/src\/main\.tsx/.test(reponse.corps)
}

function proprietaire(port) {
  try {
    const sortie = execFileSync("netstat", ["-ano"], { encoding: "utf8", windowsHide: true })
    const ligne = sortie.match(new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "i"))
    return ligne ? Number(ligne[1]) : null
  } catch {
    return null
  }
}

function demarrerVite() {
  if (!existsSync(viteBin)) {
    console.error(
      "✗ Vite introuvable dans web/node_modules : lance `npm install` à la racine du dépôt.",
    )
    process.exit(1)
  }
  console.log(`Vite · http://${HOST}:${PORT}`)
  // stdio hérité : le dragueur de Tauri et le terminal voient la même sortie, et
  // Ctrl+C atteint le groupe de console comme avec `cd web && vite`.
  const enfant = spawn(process.execPath, [viteBin], { cwd: webDir, stdio: "inherit", env: process.env })
  enfant.on("error", (erreur) => {
    console.error("✗ Vite n'a pas pu démarrer :", erreur.message)
    process.exit(1)
  })
  enfant.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 0))
}

const reponse = await sonder(PORT)

if (estServeurAven(reponse)) {
  const pid = proprietaire(PORT)
  console.log(
    `✓ Vite Aven déjà actif sur http://${HOST}:${PORT}${pid ? ` (pid ${pid})` : ""} — réutilisé,` +
      " aucun second serveur lancé.",
  )
  // Un serveur déjà là garde sa configuration de démarrage : c'est le seul cas où
  // une modification de web/vite.config.ts demande de l'arrêter à la main.
  console.log("  (après une modification de web/vite.config.ts, arrête-le puis relance)")
  process.exit(0)
}

if (reponse.erreur === "ECONNREFUSED") {
  demarrerVite()
} else {
  const pid = proprietaire(PORT)
  const qui = pid ? `pid ${pid}` : "pid inconnu"
  const quoi = reponse.erreur ? `réponse illisible (${reponse.erreur})` : `HTTP ${reponse.statut}`
  console.error(
    [
      `✗ Le port ${PORT} est occupé par un programme qui n'est pas le serveur Aven (${quoi}, ${qui}).`,
      "  Aven en a besoin pour `npm run dev` : devUrl et strictPort sont fixes dans src-tauri/tauri.conf.json.",
      `  Identifie-le : netstat -ano | findstr :${PORT}`,
      "  Arrête-le (ou laisse le serveur Aven tourner et relance simplement `npm run dev`), puis réessaie.",
    ].join("\n"),
  )
  process.exit(1)
}

// Installe les dépendances du frontend (web/) en lançant npm DEPUIS ce dossier.
//
// Pourquoi pas `npm --prefix web install` ? Les npm récents exécutent les lifecycle
// scripts du dossier courant (la racine) même avec --prefix : le postinstall racine
// se ré-exécutait donc en boucle sur le runner GitHub Windows (image de sept. 2026)
// jusqu'à l'erreur « 'npm' is not recognized ». Avec cwd=web, le npm enfant voit le
// package.json de web (sans postinstall) : plus aucune récursion possible, quelle que
// soit la version de npm.
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web")

// Windows : npm est un .cmd que Node refuse de spawn sans shell — on lance donc
// directement npm-cli.js avec le Node courant (installation officielle de Node).
// Autres OS : npm est un script exécutable, spawn direct sans shell.
let res
const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
if (process.platform === "win32" && existsSync(npmCli)) {
  res = spawnSync(process.execPath, [npmCli, "install"], { stdio: "inherit", cwd: webDir })
} else {
  res = spawnSync("npm", ["install"], { stdio: "inherit", cwd: webDir })
}
if (res.error) {
  console.error(res.error)
  process.exit(1)
}
if (res.status !== 0) process.exit(res.status ?? 1)

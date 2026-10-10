// npm 11 bloque par défaut les scripts d'installation des dépendances : le CLI
// OpenCode ne choisit alors pas le binaire de son processeur. Ce script (lancé
// par le postinstall du projet, donc à chaque `npm install`) exécute cette
// étape lui-même. Il est idempotent.
// v10.0.0 : la partie Electron (téléchargement du binaire ~100 Mo + extraction
// de secours) a été retirée avec le shell — il ne reste que ce binaire CLI.
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const cliDir = path.join(root, "node_modules", "@opencode", "cli")
const postinstall = path.join(cliDir, "postinstall.mjs")

if (!existsSync(postinstall)) {
  console.error(`✗ CLI OpenCode : ${postinstall} introuvable (npm install incomplet ?)`)
  process.exit(1)
}

console.log("→ CLI OpenCode (choisit le binaire de ton processeur)")
execFileSync(process.execPath, [postinstall], { stdio: "inherit", cwd: cliDir })
console.log("✓ CLI OpenCode prête.")

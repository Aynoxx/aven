// vendor-xterm.mjs — provenance des fichiers VENDORÉS du terminal natif.
// Les fichiers sous native/src/Aven.Native/Assets/terminal/vendor/ sont COMMITÉS
// (le build MSIX ne dépend pas de npm). Relancer ce script UNIQUEMENT après une
// montée de version de @xterm/xterm, puis commiter le résultat.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const xterm = path.join(racine, "node_modules", "@xterm", "xterm")
const fit = path.join(racine, "node_modules", "@xterm", "addon-fit")
const sortie = path.join(racine, "native", "src", "Aven.Native", "Assets", "terminal", "vendor")

const version = JSON.parse(readFileSync(path.join(xterm, "package.json"), "utf8")).version
if (version !== "5.5.0") {
  throw new Error(`@xterm/xterm ${version} inattendu : la décision §5.1 du protocole fixe 5.5.0 — ajuster la version ET relire les notes (thème, globals UMD) avant de vendorer.`)
}

mkdirSync(sortie, { recursive: true })
copyFileSync(path.join(xterm, "lib", "xterm.js"), path.join(sortie, "xterm.js"))
copyFileSync(path.join(xterm, "css", "xterm.css"), path.join(sortie, "xterm.css"))
copyFileSync(path.join(fit, "lib", "addon-fit.js"), path.join(sortie, "addon-fit.js"))
console.log("xterm 5.5.0 vendored ->", sortie)

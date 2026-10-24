import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v10.4.0 : les sondes vérifiaient App.tsx et App.css monolithiques. Le code vit
// désormais dans app/ et pages/, les styles dans styles/*.css. Plutôt que de réécrire
// chaque assertion (elles décrivent un comportement, pas un fichier), on leur donne la
// MÊME source agrégée, dans un ordre stable. Une assertion de présence reste vraie ;
// une assertion de proximité continue de vivre dans le fichier où le code a été écrit.
// v10.4.0 : l'agrégat se construit du dépôt (pipeline d'imports CSS, dossiers app/ et
// pages/) — une page ou une feuille ajoutée demain est couverte sans toucher aux sondes.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (p) => readFileSync(path.join(ROOT, p), "utf8")

// Ordre = ordre d'import d'App.css : c'est la cascade réelle, pas une liste recopiée.
export function readStyles() {
  const barrel = read("web/src/App.css")
  const imported = [...barrel.matchAll(/@import\s+"\.\/(styles\/[^"]+\.css)";/g)].map((m) => `web/src/${m[1]}`)
  const files = imported.length
    ? imported
    : readdirSync(path.join(ROOT, "web/src/styles")).filter((f) => f.endsWith(".css")).sort().map((f) => `web/src/styles/${f}`)
  return files.map(read).join("\n")
}

// Ordre = shell → application → pages : les fonctions de navigation et le shell
// restent adjacents, les pages suivent leurs propres invariants.
const list = (dir, pattern) =>
  readdirSync(path.join(ROOT, dir))
    .filter((f) => pattern.test(f))
    .sort()
    .map((f) => `${dir}/${f}`)

export function readApp() {
  // v11.0.0 : le Poste a déplacé la coquille et les instruments dans workbench/ —
  // l'agrégat les inclut, sinon une assertion de présence manquerait du code vivant.
  const files = [
    "web/src/App.tsx",
    ...list("web/src/app", /\.(?:ts|tsx)$/),
    ...list("web/src/pages", /\.tsx$/),
    ...list("web/src/workbench", /\.tsx$/),
  ]
  return files.map(read).join("\n")
}

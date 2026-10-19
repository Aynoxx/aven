import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Sonde de la DOCUMENTATION (AGENTS.md §11/§14 — anciennement RULES.md) : AGENTS.md
// et README.md décrivent le projet ; ce script vérifie que ce qu'ils affirment
// reste vrai. Sans elle, la doc
// dérive en silence — elle a déjà cité deux modules morts comme modèles à copier et
// annoncé des compteurs faux. Style identique aux autres sondes : une assertion = une
// règle, message en français, aucune dépendance hors `node:*`.
//
// AVEN_DOCS_ROOT permet de pointer une copie (auto-test : une doc falsifiée doit
// faire échouer la sonde).

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const root = process.env.AVEN_DOCS_ROOT ? path.resolve(process.env.AVEN_DOCS_ROOT) : defaultRoot
const read = (p) => readFileSync(path.join(root, p), "utf8")
const exists = (p) => existsSync(path.join(root, p))

// RULES.md a été fondu dans AGENTS.md (2026-10-18) : les deux noms de variable
// pointent vers le fichier unique, toutes les assertions ci-dessous restent actives.
const rules = read("AGENTS.md")
const agents = rules
const readme = read("README.md")
const pkg = JSON.parse(read("package.json"))

// ── Règle 1 : les sections canoniques survivent ─────────────────────────────────
// Les autres sondes assertent des titres précis (## 4. Boutons, ## 5. Icônes…) et
// AGENTS.md porte le contrat d'exécution : une refonte ne peut pas les effacer.
assert.match(rules, /^# AGENTS\.md — Aven/m, "AGENTS.md : le titre canonique doit rester")
// §0 (boucle obligatoire) retiré et §10 (modèles) fondue dans §9 par le tri du
// 2026-10-18 : la liste ci-dessous ne couvre que les sections encore présentes.
for (const n of ["2", "4", "5", "7", "8", "11", "12", "13", "14"]) {
  assert.match(rules, new RegExp(`^## ${n}\\. `, "m"),
    `AGENTS.md §${n} : la section canonique doit rester en place (d'autres sondes l'ancrent).`)
}
for (const heading of ["## Choisis ton parcours", "## Définition de terminé", "## Compte rendu obligatoire", "## Périmètre et arrêts"]) {
  assert.ok(agents.includes(heading),
    `AGENTS.md : le bloc « ${heading} » fait partie du contrat d'exécution — ne le supprime pas.`)
}
assert.match(agents, /Lis ce fichier AVANT/,
  "AGENTS.md : la porte d'entrée (« Lis ce fichier AVANT ») doit rester")
// La clause de conflit (« RULES.md fait foi ») a disparu avec le second fichier :
// son équivalent contractuel survivant est la règle d'amendement règle+sonde.
assert.match(agents, /Amender une règle/,
  "AGENTS.md : la règle d'amendement (règle ET sa sonde dans le même changement) doit rester")
assert.match(rules, /^## 14\. Artefacts de travail/m, "AGENTS.md §14 : les artefacts de travail ont leur section")

// ── Règle 2 : toute référence citée existe réellement ───────────────────────────
// Une doc qui cite un fichier fantôme envoie l'agent suivant dans le mur.
const REF_PATTERNS = [
  /\bhost\/[A-Za-z0-9_-]+\.ts\b/g,
  /\bweb\/src\/[A-Za-z0-9_./-]+\.(?:ts|tsx|css)\b/g,
  /\bscripts\/[A-Za-z0-9_.-]+\.mjs\b/g,
  /\bsrc-tauri\/[A-Za-z0-9_./-]+\.(?:rs|json|toml)\b/g,
]
const refs = new Map() // chemin → document qui le cite
for (const [doc, text] of [["AGENTS.md", rules], ["README.md", readme]]) {
  for (const re of REF_PATTERNS) {
    for (const m of text.matchAll(re)) if (!refs.has(m[0])) refs.set(m[0], doc)
  }
}
for (const [ref, doc] of refs) {
  assert.ok(exists(ref),
    `Règle « exemple vivant » (AGENTS.md §7) : ${doc} cite « ${ref} », qui n'existe pas. Corrige la doc ou le fichier.`)
}

// ── Règle 3 : tout module host cité est réellement importé ──────────────────────
// Les points d'entrée déclarés au build sont des racines légitimes (personne ne les
// importe) ; tout autre module cité comme modèle doit avoir au moins un importeur.
const buildScript = read("scripts/build-engine-host.mjs")
const entryPoints = new Set([...buildScript.matchAll(/in:\s*"([^"]+)"/g)].map((m) => m[1]))

const walk = (dir) =>
  readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`
    return entry.isDirectory() ? walk(rel) : [rel]
  })
const sources = [...walk("host"), ...walk("web/src")].filter((p) => /\.(ts|tsx)$/.test(p))

// Un importeur = un fichier source qui importe ou ré-exporte le module (chemin relatif).
const importersOf = (name) => {
  const bare = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`(?:from|import)\\s*["'][^"']*/${bare}(?:\\.js)?["']`)
  return sources.filter((file) => file !== `host/${name}.ts` && re.test(read(file)))
}

for (const ref of refs.keys()) {
  const name = ref.match(/^host\/([A-Za-z0-9_-]+)\.ts$/)?.[1]
  if (!name || entryPoints.has(ref)) continue
  assert.ok(importersOf(name).length > 0,
    `Règle « exemple vivant » (AGENTS.md §7) : ${refs.get(ref)} cite host/${name}.ts comme référence, ` +
    `mais aucun module ne l'importe. Ne cite pas du code mort : supprime-le ou marque-le legacy.`)
}

// ── Règle 4 : la chaîne npm run verify est réelle ───────────────────────────────
// Chaque sonde de la chaîne existe, la version courante y entre, verify-docs aussi.
const chain = pkg.scripts?.verify ?? ""
for (const m of chain.matchAll(/scripts\/[A-Za-z0-9_.-]+\.mjs/g)) {
  assert.ok(exists(m[0]), `package.json : la chaîne npm run verify appelle « ${m[0]} », absent du disque.`)
}
const current = `scripts/verify-v${pkg.version}.mjs`
assert.ok(exists(current), `la sonde de la version courante (${current}) doit exister (AGENTS.md §11).`)
assert.ok(chain.includes(path.basename(current)),
  `npm run verify doit inclure ${path.basename(current)} (AGENTS.md §11).`)
assert.ok(chain.includes("verify-docs.mjs"),
  "npm run verify doit inclure verify-docs.mjs : la doc se vérifie comme le code (AGENTS.md §11).")

// ── Règle 5 : aucun compteur recopié à la main ──────────────────────────────────
// Les chiffres de la doc dérivent dès qu'on ajoute un test ou un aria-label. Un
// compteur vit dans une sonde qui le mesure, jamais dans la prose.
for (const [doc, text] of [["AGENTS.md", rules]]) {
  assert.ok(!/\b\d+\s*`aria-label`/.test(text),
    `${doc} : compteur « N \`aria-label\` » interdit — mesure-le dans une sonde ou retire le nombre (AGENTS.md §11).`)
  assert.ok(!/\b\d+\+?\s+(?:tests?|sondes?)\b/i.test(text),
    `${doc} : compteur manuel de tests/sondes interdit — il dérive à chaque ajout (AGENTS.md §11).`)
}

// ── Règle 6 : vocabulaire unique host/renderer ──────────────────────────────────
// Le shell Electron n'existe plus : « main/renderer » entretient une confusion morte.
for (const [doc, text] of [["AGENTS.md", agents], ["README.md", readme]]) {
  assert.ok(!text.includes("main/renderer"),
    `${doc} : « main/renderer » est périmé — écris « host/renderer » (AGENTS.md §7).`)
}

// ── Règle 7 : audits rangés et nommés ───────────────────────────────────────────
// AGENTS.md §14 : un audit vit dans docs/audits/AAAA-MM-JJ-sujet.md, rien à la racine.
assert.match(rules, /docs\/audits\//, "AGENTS.md §14 : l'emplacement des audits doit rester documenté")
assert.ok(exists("docs/audits"), "docs/audits/ doit exister (AGENTS.md §14)")
for (const file of readdirSync(path.join(root, "docs/audits"))) {
  if (!file.endsWith(".md")) continue
  assert.match(file, /^\d{4}-\d{2}-\d{2}-[a-z0-9.-]+\.md$/,
    `docs/audits/${file} : nom attendu AAAA-MM-JJ-sujet.md en minuscules (tirets, points de version admis — AGENTS.md §14).`)
}
const strays = readdirSync(root).filter((f) => /^REVIEW-.*\.md$/.test(f))
assert.equal(strays.length, 0,
  `Audit(s) à la racine : ${strays.join(", ")} — déplace-les dans docs/audits/ (AGENTS.md §14).`)

console.log("docs (AGENTS.md/README.md) : OK")

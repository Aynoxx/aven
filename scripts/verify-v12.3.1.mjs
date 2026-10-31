import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v12.3.1 : passe de finition de l'accueil. La composition validée ne bouge plus —
// ce sont les DÉTAILS qui deviennent des règles, dans l'ordre du risque :
//   A. « Reprendre » : trois colonnes FIXÉES par nature, métadonnées sur une seule
//      ligne groupée, nature absente dite en clair — jamais fabriquée ;
//   B. les actions rapides tiennent sur une rangée compacte, et la délégation
//      appartient à la ligne d'état du micro au lieu de flotter seule ;
//   C. la sphère garde son asymétrie, mais son terminateur n'est plus une marche et
//      le maillage reste lisible sur toute la surface ;
//   D. le fond s'efface sans disparaître, et la fenêtre étroite garde la bande
//      horizontale au lieu de laisser la sphère déborder dessus.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const cargo = read("src-tauri/Cargo.toml")
const home = read("web/src/workbench/HomeStage.tsx")
const resume = read("web/src/workbench/resume.ts")
const css = read("web/src/styles/workbench.css")
const agent = read("web/src/agent/WireframeAgent.tsx")
const readme = read("README.md")

// ── A. Version et enregistrement ───────────────────────────────────────────
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.equal(pkg.scripts["verify:v12.3.1"], "node scripts/verify-v12.3.1.mjs", "la sonde a son entrée npm")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v12.3.1.mjs"), "npm run verify inclut la sonde v12.3.1")
// La version est lue dans package.json : une sonde qui fige SON numéro casse au
// bump suivant et n'apprend rien. Ce qui compte, c'est que la doc suive le dépôt.
const version = pkg.version.replaceAll(".", "\\.")
assert.match(readme, new RegExp(`^# Aven v${version}$`, "m"), "README annonce la version courante")
assert.match(readme, new RegExp(`v${version} — `), "README porte la note de la version courante")

// ── B. Trois colonnes de largeur stable, entrées réelles dans l'ordre ─────
// L'ordre reste un contrat, mais une nature absente ne doit plus créer de case
// artificielle : les entrées sont filtrées puis rendues dans leur ordre de nature.
const kindOrder = [
  resume.indexOf('kind: "conversation"'),
  resume.indexOf('kind: "note"'),
  resume.indexOf('kind: "file"'),
]
assert.ok(kindOrder.every((index) => index >= 0), "les trois natures existent")
assert.ok(kindOrder[0] < kindOrder[1] && kindOrder[1] < kindOrder[2], "l'ordre reste conversation → note → fichier")
assert.match(home, /entries\.map\(\(entry\) => \{/, "la bande rend les entrées réellement disponibles")
assert.ok(!home.includes("SLOTS"), "aucune cellule vide n'est fabriquée")
assert.ok(!home.includes("Rien pour l’instant"), "aucun faux libellé ne remplit une colonne")
assert.match(css, /\.wb-home-resume-list \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/, "les trois colonnes conservent leur largeur stable")
// Une seule ligne de métadonnées, groupée : l'âge reste auprès de la nature.
const ageRule = css.match(/\.wb-home-cell-age \{[^}]*\}/)?.[0] ?? ""
assert.ok(ageRule, "l'âge a sa règle")
assert.ok(!/margin-left: auto/.test(ageRule), "l'âge reste auprès de la nature, pas poussé au bord droit")
assert.match(home, /<span className="wb-home-cell-age">· \{ageLabel\(entry\.updated, now\)\}<\/span>/, "l'âge est séparé par un point médian, dans la même ligne")
// Une note dont le corps ne dit rien de plus que son titre n'est pas un travail :
// c'était le cas réel « sans contenu avec comme nom importation » de la revue.
assert.match(resume, /return excerpt !== "" && excerpt\.toLowerCase\(\) !== note\.title\.toLowerCase\(\)/,
  "une note qui récite son titre n'est jamais proposée en reprise")

// ── C. Actions compactes, délégation dans l'état de session ────────────────
const actionRule = css.match(/\n\.wb-home-action \{[^}]*\}/)?.[0] ?? ""
// AMENDEMENT v12.5.0 : les trois actions deviennent des COMMANDES de barre d'outils
// et gagnent le filet du chrome (1 px de bordure de chaque côté). L'invariant
// conservé est la hauteur COMPACTE de la rangée — un cadre, pas une pile de boutons.
const actionHeight = Number(actionRule.match(/min-height: (\d+)px/)?.[1] ?? 0)
assert.ok(actionHeight >= 24 && actionHeight <= 28,
  `une action rapide reste une commande compacte (mesuré : ${actionHeight}px, plafond 28)`)
assert.match(css, /\.wb-home-actions \{[^}]*flex-wrap: wrap/, "les actions tiennent sur une rangée qui se replie seulement au besoin")
assert.match(css, /\.wb-home-id \{[^}]*width: 100%/, "la colonne d'identité n'étrangle plus les actions")
const voiceAt = home.indexOf('className="wb-home-voice"')
const modeAt = home.indexOf('className="wb-home-mode"')
const actionsAt = home.indexOf('className="wb-home-actions"')
assert.ok(voiceAt > 0 && modeAt > voiceAt && modeAt < actionsAt,
  "« Délégation · … » vit dans la ligne d'état du micro, plus sous les actions")
assert.match(css, /\.wb-home-mode \{[^}]*border-left: 1px solid var\(--border\)/, "elle est séparée de l'état par un filet, un seul statut par ligne")
// L'état affiché vient de la session réelle : micro coupé, et un seul libellé.
assert.match(home, /\{error \?\? voice\.label\}/, "l'état vocal vient de la session, pas d'un texte local")
assert.equal(home.match(/className="wb-home-status"/g)?.length, 1, "un seul statut vocal sur l'accueil")

// ── D. Sphère : la motion reste gouvernée par la phase ────────────────────
// v12.4.0 a remplacé la calotte opaque par un maillage géodésique : les assertions
// qui décrivaient CETTE calotte sont retirées avec elle (AGENTS.md §11). Ce qui
// survit ici est la règle de mouvement, que la refonte ne change pas.
assert.match(agent, /const animate = !reduced\.matches && !document\.hidden && energy\.spin > 0/, "la rotation reste gouvernée par la phase réelle")

// ── E. Fond et fenêtre étroite ────────────────────────────────────────────
assert.match(css, /:root\[data-theme="light"\] \.wb-home-trace \{ opacity: \.24; \}/, "la diagonale s'efface encore en thème clair")
const narrow = css.slice(css.indexOf("@media (max-width: 720px)"))
assert.ok(narrow.length > 0, "le palier étroit existe")
assert.match(narrow, /\.wb-home-resume-list \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/,
  "à fenêtre étroite la bande reste horizontale : trois colonnes")
assert.match(narrow, /\.wb-home-cell-excerpt \{ display: none; \}/, "l'extrait cède la place au titre et à l'âge")
assert.match(narrow, /\.wb-home-agent \{ width: min\(38vh, 260px\)/, "la sphère reste dans sa rangée au lieu de déborder sur la bande")

console.log("v12.3.1 verification: OK (colonnes fixes, métadonnées groupées, actions compactes, sphère adoucie)")

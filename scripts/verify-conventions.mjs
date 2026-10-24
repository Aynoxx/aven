import { readStyles } from "./lib/sources.mjs"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Sonde des RÈGLES UNIVERSELLES (voir AGENTS.md, fusion de RULES.md) : ce script vérifie que
// les conventions du projet restent vraies dans le code, indépendamment de qui modifie.
// Chaque assertion cite la règle qu'elle verrouille. Les valeurs autorisées listées
// ici sont les exceptions LÉGITIMES déjà présentes ; toute NOUVELLE infraction fait
// échouer `npm run verify` et devra être justifiée (ou ajoutée aux exceptions avec
// une raison, dans ce fichier, comme les autres).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const css = readStyles()
const icon = read("web/src/icons/Icon.tsx")
const iconReadme = read("web/src/icons/README.md")
// RULES.md a été fondu dans AGENTS.md (2026-10-18) : les deux lectures pointent
// vers le fichier unique, les assertions restent identiques.
const rules = read("AGENTS.md")
const agents = rules

// ── Règle 1 : la porte d'entrée existe et pointe au bon endroit ──────────────────
assert.match(rules, /# AGENTS\.md — Aven/)
assert.match(rules, /## 4\. Boutons/)
assert.match(rules, /## 5\. Icônes/)
assert.match(rules, /## 2\. Typographie/)
assert.match(agents, /Lis ce fichier AVANT/)

// ── Règle 2 : typographie par tokens (aucune px de police en dur) ────────────────
// Chaque déclaration font-size doit passer par var(--font-size-*), y compris comme
// borne d'un clamp — un littéral px (même de valeur identique à un token) viole la
// règle : seules les DÉFINITIONS de :root portent des px.
const fontSizeValues = [...css.matchAll(/(?<![-\w])font-size:\s*([^;}]+)/g)].map((m) => m[1].trim())
const fontSizeOffenders = fontSizeValues
  .map((v) => ({ v, px: v.replace(/var\(--font-size-\w+\)/g, "").match(/\d+px/) }))
  .filter((o) => o.px !== null)
assert.equal(fontSizeOffenders.length, 0,
  `Règle « Typographie par tokens » (AGENTS.md §2) : px en dur dans font-size : ${fontSizeOffenders.map((o) => `« ${o.v} »`).join(", ")}. Utilise var(--font-size-xs|sm|md|lg|xl|2xl|3xl).`)

// ── Règle 2bis : graisses de l'échelle (AGENTS.md §2) ────────────────────────────
// 400–500 courant, 600 semi-gras, 680 boutons, 700–800 titres — rien d'autre.
const weightValues = [...css.matchAll(/(?<![-\w])font-weight:\s*([^;}]+)/g)].map((m) => m[1].trim())
const allowedWeights = new Set(["400", "500", "600", "680", "700", "800"])
for (const w of weightValues) {
  assert.ok(allowedWeights.has(w),
    `Règle « Typographie par tokens » (AGENTS.md §2) : font-weight « ${w} » hors échelle {400,500,600,680,700,800}.`)
}

// ── Règle 2ter : rayons par tokens (AGENTS.md §3) ────────────────────────────────
// Seuls var(--radius-*) et 50% (cercles parfaits : pastilles, avatars) sont admis.
const radiusValues = [...css.matchAll(/(?<![-\w])border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim())
for (const r of radiusValues) {
  const rest = r.replace(/var\(--radius-\w+\)/g, "").trim()
  // v11.0.0 : « 0 » est admis — remise à zéro explicite d'un élément système
  // (pouce de scrollbar du Poste), pas un rayon inventé.
  assert.ok(rest === "" || rest === "50%" || rest === "0",
    `Règle « Rayons » (AGENTS.md §3) : border-radius « ${r} » hors tokens --radius-* — utilise var(--radius-xs|sm|md|lg|xl|pill).`)
}

// Idem pour font-family : seule la pile système du token --font-ui se déclare
// (v10.2.0 M1 : system-ui / Segoe UI — la pile Inter n'est plus la référence).
const fontFamilies = [...css.matchAll(/font-family:\s*([^;]+);/g)].map((m) => m[1].trim())
for (const f of fontFamilies) {
  // v11.0.0 : le Poste a DEUX voix typographiques — --font-ui (texte, pile système)
  // et --font-mono (télémétrie, micro-libellés). Aucune police téléchargée.
  assert.ok(/var\(--font-ui\)|var\(--font-mono\)|^system-ui/.test(f),
    `Règle « Typographie par tokens » (AGENTS.md §2) : font-family non standard « ${f} ». Utilise var(--font-ui) (pile système : system-ui, "Segoe UI", sans-serif) ou var(--font-mono).`)
}

// ── Règle 3 : les icônes passent toutes par la bibliothèque centralisée ──────────
assert.match(icon, /export type IconName =/)
assert.match(iconReadme, /Ajouter une nouvelle icône dans le type `IconName`/)
// Aucun composant n'embarque son propre <svg> local (l'unique <svg> est celui d'Icon.tsx).
// v9.3.0 : NotesView.tsx remplace NotesDialog.tsx, FilesView.tsx arrive — la règle
// « un seul <svg> (Icon.tsx) » s'applique aux nouvelles vues aussi.
// v10.3.0 : découverte DYNAMIQUE des composants — une liste écrite à la main laissait
// échapper tout nouveau fichier (NoteEditor, PageShell…) aux règles icônes / ARIA /
// boutons. Seul Icon.tsx est exclu : c'est la bibliothèque elle-même.
const jsxFiles = readdirSync(path.join(root, "web/src"))
  .filter((file) => file.endsWith(".tsx") && file !== "Icon.tsx")
  .map((file) => `web/src/${file}`)
for (const f of jsxFiles) {
  const content = read(f)
  assert.ok(!/<svg[\s>]/.test(content),
    `Règle « Icônes » (AGENTS.md §5) : <svg> local détecté dans ${f}. Utilise <Icon name="…" /> (web/src/icons/Icon.tsx).`)
}

// ── Règle 4 : les boutons utilisent le système de classes ────────────────────────
// Toute classe `button` d'un bouton du renderer commence par "button " (base commune).
// Sonde légère : la classe .button doit exister et servir de base aux variantes.
assert.match(css, /^\.button \{ /m, "le système de boutons (AGENTS.md §4) doit rester défini sur la classe .button de base")
for (const variant of ["primary", "secondary", "ghost", "danger"]) {
  assert.match(css, new RegExp(`^\\.button\\.${variant} \\{`, "m"), `variante .button.${variant} attendue (AGENTS.md §4)`)
}

// ── Règle 5 : les secrets ne quittent jamais le host ni le renderer ─────────────
// v10.0.0 : plus de preload — l'équivalent est l'API Tauri (web/src/api-tauri.ts),
// qui ne fait que de l'invocation ; aucun champ de type clé ne doit y transiter.
const bridge = read("web/src/api-tauri.ts")
assert.ok(!/(apiKey|api_key|secret|password)\s*[:=]/i.test(bridge),
  "Règle « Secrets » (AGENTS.md §7) : l'API Tauri ne doit contenir aucune valeur de clé/secret.")
// Le renderer ne référence aucune clé littérale d'API.
for (const f of jsxFiles) {
  const content = read(f)
  assert.ok(!/(sk-[A-Za-z0-9]{8,}|Bearer\s+[A-Za-z0-9_\-]{20,})/.test(content),
    `Règle « Secrets » (AGENTS.md §7) : littéral ressemblant à une clé détecté dans ${f}.`)
}

// ── Règle 6 : écritures de fichiers atomiques côté main ──────────────────────────
// writeFileSync est réservé aux exports choisis PAR l'utilisateur (dialogue de
// sauvegarde) et au fichier temporaire d'atomic-file.ts — pas aux données internes.
const atomic = read("host/atomic-file.ts")
assert.match(atomic, /export function writeTextAtomic/, "atomic-file.ts doit rester la porte d'écriture (AGENTS.md §7)")

// ── Règle 7 : sécurité de la fenêtre — ne jamais affaiblir ───────────────────────
// v10.0.0 : la fenêtre est une webview Tauri (contextIsolation/sandbox n'existent
// plus) — l'équivalent verrouillé est la CSP de tauri.conf.json.
const tauriConf = JSON.parse(read("src-tauri/tauri.conf.json"))
const csp = tauriConf?.app?.security?.csp ?? ""
assert.ok(csp.startsWith("default-src 'self';"),
  "la CSP Tauri doit rester strictement « self » par défaut (AGENTS.md §7)")
assert.ok(!/unsafe-eval/.test(csp), "unsafe-eval ne doit jamais entrer dans la CSP (AGENTS.md §7)")

// ── Règle 8 : le module tool-guard du gabarit reste branché ──────────────────────
// La discipline des outils agents (garde anti-boucle glob) est une convention du projet.
const guard = read(".opencode/plugins/aven-tool-guard.js")
assert.match(guard, /aven\.tool-guard/)

// ── Règle 9 (AGENTS.md §12) : accessibilité — aria, focus, mouvement ────────────
const a11y = rules.includes("## 12. Accessibilité")
assert.ok(a11y, "la section Accessibilité d'AGENTS.md doit rester en place")

// 9a. Le socle focus visible et le bloc reduced-motion restent dans App.css.
assert.match(css, /:focus-visible \{ outline: 2px solid var\(--accent\); outline-offset: 2px;? \}/,
  "Règle « Focus visible » (AGENTS.md §12.2) : le outline :focus-visible global ne doit pas disparaître")
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/,
  "Règle « Mouvement » (AGENTS.md §12.4) : le bloc prefers-reduced-motion ne doit pas disparaître")

// 9b (durci v10.2.0 — E4) : aucun outline supprimé sans indice de focus STRUCTUREL.
// Le simple test de nom de classe (« .composer », « .search »…) acceptait un champ
// sans aucun signal de focus : la sonde exige désormais la PAIRE — soit le sélecteur
// lui-même porte :focus*, soit le CSS contient une règle compagne partageant la même
// racine (première classe) ET signalant le focus (:focus-within / :focus-visible /
// :focus( / classe -focused). outline: none est couvert au même titre que outline: 0.
const outlineNoneContexts = [...css.matchAll(/([^{}\n]+)\{[^{}]*outline:\s*(?:0|none);[^{}]*\}/g)]
const cssSelectors = [...css.matchAll(/([^{}\n]+)\{/g)].map((m) => m[1].trim())
const focusSignal = /:(?:focus-within|focus-visible|focus\()|-focused/
for (const [, selector] of outlineNoneContexts) {
  const sel = selector.trim()
  if (/:focus/.test(sel)) continue // l'élément se signale lui-même (déclaration inline)
  const root = sel.match(/\.[A-Za-z][\w-]*/)?.[0]
  assert.ok(root,
    `Règle « Focus visible » (AGENTS.md §12.2) : outline supprimé sur « ${sel} » sans classe racine à apparier — pose un signaleur :focus-within sur le conteneur.`)
  const companion = cssSelectors.some((s) => s.includes(root) && focusSignal.test(s))
  assert.ok(companion,
    `Règle « Focus visible » (AGENTS.md §12.2) : outline supprimé sur « ${sel} » sans indice de focus associé — pose une règle compagne « ${root}:focus-within » (border/box-shadow accent), comme .composer et .search-wrap.`)
}

// 9c. Tout role="dialog" porte aria-modal et un aria-label nommant le contenu.
for (const f of jsxFiles) {
  const content = read(f)
  for (const m of content.matchAll(/role="dialog"/g)) {
    const start = m.index ?? 0
    const tagStart = content.lastIndexOf("<", start)
    const tagEnd = content.indexOf(">", start)
    const tag = content.slice(tagStart, tagEnd)
    assert.match(tag, /aria-modal="true"/,
      `Règle « Dialogues » (AGENTS.md §12.1) : role="dialog" sans aria-modal="true" dans ${f}`)
    assert.match(tag, /aria-label=/,
      `Règle « Dialogues » (AGENTS.md §12.1) : role="dialog" sans aria-label dans ${f}`)
  }
}

// 9d. Tout bouton STRICTEMENT icône (pas de texte après fermeture du tag) porte un aria-label.
for (const f of jsxFiles) {
  const content = read(f)
  for (const m of content.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)) {
    const attrs = m[1]
    const inner = m[2].replace(/<[a-zA-Z][^>]*>[\s\S]*?<\/[a-zA-Z]+>/g, "").replace(/<[^>]+>/g, "").trim()
    if (inner.length === 0 && /<Icon\s/.test(m[2])) {
      assert.match(attrs, /aria-label=/,
        `Règle « Noms accessibles » (AGENTS.md §12.1) : bouton icône seul sans aria-label dans ${f} — « ${attrs.trim().slice(0, 80)} »`)
    }
  }
}

// 9e. Le scope Icon.tsx reste : aria-hidden par défaut, currentColor conservé.
assert.match(icon, /aria-hidden=\{ariaHidden \?\? !title\}/,
  "Icon.tsx : l'aria-hidden par défaut (décoratif) doit rester")
assert.match(icon, /stroke="currentColor"/,
  "Icon.tsx : currentColor doit rester (héritage thème/accent, AGENTS.md §5)")

// 9f. Navigation clavier des listes du hub (v9.1.6) : logique pure testée + branchée.
const arrowNav = read("web/src/arrow-navigation.ts")
assert.match(arrowNav, /export function nextArrowIndex/,
  "la logique des flèches doit rester dans le module pur arrow-navigation.ts (AGENTS.md §8)")
assert.match(arrowNav, /Pur|sans React/i,
  "arrow-navigation.ts reste un module pur, testable sans React")
assert.ok(read("tests/arrow-navigation.test.mjs").includes("nextArrowIndex"),
  "le module arrow-navigation doit garder ses tests")
// v11.0.0 : le hub et ses listes ont disparu avec le Poste. La liste de résultats
// qui reste — la barre de commande — DOIT garder le même contrat de flèches ;
// la barre d'onglets a son équivalent horizontal testé (nextTabFocus).
const commandBar = read("web/src/workbench/CommandBar.tsx")
const tabBar = read("web/src/workbench/WorkbenchShell.tsx")
const tabModel = read("web/src/workbench/tabs.ts")
assert.match(commandBar, /nextArrowIndex\(e\.key, active, results\.length\)/,
  "la barre de commande branche la navigation flèches (module pur)")
assert.match(tabBar, /nextTabFocus\(e\.key, index, tabsState\.tabs\.length\)/,
  "la barre d'onglets écoute les flèches horizontales")
assert.match(tabModel, /export function nextTabFocus/,
  "la logique horizontale vit dans le module pur tabs.ts")
assert.ok(read("tests/workbench-tabs.test.mjs").includes("nextTabFocus"),
  "nextTabFocus garde son test .test.mjs")

// 10. Une sonde ne survit pas à son sujet (2026-10-23). Neuf scripts verify-v8.7.x
// lisaient host/main.ts (supprimé en v10.0.0) et figeaient une version révolue :
// aucun n'était dans la chaîne, donc aucun ne pouvait échouer. La règle devient
// mesurable : toute sonde présente dans scripts/ est branchée dans `npm run verify`.
const pkgScripts = JSON.parse(read("package.json")).scripts
const verifyChain = new Set([...pkgScripts.verify.matchAll(/scripts\/(verify-v[\d.]+\.mjs)/g)].map((m) => m[1]))
const probeFiles = readdirSync(path.join(root, "scripts")).filter((f) => /^verify-v[\d.]+\.mjs$/.test(f))
for (const probe of probeFiles) {
  assert.ok(verifyChain.has(probe), `sonde orpheline : scripts/${probe} n'est pas appelée par « npm run verify »`)
}
for (const probe of verifyChain) {
  assert.ok(probeFiles.includes(probe), `sonde fantôme : scripts/${probe} est appelée mais absente du dépôt`)
}

console.log("conventions (AGENTS.md) : OK")

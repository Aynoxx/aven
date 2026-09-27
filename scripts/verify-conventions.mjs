import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Sonde des RÈGLES UNIVERSELLES (voir RULES.md et AGENTS.md) : ce script vérifie que
// les conventions du projet restent vraies dans le code, indépendamment de qui modifie.
// Chaque assertion cite la règle qu'elle verrouille. Les valeurs autorisées listées
// ici sont les exceptions LÉGITIMES déjà présentes ; toute NOUVELLE infraction fait
// échouer `npm run verify` et devra être justifiée (ou ajoutée aux exceptions avec
// une raison, dans ce fichier, comme les autres).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const css = read("web/src/App.css")
const icon = read("web/src/icons/Icon.tsx")
const iconReadme = read("web/src/icons/README.md")
const rules = read("RULES.md")
const agents = read("AGENTS.md")
const app = read("web/src/App.tsx")
const main = read("electron/main.ts")

// ── Règle 1 : la porte d'entrée existe et pointe au bon endroit ──────────────────
assert.match(rules, /# Règles universelles du projet Aven/)
assert.match(rules, /## 4\. Boutons/)
assert.match(rules, /## 5\. Icônes/)
assert.match(rules, /## 2\. Typographie/)
assert.match(agents, /Lis `RULES\.md` AVANT/)

// ── Règle 2 : typographie par tokens (aucune px de police en dur) ────────────────
// Les seules `font-size: Npx` tolérées sont celles qui DÉFINISSENT les tokens dans
// :root (source de vérité). Aucune autre déclaration directe n'est permise.
const fontSizeDeclarations = [...css.matchAll(/font-size:\s*([\d.]+px)/g)].map((m) => `font-size: ${m[1]}`)
const tokenDefinitions = [...css.matchAll(/--font-size-\w+:\s*([\d.]+px)/g)].map((m) => `font-size: ${m[1]}`)
const tolerated = new Set(tokenDefinitions)
const offenders = fontSizeDeclarations.filter((d) => !tolerated.has(d))
assert.equal(offenders.length, 0,
  `Règle « Typographie par tokens » (RULES.md §2) : font-size en dur détecté hors définition des tokens : ${offenders.join(", ")}. Utilise var(--font-size-xs|sm|md|lg|xl|2xl).`)

// Idem pour font-family : Inter ne se déclare que dans :root et sur body/boutons/champs.
const fontFamilies = [...css.matchAll(/font-family:\s*([^;]+);/g)].map((m) => m[1].trim())
for (const f of fontFamilies) {
  assert.ok(/var\(--font-ui\)|Inter, sans-serif/.test(f),
    `Règle « Typographie par tokens » (RULES.md §2) : font-family non standard « ${f} ». Utilise var(--font-ui).`)
}

// ── Règle 3 : les icônes passent toutes par la bibliothèque centralisée ──────────
assert.match(icon, /export type IconName =/)
assert.match(iconReadme, /Ajouter une nouvelle icône dans le type `IconName`/)
// Aucun composant n'embarque son propre <svg> local (l'unique <svg> est celui d'Icon.tsx).
const jsxFiles = ["web/src/App.tsx", "web/src/SettingsDialog.tsx", "web/src/NotesDialog.tsx", "web/src/FormDialog.tsx", "web/src/MessageBubble.tsx", "web/src/Markdown.tsx", "web/src/RichMarkdown.tsx", "web/src/ErrorBoundary.tsx"]
for (const f of jsxFiles) {
  const content = read(f)
  assert.ok(!/<svg[\s>]/.test(content),
    `Règle « Icônes » (RULES.md §5) : <svg> local détecté dans ${f}. Utilise <Icon name="…" /> (web/src/icons/Icon.tsx).`)
}

// ── Règle 4 : les boutons utilisent le système de classes ────────────────────────
// Toute classe `button` d'un bouton du renderer commence par "button " (base commune).
// Sonde légère : la classe .button doit exister et servir de base aux variantes.
assert.match(css, /^\.button \{ /m, "le système de boutons (RULES.md §4) doit rester défini sur la classe .button de base")
for (const variant of ["primary", "secondary", "ghost", "danger"]) {
  assert.match(css, new RegExp(`^\\.button\\.${variant} \\{`, "m"), `variante .button.${variant} attendue (RULES.md §4)`)
}

// ── Règle 5 : les secrets ne quittent jamais le process main ─────────────────────
// Le preload n'expose que des appels ; aucun champ de type clé ne doit y transiter.
const preload = read("electron/preload.cts")
assert.ok(!/(apiKey|api_key|secret|password)\s*[:=]/i.test(preload),
  "Règle « Secrets » (RULES.md §7) : le preload ne doit contenir aucune valeur de clé/secret.")
// Le renderer ne référence aucune clé littérale d'API.
for (const f of jsxFiles) {
  const content = read(f)
  assert.ok(!/(sk-[A-Za-z0-9]{8,}|Bearer\s+[A-Za-z0-9_\-]{20,})/.test(content),
    `Règle « Secrets » (RULES.md §7) : littéral ressemblant à une clé détecté dans ${f}.`)
}

// ── Règle 6 : écritures de fichiers atomiques côté main ──────────────────────────
// writeFileSync est réservé aux exports choisis PAR l'utilisateur (dialogue de
// sauvegarde) et au fichier temporaire d'atomic-file.ts — pas aux données internes.
const atomic = read("electron/atomic-file.ts")
assert.match(atomic, /export function writeTextAtomic/, "atomic-file.ts doit rester la porte d'écriture (RULES.md §7)")

// ── Règle 7 : sécurité de la fenêtre — ne jamais affaiblir ───────────────────────
assert.match(main, /contextIsolation: true/)
assert.match(main, /sandbox: true/)
assert.ok(!/nodeIntegration: true/.test(main), "nodeIntegration doit rester désactivé (RULES.md §7)")

// ── Règle 8 : le module tool-guard du gabarit reste branché ──────────────────────
// La discipline des outils agents (garde anti-boucle glob) est une convention du projet.
const guard = read(".opencode/plugins/aven-tool-guard.js")
assert.match(guard, /aven\.tool-guard/)

// ── Règle 9 (RULES.md §12) : accessibilité — aria, focus, mouvement ────────────
const a11y = rules.includes("## 12. Accessibilité")
assert.ok(a11y, "la section Accessibilité de RULES.md doit rester en place")

// 9a. Le socle focus visible et le bloc reduced-motion restent dans App.css.
assert.match(css, /:focus-visible \{ outline: 2px solid var\(--accent\); outline-offset: 2px;? \}/,
  "Règle « Focus visible » (RULES.md §12.2) : le outline :focus-visible global ne doit pas disparaître")
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/,
  "Règle « Mouvement » (RULES.md §12.4) : le bloc prefers-reduced-motion ne doit pas disparaître")

// 9b. Aucun outline: none sans remplacement : chaque occurrence doit être sur un champ
// « incrusté » dont le conteneur/signaleur gère :focus ou :focus-within.
const outlineNoneContexts = [...css.matchAll(/([^{}\n]+)\{[^{}]*outline:\s*0;[^{}]*\}/g)]
for (const [, selector] of outlineNoneContexts) {
  const sel = selector.trim()
  const ok = /input|textarea|\.search|\.composer/.test(sel)
  assert.ok(ok,
    `Règle « Focus visible » (RULES.md §12.2) : outline supprimé sur « ${sel} » sans champ incrusté justifié — remplace-le par un indice de focus (box-shadow accent).`)
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
      `Règle « Dialogues » (RULES.md §12.1) : role="dialog" sans aria-modal="true" dans ${f}`)
    assert.match(tag, /aria-label=/,
      `Règle « Dialogues » (RULES.md §12.1) : role="dialog" sans aria-label dans ${f}`)
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
        `Règle « Noms accessibles » (RULES.md §12.1) : bouton icône seul sans aria-label dans ${f} — « ${attrs.trim().slice(0, 80)} »`)
    }
  }
}

// 9e. Le scope Icon.tsx reste : aria-hidden par défaut, currentColor conservé.
assert.match(icon, /aria-hidden=\{ariaHidden \?\? !title\}/,
  "Icon.tsx : l'aria-hidden par défaut (décoratif) doit rester")
assert.match(icon, /stroke="currentColor"/,
  "Icon.tsx : currentColor doit rester (héritage thème/accent, RULES.md §5)")

// 9f. Navigation clavier des listes du hub (v9.1.6) : logique pure testée + branchée.
const arrowNav = read("web/src/arrow-navigation.ts")
assert.match(arrowNav, /export function nextArrowIndex/,
  "la logique des flèches doit rester dans le module pur arrow-navigation.ts (RULES.md §8)")
assert.match(arrowNav, /Pur|sans React/i,
  "arrow-navigation.ts reste un module pur, testable sans React")
assert.ok(read("tests/arrow-navigation.test.mjs").includes("nextArrowIndex"),
  "le module arrow-navigation doit garder ses tests")
assert.match(app, /nextArrowIndex/,
  "les listes du hub doivent brancher la navigation flèches")
assert.match(app, /onKeyDown=\{recentNav\.onKeyDown\}/,
  "la liste des récents doit écouter les flèches")
assert.match(app, /onKeyDown=\{conversationsNav\.onKeyDown\}/,
  "le modal conversations doit écouter les flèches")
assert.match(app, /onKeyDown=\{projectsNav\.onKeyDown\}/,
  "le modal projets doit écouter les flèches")

console.log("conventions (RULES.md) : OK")

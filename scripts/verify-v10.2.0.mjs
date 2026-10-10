import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

// Sondes v10.2.0 : revue de design Apple (REVIEW-APPLE-DESIGN.md) —
//  ① socle typographique honnête (pile système, xs 11px) + contraste --muted ≥ 4,5:1
//     calculé par WCAG réel dans les deux thèmes ;
//  ② focus structurellement PAIRÉ (sonde 9b durcie dans verify-conventions) ;
//  ③ dialogues en View Transitions (entrée + sortie), fermetures de panneaux
//     naviguées, thème clair↔sombre en fondu ;
//  ④ signaux d'accessibilité complets (reduced-transparency, prefers-contrast,
//     scroll lissé coupé sous reduce) ;
//  ⑤ gestes destructeurs en deux clics + push-to-talk qui suit le doigt ;
//  ⑥ clavier partout (arbre Notes, listes triables) + état vide de la page Tâches.

const pkg = JSON.parse(read("package.json"))
const [vMaj, vMin, vPatch] = pkg.version.split(".").map(Number)
assert.ok(vMaj * 10000 + vMin * 100 + vPatch >= 100200, `version trop ancienne : ${pkg.version}`)

const css = read("web/src/App.css")
const app = read("web/src/App.tsx")
const dictation = read("web/src/voice-dictation.ts")
const notesView = read("web/src/NotesView.tsx")
const settings = read("web/src/SettingsDialog.tsx")
const appearance = read("web/src/appearance.ts")
const conventions = read("scripts/verify-conventions.mjs")
const rules = read("RULES.md")
const readme = read("README.md")
const tauriConf = JSON.parse(read("src-tauri/tauri.conf.json"))

// ── A. Chaîne de versions : package, Tauri, Rust, README, npm run verify ──────
assert.equal(pkg.version, "10.2.0", "package.json porte 10.2.0")
assert.equal(tauriConf.version, "10.2.0", "tauri.conf.json aligné sur 10.2.0")
assert.match(read("src-tauri/Cargo.toml"), /version = "10\.2\.0"/, "Cargo.toml aligné")
assert.match(read("src-tauri/Cargo.lock"), /name = "aven"\r?\nversion = "10\.2\.0"/, "Cargo.lock aligné")
assert.equal(pkg.scripts["verify:v10.2.0"], "node scripts/verify-v10.2.0.mjs", "script dédié exposé")
assert.ok(pkg.scripts.verify.includes("verify-v10.2.0.mjs"), "la sonde entre dans la chaîne npm run verify (après verify-conventions)")
assert.match(readme, /^# Aven v10\.2\.0/m, "README : titre de version")
assert.match(readme, /v10\.2\.0 — Revue de design Apple/, "README : section v10.2.0")
assert.match(readme, /verify-v10\.2\.0\.mjs/, "README : la sonde est citée")

// ── B. Typographie honnête (M1/M2/F4) + RULES.md aligné ───────────────────────
assert.match(css, /font-family:\s*system-ui,\s*"Segoe UI",\s*sans-serif;/,
  "pile système déclarée : la police annoncée est réellement celle du système (aucun @font-face fantôme)")
assert.match(css, /--font-size-xs:\s*11px;/, "micro-labels xs : 11px (10px sous le seuil de lisibilité)")
assert.ok(!/--font-size-xs:\s*10px/.test(css), "plus aucune définition xs 10px")
assert.match(css, /font-optical-sizing:\s*auto;/, "optique active (F4) : opsz suivi automatiquement")
// F1 : le chrome de fenêtre est opaque SANS backdrop-filter mort (flou sur fond opaque).
const chrome = css.match(/\.window-chrome \{[^}]*\}/)?.[0] ?? ""
assert.ok(chrome && !/backdrop-filter/.test(chrome) && /var\(--panel-solid\)/.test(chrome),
  "F1 : .window-chrome opaque, plus de backdrop-filter mensonger")
// F2 : sous un scrim de dialogue, les couches du hub n'additionnent plus leurs flous.
assert.match(css, /body:has\(\.overlay\) \.home-toolbar[\s\S]*?\{ backdrop-filter: none; \}/,
  "F2 : 3 backdrop-filters → 1 quand un dialogue est ouvert")
// F3 : titres de vue en leading serré.
assert.match(css, /line-height: 1\.08/, "F3 : h1 de vue en line-height 1.08")
// F8 : les cartes hub sont préparées au compositor.
assert.match(css, /\.hub-card \{[^}]*will-change: transform;/s, "F8 : will-change sur .hub-card")
// F9 : press-state homogène sur les contrôles segmentés.
for (const sel of [/\.segmented button:active/, /\.settings-tabs button:active/, /\.home-recent-item:active/]) {
  assert.match(css, sel, "F9 : :active en scale sur les contrôles segmentés")
}
// F5 : plus de boucle infinie décorative sur la pilule Freebuff (un seul foyer vivant).
assert.ok(!/freebuff[^}]*animation[^}]*infinite/.test(css), "F5 : aucune boucle infinie sur la pilule Freebuff")
assert.match(rules, /system-ui/, "RULES.md §2 : la table cite la pile système")
assert.match(rules, /11px \(10px était sous le seuil/, "RULES.md §2 : xs 11px figé avec sa raison")

// ── C. Contraste --muted ≥ 4,5:1 (E3) — calcul WCAG réel, deux thèmes ────────
const relLum = (hex) => {
  const v = hex.replace("#", "")
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const mutedValues = [...css.matchAll(/--muted:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1])
assert.equal(mutedValues[0], "#5f6579", "muted clair : #5f6579 (l'ancien #707689 tombait à 4,14:1)")
assert.equal(mutedValues[1], "#9299aa", "muted sombre : #9299aa")
assert.ok(contrast("#5f6579", "#fbfbfd") >= 4.5,
  `muted clair sur --bg : ${contrast("#5f6579", "#fbfbfd").toFixed(2)}:1 (≥ 4,5:1 exigé)`)
assert.ok(contrast("#9299aa", "#05060a") >= 4.5,
  `muted sombre sur --bg : ${contrast("#9299aa", "#05060a").toFixed(2)}:1 (≥ 4,5:1 exigé)`)

// ── D. Focus structurel PAIRÉ (E4) — le durcissement vit dans verify-conventions ──
assert.match(css, /\.search-wrap:focus-within/, "recherche sidebar : signaleur sur le conteneur")
assert.match(css, /\.composer:focus-within/, "composeur : signaleur sur le conteneur")
assert.match(css, /\.home-command:focus-within/, "commande du hub : signaleur sur le conteneur")
assert.match(css, /\.note-editor-content:has\(\.ProseMirror-focused\)/, "éditeur TipTap : signaleur :has(-focused)")
assert.ok(conventions.includes("(?:0|none)"), "sonde 9b : outline: none couvert au même titre que outline: 0")
assert.ok(conventions.includes("focusSignal"), "sonde 9b : exige un signal :focus* structuré")
assert.ok(conventions.includes("cssSelectors") && /paire|PAIRE/i.test(conventions),
  "sonde 9b : paire racine + règle compagne exigée (plus de whitelist par nom de classe)")
assert.match(rules, /PAIRE racine du sélecteur/, "RULES.md §12.2 : le durcissement est documenté")

// ── E. Dialogues en View Transitions (M3/M12/M13) ─────────────────────────────
assert.match(css, /\.overlay > \.dialog[^\n]*view-transition-name: dialog/, "le panneau porte son nom de transition")
assert.match(css, /@keyframes dialog-in/, "entrée dialog-in")
assert.match(css, /@keyframes dialog-out/, "sortie dialog-out")
assert.match(css, /::view-transition-old\(dialog\) \{ animation-name: dialog-out; \}/, "la sortie JOUE dialog-out (fermeture)")
assert.match(css, /::view-transition-new\(dialog\) \{ animation-name: dialog-in; \}/, "l'entrée joue dialog-in")
assert.match(css, /animation: dialog-in var\(--dur-med\) var\(--ease-spring\)/, "ressort RÉELLEMENT utilisé par l'entrée des dialogues (M12 : la token n'est plus morte)")
assert.ok((css.match(/animation: popover-in var\(--dur-fast\) var\(--ease-spring\)/g) ?? []).length >= 2,
  "M13 : selbar ET menu modèle se déploient depuis leur ancrage (popover-in + spring)")
assert.match(app, /closeNotesToHome = useCallback\(\(\) => withViewTransition\(/, "fermeture notes/fichiers/réglages en transition")
assert.match(app, /withViewTransition\(\(\) => setShowConversationPicker\(false\)\)/, "conversation : fermeture en transition")
assert.match(app, /withViewTransition\(\(\) => setShowSettings\(false\)\)/, "réglages : fermeture en transition")
assert.match(app, /withViewTransition\(\(\) => \{ setShowAgentsPage\(false\); setShowHome\(true\) \}\)/, "page Tâches : fermeture en transition")

// ── F. Thème en fondu (M4) + signaux d'accessibilité complets (M5/M6) ────────
assert.match(css, /\.theme-easing \*/, "fondu de bascule : classe CSS posée pendant 250 ms")
assert.match(appearance, /classList\.add\("theme-easing"\)/, "appearance.ts pose la classe quand la valeur change")
assert.match(appearance, /applyTheme\(/, "application centralisée du thème (état principal + écoute système)")
assert.match(css, /@media \(prefers-reduced-transparency: reduce\)/, "M5 : surfaces opaques si l'OS refuse la transparence")
assert.match(css, /@media \(prefers-contrast: more\)/, "M5 : bordures renforcées si l'OS exige plus de contraste")
assert.match(css, /\.main-scroll, \.home-modal-list, \.home-recent-list \{ scroll-behavior: auto; \}/,
  "M6 : défilement lissé coupé sous prefers-reduced-motion")

// ── G. Signaux de contrôle (M7/M8/M9/M10) ────────────────────────────────────
assert.match(css, /\.toggle-row input:checked::after \{ transform: translateX\(16px\)/,
  "M7 : la pastille du toggle anime un transform (GPU), pas un left en layout")
assert.match(css, /\.sortable-item:focus-visible/, "M8 : les rangées triables voient leur focus")
assert.match(css, /\.chat-actions button \{ width: 24px; height: 24px/, "M9 : cible d'action 24px")
assert.ok((css.match(/overscroll-behavior: contain/g) ?? []).length >= 5,
  "M10 : listes/panneaux contenus (au moins 5 zones)")

// ── H. Gestes destructeurs en deux clics (E1/E2) ─────────────────────────────
assert.match(app, /const \[deleteArmed, setDeleteArmed\]/, "E1 : état armé de la suppression de conversation")
assert.match(app, /armDelete\(c\.id\)/, "E1 : les boutons trash passent par armDelete")
assert.match(app, /deleteArmTimer\.window\.setTimeout|deleteArmTimer = useRef/, "E1 : minuteur d'armement")
assert.match(css, /\.chat-actions button\.armed/, "E1 : état armé visible (rouge + anneau)")
assert.match(notesView, /const \[purgeArmed, setPurgeArmed\]/, "E2 : état armé de la purge de note")
assert.match(notesView, /purgeNote\(n\.id\)/, "E2 : le bouton purge passe par purgeNote")
assert.match(css, /\.note-row-action\.armed/, "E2 : purge armée visible")

// ── I. Push-to-talk qui suit le doigt (F6) ───────────────────────────────────
assert.match(dictation, /const \[paused, setPaused\]/, "état de pause exposé par le hook")
assert.match(dictation, /const pause = useCallback/, "pause : le micro reste ouvert, le clip continue")
assert.match(dictation, /const resume = useCallback/, "reprise : aucune parole perdue")
assert.match(dictation, /return \{ state, paused, start, stop, pause, resume, cancel, resetError \}/, "contrat du hook complet")
assert.match(app, /dictationPointerRef/, "doigt engagé suivi côté App")
assert.match(app, /dictation\.pause\(\)/, "pointerleave → pause")
assert.match(app, /dictation\.resume\(\)/, "pointerenter → reprise")
assert.match(app, /releaseDictation/, "relâchement (même hors bouton) → transcription")
assert.match(css, /\.dictation-paused/, "signal visuel de pause (pulse figé)")

// ── J. Clavier partout (M8) + debounce (F7) + état vide Tâches (M11) ─────────
assert.match(notesView, /treeKeyDown/, "arbre Notes : navigation clavier")
assert.match(notesView, /data-note-id=/, "rangées note identifiées pour le clavier")
assert.match(notesView, /data-folder-id=/, "dossiers identifiés pour Alt+↑↓")
assert.match(notesView, /aria-keyshortcuts="Alt\+ArrowUp Alt\+ArrowDown"/, "raccourci déclaré (ARIA)")
assert.match(notesView, /Alt\+↑↓ au clavier/, "raccourci documenté dans l'interface")
assert.match(settings, /sortableKeyDown/, "listes triables : réordonnancement clavier")
assert.match(settings, /data-sort-id=/, "rangées triables identifiées")
assert.match(settings, /Alt\+↑↓ pour déplacer/, "raccourci documenté dans les Réglages")
assert.match(notesView, /\}, q\.length <= 1 \? 0 : 120\)/, "F7 : debounce 120 ms — le premier caractère ne patiente pas")
assert.match(notesView, /hitsCache\.current\.get\(q\)/, "F7 : un résultat déjà obtenu s'affiche immédiatement")
assert.match(app, /className="tasks-empty"|className=\{`tasks-empty`\}|"tasks-empty"/, "M11 : état vide de la page Tâches")
assert.match(css, /\.tasks-empty \{/, "M11 : style de l'état vide")

console.log("v10.2.0 verification: OK")

import { readApp, readStyles } from "./lib/sources.mjs"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

// Sondes v10.2.0 : revue de design Apple (docs/audits/2026-10-10-revue-design-apple.md) —
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

const css = readStyles()
const app = readApp()
const dictation = read("web/src/voice-dictation.ts")
const notesView = read("web/src/NotesView.tsx")
const settings = read("web/src/SettingsDialog.tsx")
const appearance = read("web/src/appearance.ts")
const conventions = read("scripts/verify-conventions.mjs")
// RULES.md a été fondu dans AGENTS.md (2026-10-18) : les trois assertions §2/§12.2
// ci-dessous lisent le fichier fusionné, leur contenu exigé est inchangé.
const rules = read("AGENTS.md")
const readme = read("README.md")
const tauriConf = JSON.parse(read("src-tauri/tauri.conf.json"))

// ── A. Chaîne de versions : package, Tauri, Rust, README, npm run verify ──────
// v10.2.1 : ce bloc épingle « 10.2.0 » en dur, en contradiction avec le plancher
// >= 100200 de la ligne qui le précède. Résultat : la sonde cassait au premier
// bump, alors que verify-docs exige justement une sonde verify-v<version>.mjs pour
// chaque version. L'invariant réel n'est pas le numéro, c'est l'ACCORD entre les
// manifestes — on le vérifie littéralement, sans figer la version.
const versionLiteral = pkg.version.replace(/\./g, "\\.")
assert.equal(tauriConf.version, pkg.version, "tauri.conf.json aligné sur package.json")
assert.match(read("src-tauri/Cargo.toml"), new RegExp(`version = "${versionLiteral}"`), "Cargo.toml aligné sur package.json")
assert.match(read("src-tauri/Cargo.lock"), new RegExp(`name = "aven"\\r?\\nversion = "${versionLiteral}"`), "Cargo.lock aligné sur package.json")
assert.equal(pkg.scripts["verify:v10.2.0"], "node scripts/verify-v10.2.0.mjs", "script dédié exposé")
assert.ok(pkg.scripts.verify.includes("verify-v10.2.0.mjs"), "la sonde entre dans la chaîne npm run verify (après verify-conventions)")
assert.match(readme, new RegExp(`^# Aven v${versionLiteral}`, "m"), "README : titre de version")
assert.match(readme, /v10\.2\.0 — Revue de design Apple/, "README : section v10.2.0 (la note reste due)")
assert.match(readme, /verify-v10\.2\.0\.mjs/, "README : la sonde est citée")

// ── B. Typographie honnête (M1/M2/F4) + AGENTS.md aligné ───────────────────────
assert.match(css, /font-family:\s*system-ui,\s*"Segoe UI",\s*sans-serif;/,
  "pile système déclarée : la police annoncée est réellement celle du système (aucun @font-face fantôme)")
assert.match(css, /--font-size-xs:\s*11px;/, "micro-labels xs : 11px (10px sous le seuil de lisibilité)")
assert.ok(!/--font-size-xs:\s*10px/.test(css), "plus aucune définition xs 10px")
assert.match(css, /font-optical-sizing:\s*auto;/, "optique active (F4) : opsz suivi automatiquement")
// F1 — AMENDEMENT v11.0.0 : le chrome de fenêtre (.window-chrome) a disparu avec le
// hub orbital ; le bandeau de télémétrie (.wb-status) occupe sa place en haut du
// Poste. La règle ne change pas de sens : ce qui cadre la fenêtre s'appuie sur
// --panel-solid et ne prétend pas flouter (AGENTS.md §12.3).
const chrome = css.match(/\.wb-status \{[^}]*\}/)?.[0] ?? ""
assert.ok(chrome && !/backdrop-filter/.test(chrome) && /var\(--panel-solid\)/.test(chrome),
  "F1 : le bandeau du Poste s'appuie sur --panel-solid, plus de backdrop-filter mensonger")
assert.match(css, /\.wb-app,\s*\.wb-app \* \{\s*backdrop-filter: none;/,
  "F1 (v11.0.0) : aucun verre dans le Poste — la DA interdit le flou sur ses surfaces")
// F2 — AMENDEMENT v11.0.0 : le hub et ses trois flous superposés ont disparu. La
// règle garde son intention (« un seul voile, jamais un empilement ») et devient
// mesurable plus strictement : un SEUL backdrop-filter dans toute la feuille (le
// scrim de dialogue), neutralisé dans le Poste par la règle ci-dessus.
assert.equal((css.match(/backdrop-filter: blur/g) ?? []).length, 1,
  "F2 : un seul voile flouté dans toute l'interface (le scrim de dialogue)")
// F3 : titres de vue en leading serré.
// v11.1.3 : le h1 de vue a suivi PageShell → InstrumentFrame (titre de scène, 1.05,
// donc plus serré encore). La sonde mesure l'élément vivant au lieu d'un sélecteur
// mort ; l'intention « interligne serrée » reste figée.
assert.match(css, /\.instrument-heading h1 \{[^}]*line-height: 1\.0\d/, "F3 : titre de scène en line-height serré")
// F8 (amendée v10.3.0) : l'indice compositor `will-change: transform` était le
// responsable du FLOU au survol — la carte composée était rastérisée puis mise à
// l'échelle (1.025), texte compris. On fige l'inverse : plus d'indice, plus de scale.
assert.ok(!/\.hub-card \{[^}]*will-change:\s*transform;/s.test(css), "F8 : plus de will-change sur .hub-card (flou au survol, v10.3.0)")
assert.ok(!/\.hub-card:hover \{[^}]*scale\(/s.test(css), "F8 : plus de scale au survol des cartes (flou du texte)")
// F9 : press-state homogène sur les contrôles segmentés.
// AMENDEMENT v11.0.0 : la ligne de récents du hub devient `.wb-row` (planche
// Aujourd'hui) ; les contrôles segmentés des dialogues restent inchangés.
// v11.1.3 : `.settings-tabs button` a disparu avec les onglets de la modale de réglages.
// v12.0.0 : les tuiles d'Aujourd'hui ont disparu ; la rangée d'onglets de session
// (rendue seulement quand plusieurs conversations sont ouvertes) porte le même
// press-state que les contrôles segmentés.
for (const sel of [/\.segmented button:active/, /\.wb-tab:active/]) {
  assert.match(css, sel, "F9 : :active en scale sur les contrôles segmentés")
}
// F5 : plus de boucle infinie décorative sur la pilule Freebuff (un seul foyer vivant).
assert.ok(!/freebuff[^}]*animation[^}]*infinite/.test(css), "F5 : aucune boucle infinie sur la pilule Freebuff")
assert.match(rules, /system-ui/, "AGENTS.md §2 : la table cite la pile système")
assert.match(rules, /11px \(10px était sous le seuil/, "AGENTS.md §2 : xs 11px figé avec sa raison")

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
// AMENDEMENT v11.0.0 : la DA DRONE remplace la paire violette par deux champ/panel
// olive (da.css). L'exigence ne bouge pas — --muted ≥ 4,5:1 sur --bg ET sur
// --panel-solid, dans les DEUX thèmes — seules les valeurs mesurées changent.
const lightMuted = css.match(/:root\[data-theme="light"\][\s\S]{0,400}?--muted:\s*(#[0-9a-fA-F]{6})/)?.[1]
const darkMuted = css.match(/:root \{[\s\S]{0,800}?--muted:\s*(#[0-9a-fA-F]{6})/)?.[1]
// AMENDEMENT v12.0.0 : le champ forêt du brief remplace l'olive. L'exigence ne
// bouge pas (≥ 4,5:1 sur --bg ET --panel-solid, deux thèmes) ; seules les valeurs
// mesurées changent — #939f96 mesure 6,5:1 sur #0b100e, #55604f mesure 6,0:1 sur
// #f1efe8.
assert.equal(lightMuted, "#55604f", "muted clair (DA v12.0.0) : #55604f")
assert.equal(darkMuted, "#939f96", "muted sombre (DA v12.0.0) : #939f96")
for (const [name, muted, bg, panel] of [
  ["clair", lightMuted, "#f3f0e7", "#fffdf7"],
  ["sombre", darkMuted, "#0a0c09", "#141910"],
]) {
  assert.ok(contrast(muted, bg) >= 4.5, `muted ${name} sur --bg : ${contrast(muted, bg).toFixed(2)}:1 (≥ 4,5:1 exigé)`)
  assert.ok(contrast(muted, panel) >= 4.5, `muted ${name} sur --panel-solid : ${contrast(muted, panel).toFixed(2)}:1 (≥ 4,5:1 exigé)`)
}

// ── D. Focus structurel PAIRÉ (E4) — le durcissement vit dans verify-conventions ──
assert.match(css, /\.search-wrap:focus-within/, "recherche sidebar : signaleur sur le conteneur")
assert.match(css, /\.composer:focus-within/, "composeur : signaleur sur le conteneur")
assert.match(css, /\.wb-command-form:focus-within/, "barre de commande : signaleur sur le conteneur (v11.0.0)")
assert.match(css, /\.note-editor-content:has\(\.ProseMirror-focused\)/, "éditeur TipTap : signaleur :has(-focused)")
assert.ok(conventions.includes("(?:0|none)"), "sonde 9b : outline: none couvert au même titre que outline: 0")
assert.ok(conventions.includes("focusSignal"), "sonde 9b : exige un signal :focus* structuré")
assert.ok(conventions.includes("cssSelectors") && /paire|PAIRE/i.test(conventions),
  "sonde 9b : paire racine + règle compagne exigée (plus de whitelist par nom de classe)")
assert.match(rules, /PAIRE racine du sélecteur/, "AGENTS.md §12.2 : le durcissement est documenté")

// ── E. Dialogues en View Transitions (M3/M12/M13) ─────────────────────────────
// AMENDEMENT v11.0.0 : le Poste ne change jamais de cadre, donc plus de View
// Transition — ni pour les pages (supprimées), ni pour les dialogues. L'invariant
// conservé est celui de l'ENTRÉE : un dialogue ponctuel naît en décélération, et
// aucune règle de transition ne survit sans appelant.
assert.ok(!/::view-transition-(?:old|new)/.test(css), "v11.0.0 : plus aucune View Transition dans les styles")
assert.match(css, /@keyframes dialog-in/, "entrée dialog-in")
assert.match(css, /\.overlay > \.dialog \{ animation: dialog-in var\(--dur-med\) var\(--ease-out\)/, "l'entrée des dialogues joue dialog-in")
// AMENDEMENT v10.3.1 (revue apple-design §4 P2) : l'assertion d'origine exigeait le
// ressort SUR l'entrée des dialogues. Le skill §4 le réserve aux gestes qui portent
// de l'élan (« overshoot on a menu that just faded in feels wrong ») : la règle est
// donc reformulée, aussi stricte, sur la nouvelle convention — le ressort reste
// VIVANT (barre de sélection née d'un surlignage) et les apparitions sans geste
// (panneaux, menu de modèle) passent en décélération.
assert.match(css, /animation: dialog-in var\(--dur-med\) var\(--ease-out\)/,
  "M12 (amendée v10.3.1) : l'entrée des dialogues utilise une décélération, pas un ressort")
assert.match(css, /\.selbar \{[^}]*animation: popover-in var\(--dur-fast\) var\(--ease-spring\)/,
  "M13 (amendée v10.3.1) : le ressort reste utilisé par un popover né d'un geste")
assert.ok(!/\.model-select-menu \{[^}]*--ease-spring/.test(css),
  "M13 (amendée v10.3.1) : un menu ouvert au clic ne rebondit pas")
// AMENDEMENT v11.0.0 : les pages et `closePage` ont disparu — la fermeture est
// celle d'un ONGLET, décidée par le modèle pur. L'esprit de la règle survit : une
// fermeture ne laisse jamais un écran vide, elle rend le voisin (et Aujourd'hui ne
// se ferme pas). La View Transition, elle, n'a plus d'appelant.
const tabModel1020 = read("web/src/workbench/tabs.ts")
assert.match(tabModel1020, /export function closeTab/, "fermer un onglet passe par le modèle pur d'onglets")
assert.match(tabModel1020, /if \(tab\.kind === "home"\) return state/, "Aujourd'hui ne se ferme pas")
assert.ok(!/withViewTransition/.test(app), "plus de machine de View Transition dans le renderer")

// ── F. Thème en fondu (M4) + signaux d'accessibilité complets (M5/M6) ────────
assert.match(css, /\.theme-easing \*/, "fondu de bascule : classe CSS posée pendant 250 ms")
assert.match(appearance, /classList\.add\("theme-easing"\)/, "appearance.ts pose la classe quand la valeur change")
assert.match(appearance, /applyTheme\(/, "application centralisée du thème (état principal + écoute système)")
assert.match(css, /@media \(prefers-reduced-transparency: reduce\)/, "M5 : surfaces opaques si l'OS refuse la transparence")
assert.match(css, /@media \(prefers-contrast: more\)/, "M5 : bordures renforcées si l'OS exige plus de contraste")
assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?scroll-behavior: auto/,
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
// AMENDEMENT v11.0.0 : le doigt est suivi par l'instrument qui porte le micro
// (composeur, barre de commande) ; l'état partagé reste dans use-aven-app.
const composer1020 = read("web/src/pages/ConversationPage.tsx")
assert.match(composer1020, /dictation\.pause\(\)/, "pointerleave → pause")
assert.match(composer1020, /dictation\.resume\(\)/, "pointerenter → reprise")
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

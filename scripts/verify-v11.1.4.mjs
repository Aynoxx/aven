import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.1.4 : le réglage « Position de la barre latérale » change réellement de côté.
// La régression d'origine : la classe de position n'était posée par AUCUN composant,
// et le CSS visait un ancêtre `.sidebar-right` qui n'existait donc jamais. Cette sonde
// fige les deux moitiés de la chaîne (classe appliquée + règle qui la consomme) et
// interdit le retour du sélecteur d'ancêtre, qui rendrait le réglage de nouveau inerte.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const lock = JSON.parse(read("package-lock.json"))
const cargo = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const readme = read("README.md")

const conversation = read("web/src/pages/ConversationPage.tsx")
const appearance = read("web/src/appearance.ts")
const settings = read("web/src/SettingsDialog.tsx")
const chrome = read("web/src/styles/chrome.css")
const dialogs = read("web/src/styles/dialogs.css")

// ── Version cohérente dans tous les manifestes ───────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(lock.version, pkg.version, "package-lock.json correspond à package.json")
assert.equal(lock.packages[""].version, pkg.version, "le paquet racine du lock est synchronisé")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(cargoLock, new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`), "Cargo.lock suit package.json")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")

// ── A. La position est un réglage typé, proposé et sauvegardé ────────────────
assert.match(appearance, /export type SidebarPosition = "left" \| "right"/, "la position est un type du domaine")
assert.match(appearance, /sidebarPosition: "left",/, "la position a une valeur par défaut")
for (const label of ["Gauche", "Droite"]) {
  assert.ok(settings.includes(`<option value="${label === "Gauche" ? "left" : "right"}">${label}</option>`),
    `le réglage propose « ${label} »`)
}

// ── B. Le composant pose réellement la classe sur la grille ──────────────────
assert.match(
  conversation,
  /appearance\.showSidebar \? ` sidebar-\$\{appearance\.sidebarPosition\}` : " sidebar-hidden"/,
  "la position choisie est posée sur la grille, et la barre masquée ne réserve aucune place",
)

// ── C. Le CSS vise l'élément porteur, pas un ancêtre inexistant ──────────────
assert.match(
  chrome,
  /\.workspace-layout\.sidebar-left \{[^}]*grid-template-columns: var\(--sidebar-width\) minmax\(0, 1fr\)/,
  "la position « gauche » garde la barre latérale en première colonne",
)
assert.match(
  chrome,
  /\.workspace-layout\.sidebar-right \{[^}]*grid-template-columns: minmax\(0, 1fr\) var\(--sidebar-width\)/,
  "la position « droite » permute les deux colonnes",
)
assert.match(
  chrome,
  /\.workspace-layout\.sidebar-right \.sidebar \{[^}]*order: 2;[^}]*border-left: 1px solid var\(--border\)/,
  "la barre latérale passe après le fil, avec sa bordure du bon côté",
)
assert.match(chrome, /\.workspace-layout\.sidebar-right \.main \{[^}]*order: 1/, "le fil passe en premier quand la barre est à droite")
assert.match(
  chrome,
  /\.workspace-layout\.sidebar-hidden \{[^}]*grid-template-columns: minmax\(0, 1fr\)/,
  "la grille se replie quand la barre latérale n'est pas rendue",
)
// La régression exacte : `.sidebar-right .workspace-layout` ne pouvait jamais
// correspondre, puisque la classe est posée sur la grille elle-même.
assert.ok(!/\.sidebar-right \.workspace-layout/.test(chrome),
  "la position ne doit plus viser un ancêtre `.sidebar-right` (réglage inerte)")
assert.ok(!/\.sidebar-left \.workspace-layout/.test(chrome),
  "la position ne doit plus viser un ancêtre `.sidebar-left` (réglage inerte)")
assert.ok(!/\.sidebar-hidden \.workspace-layout/.test(dialogs),
  "le repli ne doit plus viser un descendant de `.sidebar-hidden` (aucun ancêtre)")

// ── D. Sous 860 px, la colonne réduite suit le côté choisi ───────────────────
assert.match(dialogs, /\.workspace-layout\.sidebar-left \{[^}]*220px/, "à l'étroit, la barre garde sa colonne réduite")
assert.match(
  dialogs,
  /\.workspace-layout\.sidebar-right \{[^}]*grid-template-columns: minmax\(0, 1fr\) 220px/,
  "à l'étroit, la colonne réduite suit le côté choisi",
)
assert.match(
  dialogs,
  /\.workspace-layout\.sidebar-left,\s*\n\s*\.workspace-layout\.sidebar-right \{[^}]*grid-template-columns: 1fr/,
  "sous 680 px, les deux positions empilent en une colonne",
)

// ── E. La note de version explique le comportement rendu ────────────────────
assert.match(readme, /v11\.1\.4 — la barre latérale change vraiment de côté/, "README porte la note de version")

console.log("v11.1.4 verification: OK (position de la barre latérale effective dans la conversation)")

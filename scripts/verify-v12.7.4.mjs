import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v12.7.4 : pendant le démarrage, le Poste ne pousse plus un bandeau au-dessus de
// l'accueil — la sphère porte une phase `starting` réelle et l'accueil dit
// « Démarrage d’Aven… ». La sonde fige trois choses :
//   1. la phase existe dans le modèle pur et reste sobre (plus lente que l'écoute) ;
//   2. le câblage part de `appState.status`, jamais d'un minuteur ;
//   3. l'erreur garde son bandeau — on ne cache pas un échec derrière une animation.
// Aucune boucle CSS n'est ajoutée : le mouvement vient du canvas de la sphère.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const cargo = read("src-tauri/Cargo.toml")
const sphere = read("web/src/agent/sphere.ts")
const agent = read("web/src/agent/WireframeAgent.tsx")
const shell = read("web/src/workbench/WorkbenchShell.tsx")
const home = read("web/src/workbench/HomeStage.tsx")
const css = read("web/src/styles/workbench.css")
const test = read("tests/wireframe-agent.test.mjs")
const readme = read("README.md")

// ── Version et enregistrement ──────────────────────────────────────────────
assert.equal(tauri.version, pkg.version, "Tauri suit package.json")
assert.equal(cargo.match(/^version = "([^"]+)"$/m)?.[1], pkg.version, "Cargo suit package.json")
assert.equal(pkg.scripts["verify:v12.7.4"], "node scripts/verify-v12.7.4.mjs", "la sonde a son entrée npm")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v12.7.4.mjs"), "npm run verify inclut la sonde v12.7.4")
const version = pkg.version.replaceAll(".", "\\.")
assert.match(readme, new RegExp(`^# Aven v${version}\\r?$`, "m"), "README annonce la version courante")
assert.ok(readme.includes("v12.7.4 — le démarrage s'anime dans la sphère, pas dans un écran"),
  "README documente l'état de démarrage")

// ── La phase est réelle et sobre ───────────────────────────────────────────
assert.match(sphere, /Les huit phases RÉELLES du Poste/, "le modèle dit huit phases, sans en inventer")
assert.match(sphere, /export type AgentPhase =\n  \| "starting"/, "`starting` entre dans le type des phases")
assert.match(sphere, /export const AGENT_PHASES: readonly AgentPhase\[\] = \[\n  "starting",/,
  "`starting` est une phase de la liste, pas un cas spécial du rendu")
assert.match(sphere, /starting: \{ spin: 0\.02, density: 0\.6, wave: 0\.12, glow: 0\.22 \}/,
  "le démarrage tourne lentement et n'allume pas toute la sphère")
assert.match(agent, /phase: AgentPhase/, "le canvas consomme le type, il ne réinvente pas la phase")
assert.equal(test.match(/AGENT_PHASES\.length, 8/)?.[0], "AGENT_PHASES.length, 8",
  "le test pur couvre les huit phases")

// ── Le câblage part de l'état réel, pas d'un minuteur ───────────────────────
assert.match(shell, /const agentPhase = agentPhaseFor\(appState\.status, appState\.needsWorkspace, voice\.phase\)/,
  "la phase de démarrage vient de `appState.status`")
assert.match(shell, /import \{ agentPhaseFor \} from "\.\/agent-phase"/,
  "le shell utilise le module pur de phase")
assert.match(shell, /<WireframeAgent phase=\{agentPhase\}/, "le canvas unique reçoit cette phase")
assert.match(shell, /starting=\{appState\.status === "starting"\}/, "l'accueil sait qu'il démarre")
assert.match(shell, /phase=\{agentPhase\}/, "la scène et la sphère partagent la même phase")
assert.match(shell, /appState\.status !== "ready" && !appState\.needsWorkspace && \(appState\.status === "error" \|\| !isHome\)/,
  "le bandeau de démarrage s'efface sur l'accueil, l'erreur reste")
assert.match(shell, /Aven n’a pas démarré/, "l'échec garde son texte explicite")
assert.match(home, /data-phase=\{phase\}/, "les anneaux suivent la phase réelle")
assert.ok(!home.includes("data-phase={voice.phase}"), "aucune seconde source de phase dans l'accueil")
assert.match(home, /starting \? "Démarrage d’Aven…" : voice\.label/,
  "l'accueil nomme le démarrage à la place du libellé vocal")

// ── Aucune boucle CSS nouvelle : le mouvement est celui de la sphère ────────
const startingRules = css.match(/\.wb-home-scene\[data-phase="starting"\][^}]*\}/g) ?? []
assert.equal(startingRules.length, 2, "les anneaux et le nœud ont leur état de démarrage")
assert.ok(startingRules.every((rule) => !rule.includes("animation:")), "aucune boucle ambiante ajoutée")
assert.ok(startingRules.every((rule) => /var\(--(border-strong|muted)\)|opacity/.test(rule)),
  "l'état de démarrage reste tokenisé")

console.log("v12.7.4 verification: OK (démarrage porté par la sphère, bandeau d'erreur conservé)")

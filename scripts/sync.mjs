// npm run sync — resynchronisation locale complète après un push distant.
//
// Pourquoi ce script : `git pull` seul ne suffit pas dans ce dépôt. L'app que
// l'on lance est un ARTEFACT compilé (src-tauri/target/debug/aven.exe embarque
// web/dist) : avancer le code ne change rien à l'exécutable tant qu'on ne
// rebuild pas. Ce script enchaîne les étapes dans l'ordre, de façon bornée et
// idempotente :
//
//   1. garde-fous      Aven en vie ? (instance unique) -> on s'arrête, on ne tue rien
//   2. fetch           `git fetch --all --prune` — ne modifie AUCUN fichier
//   3. avance rapide   `git merge --ff-only` UNIQUEMENT — jamais de force ni de reset
//   4. verrous         si package-lock.json (racine ou web/) a bougé -> `npm ci`
//   5. binaire         `npm run tauri:check` — le .exe que tu lances reflète le code
//
// Options : `npm run sync -- --sans-build` (étape 5) et `--sans-ci` (étape 4).
// Sortie : un rapport par étape ; exit 0 = à jour, exit 1 = une étape a échoué.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const sansBuild = process.argv.includes("--sans-build")
const sansCi = process.argv.includes("--sans-ci")

const etapes = []
const noter = (nom, etat, detail = "") => {
  etapes.push({ nom, etat, detail })
  const symbole = etat === "ok" ? "OK " : etat === "échec" ? "KO " : "-- "
  console.log(`${symbole} ${nom}${detail ? " — " + detail : ""}`)
}

function git(args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true })
  const sortie = ((r.stdout ?? "") + (r.stderr ?? "")).trim()
  return { code: r.status ?? 1, sortie, ok: (r.status ?? 1) === 0 }
}

// Windows : npm est un .cmd que Node refuse de spawn sans shell — on lance
// npm-cli.js avec le Node courant (même astuce que scripts/install-web.mjs).
const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
function npm(args, cwd = root) {
  if (process.platform === "win32" && existsSync(npmCli)) {
    return spawnSync(process.execPath, [npmCli, ...args], { cwd, stdio: "inherit", windowsHide: true }).status ?? 1
  }
  return spawnSync("npm", args, { cwd, stdio: "inherit", windowsHide: true }).status ?? 1
}

const empreinte = (p) => {
  try { return createHash("sha256").update(readFileSync(path.join(root, p))).digest("hex") } catch { return "absent" }
}
const derniereLigne = (s) => (s.split("\n").filter(Boolean).slice(-1)[0] ?? "")

// ── 1. Garde-fous ─────────────────────────────────────────────────────────────
if (process.platform === "win32") {
  const t = spawnSync("tasklist", ["/FI", "IMAGENAME eq aven.exe"], { encoding: "utf8", windowsHide: true })
  if (/aven\.exe/i.test(t.stdout ?? "")) {
    console.error("KO Aven est ouvert (instance unique). Ferme l'app avant de resynchroniser, puis relance `npm run sync`.")
    process.exit(1)
  }
  const netstat = spawnSync("netstat", ["-ano"], { encoding: "utf8", windowsHide: true })
  if (/LISTENING[^\n]*:5173\b/.test(netstat.stdout ?? "")) {
    console.warn("!! Un serveur tourne déjà sur le port 5173 (tauri:dev ?) — tauri:check pourra écraser son binaire.")
  }
}

// ── 2. Fetch : rien n'est modifié, on va seulement regarder ───────────────────
const branche = git(["rev-parse", "--abbrev-ref", "HEAD"]).sortie
if (branche === "HEAD") {
  console.error("KO HEAD détachée : repasse sur une branche (`git switch feat/tauri-migration-v10`) avant de synchroniser.")
  process.exit(1)
}
const amont = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).ok ? "@{u}" : `origin/${branche}`

const verrouAvant = { racine: empreinte("package-lock.json"), web: empreinte("web/package-lock.json") }

const fetch = git(["fetch", "--all", "--prune"])
if (!fetch.ok) { noter("fetch", "échec", derniereLigne(fetch.sortie)); process.exit(1) }
noter("fetch", "ok", `amont = ${amont}`)

// ── 3. Avance rapide ──────────────────────────────────────────────────────────
const compte = git(["rev-list", "--count", "--left-right", `HEAD...${amont}`]).sortie.split(/\s+/)
const devant = Number(compte[0] || 0)
const derriere = Number(compte[1] || 0)
const inconnus = git(["log", "--oneline", `HEAD..${amont}`]).sortie.split("\n").filter(Boolean)

// `avanceEchouee` = la branche locale porte des commits non poussés : le script
// n'avance JAMAIS par-dessus (verrou --ff-only), et le mot de final doit le dire
// plutôt que d'annoncer « à jour ».
let avanceRefusee = false
if (derriere === 0 && devant === 0) {
  noter("avance rapide", "sauté", `branche « ${branche} » déjà à jour`)
} else if (devant > 0) {
  avanceRefusee = true
  noter("avance rapide", "sauté",
    `${devant} commit(s) local(aux) non poussé(s) — aucune avance forcée. Pousse d'abord, ou reviens vers l'agent.`)
  if (inconnus.length) console.log("   distants inconnus :\n" + inconnus.slice(0, 10).map((l) => "     " + l).join("\n"))
} else {
  const ff = git(["merge", "--ff-only", amont])
  if (!ff.ok) { noter("avance rapide", "échec", derniereLigne(ff.sortie)); process.exit(1) }
  noter("avance rapide", "ok",
    `${derriere} commit(s) absorbé(s) : ${inconnus.slice(0, 3).join(" ; ")}${inconnus.length > 3 ? " …" : ""}`)
}

// ── 4. Verrous : `npm ci` seulement si un lockfile a réellement bougé ────────
const verrouApres = { racine: empreinte("package-lock.json"), web: empreinte("web/package-lock.json") }
if (sansCi) {
  noter("dépendances", "sauté", "--sans-ci")
} else if (verrouApres.racine !== verrouAvant.racine) {
  // Le postinstall racine réinstalle aussi web/ et la CLI OpenCode.
  const code = npm(["ci"])
  noter("dépendances", code === 0 ? "ok" : "échec",
    `package-lock.json racine modifié → npm ci${code === 0 ? "" : " (code " + code + ")"}`)
  if (code !== 0) process.exit(1)
} else if (verrouApres.web !== verrouAvant.web) {
  const code = npm(["ci"], path.join(root, "web"))
  noter("dépendances", code === 0 ? "ok" : "échec",
    `web/package-lock.json modifié → npm ci dans web/${code === 0 ? "" : " (code " + code + ")"}`)
  if (code !== 0) process.exit(1)
} else {
  noter("dépendances", "sauté", "verrous inchangés")
}

// ── 5. Binaire : le .exe que tu lances doit refléter le code frais ───────────
if (sansBuild) {
  noter("binaire", "sauté", "--sans-build")
} else {
  const code = npm(["run", "tauri:check"])
  noter("binaire", code === 0 ? "ok" : "échec", code === 0
    ? "src-tauri/target/debug/aven.exe + installeurs régénérés"
    : `tauri:check (code ${code})`)
  if (code !== 0) process.exit(1)
}

// ── Rapport ───────────────────────────────────────────────────────────────────
console.log("\n── Rapport de synchronisation ──")
for (const e of etapes) console.log(`  [${e.etat}] ${e.nom}${e.detail ? " · " + e.detail : ""}`)
console.log(etapes.some((e) => e.etat === "échec")
  ? "Résultat : ÉCHEC — corrige l'étape marquée puis relance `npm run sync`."
  : avanceRefusee
    ? "Résultat : PAS À JOUR — tes commits locaux n'ont pas été touchés. Pousse-les (`git push`), puis relance `npm run sync`."
    : "Résultat : à jour. Lance `./src-tauri/target/debug/aven.exe` pour voir les changements.")

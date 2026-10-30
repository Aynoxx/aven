import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v12.5.0 : l'accueil se tient comme une APPLICATION, pas comme une page.
// Le défaut corrigé n'était pas visuel mais structurel : la surface d'entrée
// interrogeait l'utilisateur (« Que souhaitez-vous accomplir ? ») sans lui donner
// de champ, et ne proposait que des boutons — c'est la définition d'une page de
// présentation. Ce que la sonde fige, dans l'ordre du risque :
//   A. une vraie saisie remplace la question rhétorique, et elle envoie ;
//   B. le premier message part dans la session CRÉÉE pour lui (identifiant neuf),
//      jamais dans la conversation capturée par le rendu précédent ;
//   C. l'accueil nomme sa destination et sa date, en français — plus de slogan ;
//   D. la saisie porte son signal de focus sur le conteneur (paire de la sonde 9b) ;
//   E. les trois actions restent des commandes de barre d'outils, et le champ vide
//      ne porte aucune action primaire inerte ;
//   F. la question rhétorique ne revient pas, ni son style orphelin.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const home = read("web/src/workbench/HomeStage.tsx")
const shell = read("web/src/workbench/WorkbenchShell.tsx")
const app = read("web/src/app/use-aven-app.ts")
const css = read("web/src/styles/workbench.css")
const readme = read("README.md")
const agents = read("AGENTS.md")

// ── Version et enregistrement de la sonde ──────────────────────────────────
assert.equal(pkg.scripts["verify:v12.5.0"], "node scripts/verify-v12.5.0.mjs", "la sonde a son entrée npm")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v12.5.0.mjs"), "npm run verify inclut la sonde v12.5.0")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")
assert.match(readme, new RegExp(`v${pkg.version.replaceAll(".", "\\.")} — `), "README porte la note de la version courante")

// ── A. Une saisie réelle, pas une question ─────────────────────────────────
assert.match(home, /className="wb-home-command"/, "l'accueil porte une barre de saisie")
assert.match(home, /<form\s+className="wb-home-command"[\s\S]*?onSubmit=/, "la saisie est un formulaire : Entrée envoie sans gestionnaire de touche")
assert.match(home, /onPrompt\(text\)/, "le formulaire remet le texte au contrôleur au lieu de le garder")
assert.match(home, /aria-label="Message à Aven"/, "le champ est nommé pour les technologies d'assistance (AGENTS.md §12.1)")
assert.match(home, /placeholder=\{ready \?/, "le champ dit POURQUOI il est indisponible quand le Poste n'est pas prêt")
assert.match(home, /disabled=\{!ready\}/, "sans espace de travail, la saisie est fermée — jamais un envoi qui échoue")
assert.match(home, /disabled=\{!ready \|\| !draft\.trim\(\)\}/, "le bouton d'envoi n'est actif que sur un texte réel")

// ── B. Le premier message part dans la session créée pour lui ──────────────
// Régression visée : `sendText` lisait `chatId` par fermeture. Appelé juste après
// `createChat`, il visait encore la conversation du rendu précédent — ou aucune.
assert.match(app, /const sendText = async \(text: string, target: string \| null = chatId\)/,
  "l'envoi accepte une cible explicite : une session neuve n'existe pas encore dans l'état")
assert.match(app, /if \(!target \|\| live\.busy\) return/, "l'envoi vérifie la cible reçue, pas une capture")
assert.match(app, /await api\.send\(target, prompt\)/, "le message part dans la session visée")
assert.match(app, /const c = await api\.createChat\(tab\)[\s\S]*?await sendText\(prompt, c\.id\)/,
  "la saisie d'accueil crée la session PUIS envoie dans celle-ci")
assert.match(app, /setTabsState\(\(state\) => openConversation\(state, c\.id/, "et elle ouvre réellement l'onglet de la session")
assert.match(app, /^\s{4}startWithPrompt,$/m, "le contrôleur expose la saisie d'accueil")
assert.match(shell, /onPrompt=\{\(text\) => \{ void startWithPrompt\(text\) \}\}/,
  "la coquille branche la saisie sur le contrôleur, pas sur une navigation")

// ── C. La destination et la date, pas un slogan ────────────────────────────
assert.match(home, /wb-home-eyebrow">Aujourd’hui · \{today\}/,
  "l'accueil nomme la destination et la date — l'en-tête ne porte pas « Aujourd'hui »")
assert.match(home, /new Intl\.DateTimeFormat\("fr-FR"/, "la date est réelle et formatée en français, pas une salutation figée")
// Le commentaire qui explique la correction cite l'ancien libellé : c'est le TEXTE
// RENDU qui est mesuré, pas le commentaire.
assert.ok(!/wb-home-eyebrow">Aven \/ Voice workspace/.test(home), "le slogan anglais a disparu du rendu (AGENTS.md §1 : tout texte visible est en français)")

// ── D. Le signal de focus vit sur le conteneur ─────────────────────────────
assert.match(css, /\.wb-home-command:focus-within \{[\s\S]{0,220}?border-color: var\(--accent-border\)/,
  "le conteneur signale le focus (modèle .composer)")
assert.match(css, /\.wb-home-command input \{[\s\S]{0,400}?outline: none/, "l'input reste sans bordure : le cadre du conteneur EST le focus")
assert.match(css, /\.wb-home-command input::placeholder \{ color: var\(--muted\)/, "l'invite utilise le token de texte secondaire")

// ── E. Des commandes de barre d'outils, et le raccourci dit ────────────────
assert.equal(home.match(/className="button ghost wb-home-action"/g)?.length, 3, "trois actions rapides, toujours")
assert.match(css, /\.wb-home-action \{[^}]*border: 1px solid var\(--border\)/, "les actions portent le filet du chrome, pas un fond d'appel à l'action")
// Un aplat d'accent inerte sur un champ vide est le geste d'une page de vente :
// le rang primaire n'arrive qu'avec du texte. Le style désactivé reste celui du
// système (`.button:disabled`), sans opacité ajoutée à la main.
assert.match(home, /className=\{`button wb-home-send \$\{draft\.trim\(\) \? "primary" : "secondary"\}`\}/,
  "l'envoi n'est primaire que s'il y a quelque chose à envoyer")
assert.ok(!/className="button primary wb-home-send"/.test(home), "aucune action primaire permanente sous le champ")

// ── F. La question rhétorique ne revient pas ───────────────────────────────
assert.ok(!/wb-home-ask/.test(home), "aucune question rhétorique dans le rendu")
assert.ok(!/wb-home-ask/.test(css), "aucun style orphelin de la question rhétorique")
assert.match(agents, /Un accueil d'application ouvre une saisie, pas une affiche \(v12\.5\.0\)/,
  "AGENTS.md dit la règle de la saisie d'accueil — une règle sans doc n'est qu'une habitude")

console.log("v12.5.0 verification: OK (accueil = saisie réelle, envoi vers la session neuve, focus dit)")

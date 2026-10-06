import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Sondes v9.7.5 : ① noyau vocal central du hub (parité .voice-core du web) —
// bouton rond + 2 anneaux + micro + label d'état, anciens textes centraux
// supprimés ; ② dictée 100 % hors thread UI (init ET arrêt en Task.Run — fin du
// lag général pendant l'agent vocal) ; ③ MajBoutonVoix pilote les deux boutons
// (composeur + hub) avec le label immédiat et le renoncement ; ④ avis hub sans
// clé Groq ; ⑤ taille de noyau adaptative (RayonMin natif 150 < clamp web).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const [vMaj, vMin, vPatch] = pkg.version.split(".").map(Number)
assert.ok(vMaj * 10000 + vMin * 100 + vPatch >= 90705, `version trop ancienne : ${pkg.version}`)
assert.ok(typeof pkg.scripts["verify:v9.7.5"] === "string", "script verify:v9.7.5 manquant")
assert.ok(pkg.scripts.verify.includes("verify-v9.7.5.mjs"), "sonde v9.7.5 non branchée dans npm run verify")

const xaml = read("native/src/Aven.Native/MainWindow.xaml")
const cs = read("native/src/Aven.Native/MainWindow.xaml.cs")
const runtime = read("native/src/Aven.Native/VoiceRuntime.cs")

// A. Noyau vocal central du hub (XAML 100 % ASCII : entités numériques).
assert.match(xaml, /x:Name="HubVoixCore"/, "bouton central HubVoixCore absent")
assert.match(xaml, /x:Name="HubVoixFond"/, "fond circulaire du noyau absent")
assert.match(xaml, /x:Name="HubVoixAnneauExterne"/, "anneau externe du noyau absent")
assert.match(xaml, /x:Name="HubVoixAnneauInterne"/, "anneau interne du noyau absent")
assert.match(xaml, /x:Name="HubVoixCoreLabel"/, "label d'état du noyau absent")
assert.match(xaml, /&#127897;/, "micro (U+1F399 en entité numérique) absent du noyau")
assert.match(xaml, /Click="OnHubVoixCore"/, "clic du noyau non câblé")
assert.ok(!/x:Name="HubTitle"/.test(xaml), "HubTitle doit avoir disparu du centre du hub")
assert.ok(!/x:Name="HubWorkspace"/.test(xaml), "HubWorkspace doit avoir disparu du centre du hub")
// Aucune couleur en dur dans le nouveau noyau : tokens ThemeResource uniquement.
const noyau = xaml.slice(xaml.indexOf("v9.7.5 : noyau vocal central"), xaml.indexOf('x:Name="CardProject"'))
assert.ok(noyau.length > 200, "bloc du noyau vocal introuvable dans le XAML")
assert.ok(!/="#[0-9A-Fa-f]{6,8}"/.test(noyau), "couleur hexadécimale en dur dans le noyau vocal")
assert.ok(noyau.includes("ThemeResource"), "le noyau doit utiliser les tokens ThemeResource")

// B. Dictée hors thread UI : init + start ET arrêt + flush en Task.Run.
assert.match(runtime, /var \(média, flux\) = await Task\.Run/, "démarrage MediaCapture hors thread UI manquant")
assert.match(runtime, /await capture\.StopRecordAsync\(\)\.AsTask\(\)\.ConfigureAwait\(false\)/, "StopRecordAsync doit tourner en fond (ConfigureAwait(false))")
assert.ok(runtime.includes("_ = Task.Run(async () =>"), "branche d'arrêt non déportée en Task.Run")
assert.match(runtime, /public bool Demandée => _demandée;/, "état « demandé » manquant (label immédiat)")
assert.match(runtime, /public static string RésoudreCléGroq\(\)/, "clé Groq factorisée manquante")

// C. MajBoutonVoix pilote les deux boutons + feedback immédiat + renoncement.
assert.match(cs, /var enVoix = _voix is \{ \} v && \(v\.Demandée \|\| v\.EnCours\);/, "état demandé non pris en compte dans MajBoutonVoix")
assert.match(cs, /HubVoixCoreLabel\.Text = "J'écoute…"/, "le noyau du hub ne bascule pas à « J'écoute… »")
assert.match(cs, /HubVoixFond\.Stroke = BrushDe\("AvenDangerBrush"\)/, "bordure rose d'enregistrement absente (parité .dictation-recording)")
assert.match(cs, /_voix!\.Demander\(\);\s*\r?\n\s*MajBoutonVoix\(\);/, "label immédiat absent avant l'await")
assert.match(cs, /_voix\?\.Renoncer\(\);/, "renoncement manquant au catch (J'écoute… orphelin)")
assert.match(cs, /Math\.Clamp\(Math\.Round\(Math\.Min\(_rayon \* 0\.92, 2 \* \(_rayon - 85\)\)\), 120\.0, 236\.0\)/, "taille adaptative du noyau manquante")

// D. Avis hub sans clé Groq (parité setHomeNotice du voice-core web).
assert.match(cs, /private void OnHubVoixCore\(object sender, RoutedEventArgs e\)/, "handler du noyau manquant")
assert.match(cs, /NotifierHub\("Configure une clé Groq dans Paramètres pour dicter\."\)/, "avis hub sans clé manquant")

console.log("verify-v9.7.5 : OK (noyau vocal du hub + dictée hors thread UI)")

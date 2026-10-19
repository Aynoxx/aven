# Revue complète — Aven v10.2.0

> **Date** : 17 octobre 2026
> **Commit** : `76387ba` (merge PR #3, branche `main`)
> **Périmètre** : tout le dépôt — renderer React (`web/`), host Node (`host/`), coque
> Rust/Tauri (`src-tauri/`), gabarit d'agents (`.opencode/`), serveur MCP, scripts de
> vérification, tests, CI, documentation.
> **Méthode** : lecture intégrale des modules, exécution de la boucle obligatoire,
> lint du renderer, revue ciblée sécurité/robustesse/performance. Aucune exécution de
> l'application elle-même (pas de session graphique ni de profilage runtime) : les
> constats de comportement sont déduits du code et des vérifications automatisées.

---

## 1. Verdict

| Axe | Note | Commentaire |
|---|---|---|
| Architecture | **A−** | Découpage host/renderer/Rust exemplaire, modules purs, une seule porte IPC. |
| Sécurité | **B** | CSP stricte, DPAPI, pas de `innerHTML`, garde-fous de chemins solides — mais un dispatcher IPC trop générique et une écriture de fichier arbitraire. |
| Robustesse | **B−** | Reprise après crash budgétée, écritures atomiques… contournées aux endroits critiques (clés API, préférences, notes). |
| Tests | **B** | 162 tests Node + 14 tests Rust, très bons sur la logique pure ; **zéro test de composant**, quelques tests portent sur du code mort. |
| CI | **B−** | Quatre workflows qui se recouvrent, lint jamais exécuté, `engines` absent, 4 scripts orphelins. |
| Dette / cohérence | **C+** | Plusieurs centaines de lignes de code mort ou dupliqué, 3 implémentations des préférences, sondes qui valident des fichiers non utilisés. |
| Documentation | **A−** | Rare et précieuse (`RULES.md`, `NOTES-VERIFIEES.md`) ; quelques chiffres périmés. |

**Note globale : 7,5 / 10.** Projet nettement au-dessus de la moyenne : les conventions
sont écrites, outillées et globalement respectées. Les points faibles ne sont pas
conceptuels mais **d'exécution** : la règle « écritures atomiques » est contournée là
où elle protège des données irremplaçables, et l'outillage de vérification donne
par endroits une fausse assurance.

---

## 2. Ce que fait le projet

```
WebView2 (React 19 + Vite)                 ← renderer, aucun accès système
   │  invoke("aven_call", {method, args})  ← une seule commande Tauri
   ▼
Rust / Tauri 2 (src-tauri/)                ← fenêtre, tray, raccourcis, registre
   │  JSON-RPC ligne par ligne sur stdio   │  des espaces, notifications, DPAPI
   ▼                                       │  (clés API chiffrées)
Node « app host » (host/aven-app-host.ts)  ← settings, prefs, notes, fichiers,
   │  JSON-RPC stdio                       │  PTY Freebuff, seed d'espace
   ▼
Node « engine host » (host/engine-host.ts) ← routeur de modèles gratuits,
   │  SDK @opencode/client                  │  pont d'événements, priorise les
   ▼                                       │  modèles -free
Serveur OpenCode 2.0.10 (binaire embarqué) ← sessions, agents, outils, MCP
   │
   ├─ CLI Freebuff (PTY ConPTY, sessions gratuites, un seul terminal à la fois)
   └─ aven-mcp-server.mjs (notes en lecture seule pour les agents)
```

Volumétrie : ~10 000 lignes TS/TSX/Rust applicatives, 162 tests unitaires,
25 fichiers de test, 31 scripts de vérification (2 387 lignes, dont 22 exécutés par
`npm run verify`), 4 workflows CI.

---

## 3. Vérifications exécutées

| Commande | Résultat |
|---|---|
| `npm run typecheck:host` | ✅ 0 erreur |
| `npm test` | ✅ 162/162 (4,6 s) |
| `npm run verify` | ✅ conventions + 20 sondes versionnées + build (32 modules, 18 sondes de contenu) |
| `cd web && npx oxlint src` | ⚠️ **39 avertissements, 0 erreur** (non exécuté en CI) |
| `tsc --noUnusedLocals` (host) | 4 symboles inutilisés (non activé dans le tsconfig) |
| `cargo test` | non relancé dans cette passe (14 `#[test]` recensés dans `src-tauri/`) |

**Limite assumée** : `npm run build:web`, `cargo check` et la fumée Tauri n'ont pas été
rejoués ici ; la fraîcheur du bundle a été validée par `verify-build`, pas par une
compilation complète.

---

## 4. Points forts (à préserver)

1. **Une seule porte IPC.** `aven_call` + `OpenCodeApi` typé : pas de surface Rust
   éparpillée, pas de `preload` à maintenir. La capability Tauri est minimale
   (`core:default`, `dialog:default`).
2. **Modules purs réellement purs.** `priorities.ts`, `model-ref.ts`, `stream.ts`,
   `notes-meta.ts`, `arrow-navigation.ts`, `task-mode.ts`… testés sans Tauri ni
   Electron. C'est ce qui rend les 162 tests rapides et fiables.
3. **Sécurité de base solide.** CSP `default-src 'self'` sans `unsafe-eval`,
   `script-src 'self'`, `frame-src 'none'`, `object-src 'none'` ; clés API chiffrées
   DPAPI et jamais renvoyées au renderer ; `safeResolve()` et `cleanRelPath()`
   bloquent `..`, chemins absolus et lecteurs Windows, avec tests dédiés.
4. **Pas de XSS évident.** Aucun `dangerouslySetInnerHTML`, rendu Markdown maison ou
   `react-markdown` (éléments React), liens externes via liste blanche Rust.
5. **Robustesse du runtime.** Budget de redémarrage 3/min (`runtime.rs:36-45`),
   drain des appels en attente à la mort de l'enfant, arrêt gracieux borné à 3 s,
   anti-orphelin PTY (`stdin close`, `disconnect`), buffer de rejeu du terminal.
6. **Détails d'ingénierie soignés.** Batching des rendus par `requestAnimationFrame`,
   `MessageBubble` mémoïsé, `EngineClient` routant les réponses par id, écritures
   JSON atomiques là où la règle est appliquée (`archive`, `stats`, `notes-meta`,
   `task-mode`), garde anti-boucle `glob` dans le plugin OpenCode.
7. **Conventions outillées.** `RULES.md` + `AGENTS.md` + `verify-conventions.mjs` :
   tokens typographiques, rayons, boutons, icônes, focus visible, dialogues
   accessibles. Peu de projets de cette taille ont ce niveau de discipline.
8. **Documentation de faits vérifiés.** `NOTES-VERIFIEES.md` évite les régressions
   « de mémoire » sur l'API OpenCode — à conserver et à compléter.

---

## 5. Constats classés

### 5.1 Majeurs

#### C1 — Les commandes Tauri synchrones bloquent le thread principal jusqu'à 120 s

`aven_call` est une fonction **non `async`** (`src-tauri/src/commands.rs:28`) et
`runtime_call` attend la réponse avec `rx.recv_timeout(...)`
(`src-tauri/src/runtime.rs:223`), avec un budget de **120 secondes**
(`runtime.rs:32`). Or, dans Tauri 2, les commandes sans `async` s'exécutent **sur le
thread principal** ; seules les commandes `async` partent sur le pool
([documentation Tauri](https://v2.tauri.app/develop/calling-rust/)).

Conséquences :

- tous les appels IPC sont sérialisés derrière le plus lent : `messages()` lit la
  session, la liste des enfants puis jusqu'à 200 messages par sous-agent
  (`host/operations.ts:242-262`) ; `exportChat`, `initialize` et `state` peuvent
  prendre des secondes ;
- pendant ce temps, le thread principal ne traite ni les événements de fenêtre
  (déplacement, fermeture), ni les menus du tray, ni les raccourcis globaux ;
- un appel qui dépasse 120 s échoue avec « Le runtime Aven n'a pas répondu » alors
  que le travail continue côté Node : état UI et réalité divergent.

**Correctif recommandé** : `async fn aven_call` + `tauri::async_runtime::spawn_blocking`
pour le corps bloquant (les `State<'_, T>` doivent alors être passés en `Arc` cloné ou
récupérés dans la closure). Alternative minimale : garder la signature synchrone mais
déplacer l'attente dans un `std::thread` et rendre la commande `async` sur un
`oneshot`. Ajouter un test Rust sur `call_with_timeout` (cas timeout + cas réponse
tardive ignorée).

#### C2 — Écritures non atomiques sur des données irremplaçables (violation de `RULES.md` §7)

`RULES.md` impose : « toujours via `writeTextAtomic`/`writeJsonAtomic`, jamais
`writeFileSync` direct dans `userData` ni dans l'espace de travail ». La réalité :

| Fichier | Ligne | Écriture |
|---|---|---|
| `host/aven-app-host.ts` | 193 | `writeFileSync(settingsPath(), …)` — **clés API chiffrées** |
| `host/aven-app-host.ts` | 354 | `writeFileSync(prefsPath(), …)` — notifications, reprise Freebuff |
| `host/notes.ts` | 105 | `writeFileSync(abs, …)` — contenu des notes |
| `host/agents-bridge.ts` | 14 | `writeFileSync` importé mais **jamais utilisé** |

`writeFileSync` tronque le fichier **en place**. Une coupure de courant, un crash ou
un `kill` pendant l'écriture laisse un JSON partiel. Or les lecteurs avalent l'erreur :

- `loadKeys()` (`aven-app-host.ts:151-155`) : `try { JSON.parse(...) } catch {}` →
  objet vide → **les deux clés API disparaissent silencieusement**, et comme elles sont
  chiffrées DPAPI, l'utilisateur doit les ressaisir ;
- `loadPrefs()` (`aven-app-host.ts:337-345`) : retour aux défauts → notifications
  réactivées, reprise de session désactivée, sans aucun message.

Le risque n'est pas théorique : c'est précisément le scénario que la règle atomique
existe pour couvrir, et le seul fichier encore conforme est… un module mort (C4).

**Correctif** : remplacer les trois `writeFileSync` par `writeJsonAtomic` (settings,
prefs) et `writeTextAtomic` (notes) ; conserver une copie `.bak` de `settings.json`
avant écrasement ; ne jamais avaler une erreur de parsing sans la journaliser sur
stderr.

#### C3 — Le dispatcher IPC permet au renderer d'écrire n'importe quel fichier et d'en lancer un autre

`aven_call` route une chaîne libre venue du renderer :

- `writeTextFile` (`commands.rs:54`) écrit **n'importe quel chemin absolu**, crée les
  dossiers parents et ne filtre ni extension ni emplacement. Le commentaire de
  `shell.rs:87-91` assume ce choix (« chemin de sortie ASSUMÉ libre »), mais il n'est
  valable que si l'appelant est le dialogue de sauvegarde — or rien ne le garantit :
  n'importe quel code du renderer peut appeler `aven_call("writeTextFile", ...)`.
- `openPath` (`commands.rs:42`) canonise puis délègue à `explorer.exe`, qui **exécute**
  un `.exe`/`.bat`/`.lnk` au lieu de l'ouvrir.
- `openExternal` est, lui, correctement limité à deux URLs (`shell.rs:43-51`).

La CSP stricte et l'absence de `dangerouslySetInnerHTML` réduisent fortement le risque
initial (XSS). Il reste qu'un seul bug de rendu Markdown, une dépendance compromise ou
une injection de prompt transformant du Markdown en lien piégé suffirait à passer de
« contenu » à « exécution de code ». C'est une défense en profondeur manquante sur la
frontière la plus sensible de l'app.

**Correctif recommandé** (sans casser l'export vers un dossier libre) :

1. `writeTextFile` : refuser les extensions exécutables (`.exe`, `.bat`, `.cmd`, `.ps1`,
   `.lnk`, `.scr`, `.msi`, `.dll`), refuser `%APPDATA%\…\Startup`, et exiger un chemin
   issu d'un jeton émis par le `save` dialog (Map jeton → chemin, à usage unique).
2. `openPath` : n'autoriser que l'espace de travail actif (ou un chemin issu d'un
   dialogue) et refuser les extensions exécutables.
3. `openWorkspace` : déjà limité à l'espace actif — rien à changer.

#### C4 — Trois implémentations des préférences, dont deux mortes, et des sondes qui les valident

| Module | Importeurs en production | Tests | Sondes qui le lisent |
|---|---|---|---|
| `host/prefs.ts` | **0** | **0** | `verify-v9.1.0.mjs:17,61`, `verify-v9.5.0.mjs:27,49` |
| `host/workspaces.ts` | **0** (Rust possède le registre) | `tests/workspaces.test.mjs` (≈ 8 tests) | — |
| `host/notify-policy.ts` | **0** (Rust `notify.rs` notifie) | `tests/notify-policy.test.mjs` | — |
| `host/settings.ts` | **0** (ré-export jamais importé) | — | — |

Le vrai code des préférences vit dans `aven-app-host.ts:331-356` **et** dans
`src-tauri/src/notify.rs:65-80` (lecture directe de `prefs.json`), avec des défauts qui
doivent rester alignés à la main. `notify.rs` documente d'ailleurs deux divergences
déjà corrigées de cette façon.

Pire : `verify-v9.1.0` et `verify-v9.5.0` affirment que les préférences sont écrites
proprement (elles inspectent `host/prefs.ts`), alors que la production écrit avec
`writeFileSync`. **La sonde protège un fichier que personne n'exécute.** C'est le
constat le plus dommageable de la revue : l'outillage donne une fausse assurance sur
le point C2.

**Correctif** : supprimer `prefs.ts`, `workspaces.ts`, `notify-policy.ts`, `settings.ts`
(et leurs tests) **ou** les rebrancher. Mettre à jour les sondes pour lire le fichier
réellement exécuté, et remplacer les assertions textuelles par un test de comportement
(charger/écrire dans un `AVEN_USER_DATA_DIR` temporaire, vérifier le fichier produit).

### 5.2 Moyens

#### M1 — `App.tsx` : 1 650 lignes, 41 états, 17 effets, 39 avertissements de lint

`web/src/App.tsx` concentre navigation, chat, streaming, hub, réglages, raccourcis,
dictée, sélection, notices et modales. Le lint relève **39 avertissements**, dont
13 « Cannot access refs during render », 7 « Calling setState synchronously within an
effect can trigger cascading renders », 4 mémoïsations non préservées et 5 dépendances
d'effet manquantes, concentrés sur `App.tsx` (`App.tsx:97-102`, `229`, `368`, `495`,
`526`, `613`, `761`). Aucun test ne couvre ce fichier.

Les transitions de vue et le rendu tiennent, mais chaque nouvelle fonctionnalité
augmente le risque de régression invisible. **Correctif** : extraire au minimum
`useChatSession` (messages, live, envoi, permissions, formulaires),
`useWorkspaceShell` (état, espaces, navigation) et `useKeyboardShortcuts` ; passer les
états liés à un `useReducer`. Objectif réaliste : ramener `App.tsx` sous 600 lignes.

#### M2 — CI : quatre workflows qui se chevauchent, lint absent, pas de test renderer

- Sur une PR touchant `host/`/`web/`, **`tauri.yml` et `ci-windows.yml` s'exécutent tous
  les deux** : chacun refait `npm ci`, tests, build host, build web, `cargo check`,
  `cargo test`, puis une compilation Tauri complète. `tauri.yml` construit même les
  installeurs NSIS + MSI à chaque PR. Coût : ~2 × 45-60 min de runner Windows.
- `ci.yml` (Linux) refait aussi tests + builds + verify.
- `oxlint` n'est exécuté **dans aucun workflow**, alors que `web/package.json` définit
  `npm run lint`. Les 39 avertissements ne sont donc jamais vus.
- Aucun test de composant : `stream.ts`, `chat-groups.ts`, `selection-actions.ts` sont
  testés, mais pas un seul écran.
- `package.json` n'a pas de champ `engines` : Node 20 (sans `--experimental-strip-types`
  stable) échoue avec un message obscur.
- 4 scripts orphelins : `verify-v8.7.3`, `v8.7.7`, `v8.7.8`, `v8.7.9` ne sont appelés
  nulle part ; `e2e-*.mjs` non plus.

**Correctif** : faire de `ci-windows.yml` **le seul** workflow PR (tests + lint +
cargo + fumée), réserver `tauri.yml` aux tags/releases ou à `workflow_dispatch`,
ajouter `npm run lint -- --deny-warnings` (après nettoyage), supprimer les scripts
orphelins, ajouter `"engines": { "node": ">=22.6" }`.

#### M3 — La sonde d'accessibilité/icônes ne voit que dix fichiers codés en dur

`verify-conventions.mjs:73` définit `jsxFiles` à la main. Tout nouveau composant
(`NoteEditor.tsx`, `icons/Icon.tsx`, un futur `SearchPanel.tsx`…) échappe aux règles
« pas de `<svg>` local », « bouton icône = `aria-label` », « `role="dialog"` =
`aria-modal` + `aria-label` ». Les règles existent, mais leur application dépend de la
mémoire du contributeur — exactement ce que la sonde prétend éviter.

**Correctif** : découvrir les fichiers par glob (`web/src/**/*.tsx`) et exclure
explicitement `icons/Icon.tsx` (seul `<svg>` autorisé). Ajouter la règle
`type="button"` par défaut sur les boutons hors formulaire.

#### M4 — Boîte de dialogue unique et `then` piégeux

`createTauriApi` renvoie un `Proxy` qui répond à **toute** propriété de type chaîne par
une fonction (`web/src/api-tauri.ts:32-33`). `await api`, `Promise.resolve(api)` ou un
`return api` dans une chaîne de promesses déclenche donc `invoke("aven_call", { method:
"then" })` : l'objet est *thenable* par accident. Aucun appel de ce type aujourd'hui,
mais c'est un piège latent qu'un refactor anodin peut activer.

**Correctif** : `if (property === "then" || property === "catch" || property ===
"finally") return undefined`, et un test dans `tests/tauri-api.test.mjs`.

#### M5 — Performance des notes : N+1 IPC et lecture intégrale à chaque liste

- `NotesView` lance **un `noteTags(id)` par note** à chaque changement d'arbre
  (`web/src/NotesView.tsx:71-84`). Avec 100 notes : 100 allers-retours IPC, chacun
  sérialisé sur le thread principal (C1).
- `listNotes()` lit **le Markdown complet de chaque note** pour n'en extraire qu'un
  titre (`host/notes.ts:58-70`, via `rowOf` en `48-52`). Un dossier de 5 Mo de notes
  est relu intégralement à chaque rafraîchissement.
- Même schéma dans `aven-mcp-server.mjs:19-30` : `aven_notes_list` lit tous les
  fichiers en entier.

**Correctif** : un RPC `noteTagsAll()` (une lecture de `notes-meta.json`), un cache de
titres (ou lecture des 2 premiers Kio), et un index en mémoire invalidé par mtime.

#### M6 — CSP : images distantes autorisées sans nécessité

`img-src 'self' data: blob: https:` (`src-tauri/tauri.conf.json:25`) permet à un Markdown généré
par un agent d'afficher `![](https://trace.example/pixel?u=…)`. Chaque note ou
conversation ouverte peut ainsi émettre des requêtes réseau arbitraires (fuite d'IP,
pixel de suivi), alors que l'app ne charge aucune image distante par conception.

**Correctif** : restreindre à `img-src 'self' data: blob:` et, si les images distantes
sont un besoin, les récupérer côté Rust avec cache et liste blanche de domaines.

#### M7 — `host/pty-host.ts` est un vestige du client WinUI, toujours livré

Le module se présente comme « pont ConPTY pour le client WinUI natif »
(`pty-host.ts:1`), supprimé en v10.0.0. Il est toujours bundlé
(`scripts/build-engine-host.mjs:9`) et **embarqué dans l'installateur**
(`src-tauri/tauri.conf.json`, `runtime/aven-pty-host.mjs`). Le PTY réel passe par
`host/freebuff-pty.ts` dans l'app host. Code mort + poids + surface d'audit inutile.

**Correctif** : retirer l'entrée esbuild et la ressource, supprimer le fichier (ou
l'isoler dans un dossier `legacy/` non livré).

### 5.3 Mineurs

| # | Constat | Référence |
|---|---|---|
| m1 | 129 `<button>` dont **87 sans `type="button"`** : ils deviendraient `submit` s'ils entraient un jour dans un `<form>`. | `web/src/**/*.tsx` |
| m2 | Quatre symboles inutilisés ; `noUnusedLocals`/`noUnusedParameters` absents du tsconfig host (le tsconfig web les active). | `agents-bridge.ts:14`, `archive.ts:1`, `aven-app-host.ts:397`, `engine-host.ts:214` |
| m3 | `README.md` annonce « 21 sondes » ; `npm run verify` en exécute 22 (conventions + 20 versions + build). | `README.md:34` |
| m4 | `package-lock.json` déclare encore `"version": "10.0.0"` alors que `package.json` est en 10.2.0 ; un `npm install` réécrit le fichier (bruit de diff). | `package-lock.json:3,11` |
| m5 | `build/icon.png` est un vestige d'electron-builder, plus référencé ; `TAURI-MIGRATION.md` documente une migration terminée. | racine |
| m6 | Chemins Unix/macOS de `open_system_path`/`open_url` sont compilés mais jamais utilisés ni testés (app Windows uniquement, PTY `cmd.exe`, DPAPI). | `src-tauri/src/shell.rs:9-37` |
| m7 | stderr du runtime Node uniquement recopié sur la console parent (`eprintln!`) : en app packagée, aucun journal persistant pour diagnostiquer un crash. | `src-tauri/src/runtime.rs:157-160` |
| m8 | Aucune version d'API/protocole négociée entre Rust et app host : `HOST_PROTOCOL` existe côté Node (`engine-host.ts:18`), mais Rust ne le vérifie pas. | `runtime.rs`, `engine-host.ts` |
| m9 | `NotesView` a un `useEffect` sans tableau de dépendances (garde par `ref`, mais l'effet se ré-exécute à chaque rendu). | `NotesView.tsx:65-70` |
| m10 | `notes.ts` écrit les notes sans verrou : deux fenêtres Aven sur le même espace (ou l'app + le CLI) peuvent écraser mutuellement. | `host/notes.ts:105` |

---

## 6. Détails et correctifs proposés

### 6.1 Rendre l'IPC non bloquant (C1)

```rust
// src-tauri/src/commands.rs
#[tauri::command]
pub(crate) async fn aven_call(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    method: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    // Les branches purement locales (writeTextFile, openPath, workspace:*) restent
    // synchrones et rapides ; seul le relais vers Node part sur un thread bloquant.
    if let Some(result) = local_call(&state, &method, &args)? {
        return Ok(result);
    }
    tauri::async_runtime::spawn_blocking(move || {
        runtime_call(&app, &state, &method, args)
    })
    .await
    .map_err(|e| format!("Runtime Aven interrompu : {e}"))?
}
```

`State<'_, T>` n'est pas `'static` : passer un `Arc<RuntimeState>` géré par Tauri
(`app.state::<Arc<RuntimeState>>()`) plutôt que l'emprunt, ou capturer un clone du
`AppHandle` et récupérer l'état dans la closure. Vérifier ensuite que la fenêtre reste
déplaçable pendant un `messages()` lent.

### 6.2 Écritures atomiques (C2)

```ts
// host/aven-app-host.ts
import { writeJsonAtomic } from "./atomic-file.js"

function savePrefs(next: { notifications?: boolean; freebuffResume?: boolean }) {
  const current = loadPrefs()
  const value = {
    notifications: next.notifications ?? current.notifications,
    freebuffResume: next.freebuffResume ?? current.freebuffResume,
  }
  writeJsonAtomic(prefsPath(), value) // mkdir est fait par prefsPath()
  return value
}
```

Pour `settings.json`, écrire une copie `settings.json.bak` avant la bascule atomique,
et journaliser les erreurs de parsing (`console.error("[settings] fichier illisible]", e)`)
au lieu de `catch {}`.

### 6.3 Restreindre les écritures et ouvertures (C3)

```rust
fn is_forbidden_executable(path: &Path) -> bool {
    const BAD: [&str; 7] = ["exe", "bat", "cmd", "ps1", "lnk", "scr", "msi"];
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| BAD.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

// writeTextFile : refuser les exécutables + vérifier que le chemin vient d'un jeton
// du dialogue de sauvegarde (Map jetons à usage unique, côté Rust).
```

### 6.4 Supprimer les doublons de préférences (C4)

Ordre sûr :

1. Extraire `loadPrefs`/`savePrefs` dans un module pur `host/prefs.ts` réutilisé par
   `aven-app-host.ts` (et par les tests).
2. Faire lire `prefs.json` par Rust via la même structure (`serde`), ou passer la
   valeur de `notifications` à chaque `notify_from_event` (déjà reçu via l'état ?) pour
   éviter une lecture disque par événement.
3. Rediriger les sondes `verify-v9.1.0`/`verify-v9.5.0` vers ce module unique, et
   remplacer les `assert.match` par un test comportemental.
4. Supprimer `host/workspaces.ts` + `tests/workspaces.test.mjs` (le registre vit dans
   Rust, testé par `cargo test`) ou les réintroduire dans le chemin réel — pas d'entre-deux.

---

## 7. Couverture de tests et angles morts

**Bien couvert** : priorités/modèles, parsing des refs, synchronisation d'espace,
écritures atomiques, archive, notes (arborescence, tags, poubelle), transcript,
navigation clavier, dictée (intentions), PTY (spawn/quoting), CLI Freebuff, API Tauri
factice, politique de notification, redémarrage runtime.

**Non couvert** :

| Sujet | Risque |
|---|---|
| Composants React (navigation, chat, notes) | régression UI invisible ; 39 avertissements lint ignorés |
| `aven_call` bout en bout (Rust ↔ Node) | erreurs de framing, timeout, reprise après crash non testés sur le chemin réel |
| `writeTextFile`/`openPath` (validation) | surface d'attaque non testée |
| `safeResolve` sur liens symboliques/jonctions Windows | évasion possible non vérifiée (le test couvre `..` et absolus, pas les junctions) |
| Concurrence deux instances | écrasement de notes/préférences |
| Persistance de fenêtre (multi-écrans, écran débranché) | fenêtre hors champ |
| Migration v9 → v10 des espaces/notes | perte silencieuse de données |
| Accessibilité réelle (lecteur d'écran, tabulation) | règles seulement statiques |

**Recommandation** : un test d'intégration `node:test` qui lance `aven-app-host.mjs`
avec un `AVEN_USER_DATA_DIR` temporaire et exerce `initialize` → `state` → `noteSave`
→ `noteGet` → `shutdown` serait plus rentable que dix nouvelles sondes textuelles.
Côté renderer, `@testing-library/react` + `happy-dom` sur `App` (hub → chat → notes)
couvrirait le risque le plus élevé pour un coût modéré.

---

## 8. Sécurité — récapitulatif

| Contrôle | État |
|---|---|
| CSP stricte, pas d'`unsafe-eval` | ✅ |
| `frame-src 'none'`, `object-src 'none'` | ✅ |
| Aucun `dangerouslySetInnerHTML` | ✅ |
| Clés API chiffrées DPAPI, jamais renvoyées | ✅ (mais écriture non atomique → perte possible) |
| Secrets absents du renderer / des logs | ✅ (sondé) |
| Liste blanche d'URLs externes | ✅ (2 URLs) |
| Écriture de fichier arbitraire depuis le renderer | ❌ (C3) |
| Exécution de fichier arbitraire via `openPath` | ❌ (C3) |
| Images distantes (pixels de suivi) | ⚠️ (M6) |
| Validation de chemins (notes, fichiers) | ✅ `safeResolve`/`cleanRelPath`, à durcir sur les junctions |
| MCP notes en lecture seule | ✅ bon choix |
| Journalisation des erreurs runtime en production | ⚠️ (m7) |

Le modèle de menace réel est moins « attaquant réseau » que « contenu généré par un
agent » : Markdown, noms de fichiers, sorties d'outils. Les garde-fous Rust sont la
dernière ligne ; ils méritent le même soin que la CSP.

---

## 9. Accessibilité et design

- Le socle est bon : focus visible global, `prefers-reduced-motion`, `role="dialog"`
  avec `aria-modal`, `aria-label` sur les boutons icône, navigation clavier des listes
  testée (`arrow-navigation.ts`).
- Points à vérifier à la main (non testables statiquement) : ordre de tabulation dans
  les modales, piege du focus, annonce des changements d'état (`live.busy`,
  « L'agent travaille… » sans `aria-live`), contrastes des thèmes personnalisés
  (l'accent libre peut tomber sous 4,5:1).
- `docs/audits/2026-10-10-revue-design-apple.md` a déjà traité les fondamentaux visuels ; les points
  restants sont des détails d'exécution, pas des manques structurels.

---

## 10. Documentation

- `RULES.md`, `AGENTS.md` et `NOTES-VERIFIEES.md` sont d'une qualité rare et doivent
  rester la référence. `docs/audits/2026-10-10-revue-design-apple.md` et `TAURI-MIGRATION.md` documentent
  bien les décisions passées.
- À corriger : « 21 sondes » → 22 ; version du lockfile ; mention de `pty-host.ts`
  comme actif alors qu'il est vestigial ; la section README v10.0.0 parle encore de
  « l'Electron actuel » dans un commentaire de `build-engine-host.mjs:3`.
- Ajouter une ligne dans `RULES.md` §7 précisant **où** vivent les préférences
  (aujourd'hui trois endroits se contredisent).

---

## 11. Plan d'action

### Vague 1 — corriger les risques de perte de données (½ journée)

1. C2 : `writeJsonAtomic` pour `settings.json` et `prefs.json`, `writeTextAtomic` pour
   les notes, `.bak` pour les clés, journalisation des erreurs de parsing.
2. C4 : un seul module de préférences ; sondes pointées dessus ; suppression de
   `prefs.ts`/`settings.ts`/`workspaces.ts`/`notify-policy.ts` et de leurs tests.
3. M4 : neutraliser `then`/`catch`/`finally` dans le Proxy + test.
4. m4 : committer le lockfile à jour.

### Vague 2 — frontière IPC et réactivité (1-2 jours)

5. C1 : `aven_call` asynchrone + `spawn_blocking` ; test de timeout.
6. C3 : validation des extensions et jetons de dialogue pour `writeTextFile`/`openPath`.
7. M6 : restreindre `img-src`.
8. m7 : journal runtime persistant (`%APPDATA%\Aven\logs\runtime.log`, rotation).

### Vague 3 — dette et outillage (2-3 jours)

9. M1 : extraction de `useChatSession`/`useWorkspaceShell` ; objectif `App.tsx` < 600 lignes.
10. M2 : un seul workflow PR Windows, lint bloquant, `engines`, suppression des scripts
    orphelins ; un test d'intégration host de bout en bout.
11. M3 : glob pour `jsxFiles` + règle `type="button"`.
12. M5 : `noteTagsAll`, cache de titres, index MCP.
13. M7/m5 : retirer `pty-host.ts` et `build/icon.png` du livrable.

---

## Annexe A — Code mort et doublons

| Élément | Statut | Action |
|---|---|---|
| `host/prefs.ts` | 0 importeur, 0 test, 2 sondes | réutiliser ou supprimer |
| `host/workspaces.ts` + `tests/workspaces.test.mjs` | 0 importeur, ~8 tests | supprimer (Rust fait foi) |
| `host/notify-policy.ts` + test | 0 importeur, `notify.rs` fait le travail | supprimer ou rebrancher |
| `host/settings.ts` | ré-export jamais importé | supprimer |
| `host/pty-host.ts` | livré, jamais utilisé | supprimer du bundle/ressources |
| `scripts/verify-v8.7.3/7.7/7.8/7.9.mjs` | orphelins | supprimer |
| `scripts/e2e-*.mjs` | non câblés | câbler ou supprimer |
| `build/icon.png` | vestige electron-builder | supprimer |

## Annexe B — Fichiers les plus volumineux

| Fichier | Lignes | Commentaire |
|---|---|---|
| `web/src/App.tsx` | 1 650 | à découper (M1) |
| `host/aven-app-host.ts` | 760 | settings + prefs + clés + notes + PTY + dispatch : à scinder par domaine |
| `src-tauri/src/runtime.rs` | 515 | dense mais cohérent ; extraire la persistance de fenêtre |
| `web/src/NotesView.tsx` | 390 | N+1 IPC (M5) |
| `web/src/FreebuffAgentPage.tsx` | 371 | acceptable |
| `host/notes.ts` | 364 | lectures intégrales (M5) |
| `host/operations.ts` | 330 | bon découpage fonctionnel |
| `web/src/SettingsDialog.tsx` | 301 | acceptable |

---

## Conclusion

Aven v10.2.0 est un projet **sain, cohérent et ambitieux**, avec une architecture
réfléchie et une discipline de conventions que beaucoup de bases de code envient. Les
trois chantiers qui comptent vraiment sont : **ne plus bloquer le thread principal**
(C1), **écrire atomiquement ce qui est irremplaçable** (C2) et **remettre les sondes
sur le code réellement exécuté** (C4). Les deux premiers sont des correctifs localisés ;
le troisième est le plus structurant, parce qu'il conditionne la confiance dans tout
l'outillage de vérification — et donc dans les 162 tests qui font la force du projet.

# Aven v9.0.1

Application de bureau (Electron) : une chatbox avec **3 agents commutables** (code, recherche, analyse) et un
sous-agent (code-reviewer), branchée sur **OpenCode 2.0.10** et un catalogue d’agents strictement gratuit (OpenRouter Free / OpenCode Zen).

> **v9.0.1 — Réparation du démarrage** : les espaces créés avant la v9.0.0 n'avaient pas
> l'agent **projet** (liste de synchro figée) → « Agents introuvables après 90s » au lancement.
> Les agents sont désormais **découverts dans le gabarit de l'app** : tout nouvel agent sera
> automatiquement copié dans les espaces existants (sans jamais toucher à tes personnalisations).
> Corrige aussi le script de tests pour la CI GitHub (les installateurs v8.11.0/v9.0.0 n'avaient
> pas pu être publiés) — les releases repartent avec la v9.0.1.
> **v9.0.0 — Projet Agent IA** : ① créer un espace = choisir/créer son dossier dans le
> sélecteur Windows ; ② les notes sont de vrais fichiers .md (chemin affiché + « Ouvrir
> le dossier ») ; ③ conversations groupées par agent (sidebar + page Agents, réglage
> Apparence pour revenir à l'ancienne vue) ; ④ nouvel agent **projet** orchestrateur qui
> délègue à code / recherche / analyse ; ⑤ Freebuff prioritaire sur l'agent code dès
> qu'une clé Codebuff existe (réglage désactivable, bouton du composeur en override).
> **v8.11.0 — Panneau de statistiques** : carte « Statistiques » du hub — conversations
> actives/archivées par agent, dictées (total et du jour), modèles les plus utilisés.
> Comptage persisté par espace de travail, agrégation pure et testée.
> **v8.10.0 — Notes premium** : recherche plein-texte (insensible aux accents et à la casse,
> sur les titres ET le contenu), épinglage persistant (les épinglées en tête de liste),
> comptage de mots/caractères et export .md via le dialogue Windows.
> **v8.9.0 — Actions sur sélection** : sélectionne du code dans une réponse → une mini-barre flottante propose
> **Copier**, **Corriger** (bascule sur l'agent code), **Expliquer** (agent recherche) et **Citer** (composeur).
> Le texte cité atterrit dans le composeur : tu complètes ta demande et tu valides avec Entrée.
> **v8.8.0 — Routage d'intention de la dictée** : la dictée comprend ce que tu demandes à l'*application*.
> « Ouvre une note », « ouvre les paramètres »… s'exécutent immédiatement ; une tâche de dev, de recherche ou
> d'analyse **bascule automatiquement sur le bon agent** (classification Groq gratuite, en parallèle du reformage :
> aucune latence ajoutée). Hors commandes, le texte atterrit dans le composeur du bon agent — tu valides avec Entrée,
> rien ne part jamais automatiquement. Si la classification échoue, la dictée se comporte comme en v8.7.9.
> **v8.7.9 — Annonce vocale** (optionnelle, Réglages → Apparence) : les moments clés des agents sont
> annoncés à voix haute (voix Windows SAPI, hors ligne, gratuite) — permission demandée, tour terminé
> (avec résumé, jamais le contenu), bascule de modèle. Coalescence : un seul état à jour est annoncé.
> **Mute automatique** : la voix se coupe dès que tu tapes.
> **v8.7.8 — Dictée vocale** : maintiens le bouton micro (ou Ctrl+Maj+V), parle, relâche.
> La transcription Whisper (Groq, ~1 s) est **reformée** par un petit modèle (hésitations, répétitions
> et lapsus supprimés, sans jamais répondre à la place de l’agent), puis atterrit dans le composeur :
> tu relis, tu corriges au besoin, Entrée envoie. Le texte brut reste consultable (badge « ✓ éclairci »).
> Si Groq est saturé, la dictée retombe sur le texte brut — jamais bloquante.
> **v8.7.7** : le backend vocal Gemini Live et la clé Google ont été **retirés** (non fonctionnels).

```
Interface React (web/)  ──IPC──►  Electron main (electron/)  ──HTTP local──►  opencode serve (CLI embarqué)  ──►  modèles
   window.opencode.*               opencode-bridge.ts + operations.ts            mot de passe aléatoire, port libre
```

## Installer et lancer (Windows)

**Le plus simple : double-clique `demarrer.bat`** (il lance `npm install` — quelques secondes si rien n'a changé — puis l'app en mode développement). `construire.bat` fait la même chose puis produit les `.exe`. Pour mettre à jour le projet, copie les nouveaux fichiers **par-dessus** l'ancien dossier sans supprimer `node_modules`.

À la main :

Prérequis : **Node.js** uniquement. Le CLI OpenCode est embarqué (paquet `@opencode/cli`, même version que le client) : pas d'install globale.

```powershell
npm install            # à la racine : installe aussi web/ automatiquement (télécharge Electron ~200 Mo + le CLI OpenCode)
npm run dev            # développement : fenêtre Electron + rechargement
npm run package:win    # produit release/dist : installeur NSIS + version portable (.exe)
```

## Modèles et clés

- **Sans clé** : les modèles « Sans clé (OpenCode Zen) » (`opencode/…-free`) fonctionnent dès le premier lancement.
- **Avec clé** : bouton **Paramètres** → une clé OpenRouter Free (agents), une clé Groq (dictée vocale) et, optionnellement, une clé Codebuff pour le backend Freebuff.
  Les clés sont chiffrées par Windows et ne sont jamais renvoyées à l'interface. La clé Codebuff n'est pas transmise à OpenCode.
- **Freebuff** : le bouton **Freebuff** du composeur active le backend SDK officiel Codebuff. Il est séparé du catalogue Aven strictement gratuit et peut consommer des crédits Codebuff ; il ne simule pas l'accès au client Freebuff gratuit.
- **Vocal** : le mode vocal (assistant Live) a été retiré en v8.7.7 ; l’assistant vocal et son panneau n’existent plus.
- **Routage des modèles par priorité** : chaque modèle a une **priorité par agent** dans `model-priorities.json` et Aven assigne explicitement le premier modèle disponible à chaque nouvelle session.
  (1 = le meilleur ; « code », « analyse », « recherche »). Chaque agent utilise le meilleur modèle **disponible** (clé saisie) et non saturé.
  Le classement se recalcule au démarrage et à chaque enregistrement de clé ; il s'affiche dans Réglages. Changer d'onglet change donc de modèle.
- **Bascule automatique quand un modèle est trop utilisé**, de deux façons :
  - *préventive* : l'app compte les requêtes de chaque modèle et passe au suivant à 90 % du plafond déclaré dans la table (`limit`) ;
  - *réactive* : erreur 429 / quota / modèle indisponible → le modèle est mis de côté (90 s pour une limite de débit, 6 h pour un quota journalier ou un
    modèle non disponible), l'agent passe au suivant **immédiatement** et ton dernier message est renvoyé.
- **Catalogue dynamique** : au démarrage, Aven compare la table locale à `model.list()`, ne retient que les modèles explicitement gratuits et actifs,
  puis ajoute les nouveaux modèles gratuits autorisés même si la table livrée était devenue obsolète.
- **Modifier les priorités** : ouvre `Documents\Aven-workspace\model-priorities.json` (Réglages → « Ouvrir le dossier »), change les
  nombres, relance l'app. Ce fichier n'est jamais écrasé par une mise à jour de l'app : supprime-le pour récupérer la nouvelle version livrée.
  Le catalogue livré est strictement gratuit : les modèles payants sont exclus et ignorés, y compris s’ils sont ajoutés dans un fichier de priorités personnalisé.

## Où travaillent les agents

`Documents\Aven-workspace\` : créé au premier lancement avec `opencode.jsonc` et `.opencode\agents\*.md`
(copiés depuis ce projet, **jamais écrasés ensuite** : tes modifications restent). Bouton « Ouvrir le dossier » dans Réglages.
Les agents ne touchent donc ni au code de l'app ni au dossier d'installation.

## Refonte de l’interface

La passe actuelle ajoute une interface entièrement pilotée par des **tokens de design** côté renderer, sans modifier le protocole OpenCode :

- thème **Système / Sombre / Clair** et cinq accents ;
- densité d’affichage, largeur de la barre latérale et largeur maximale des messages ;
- barre latérale à gauche ou à droite ;
- affichage indépendant de l’en-tête, des onglets, des conversations, du modèle, des événements, de l’activité des outils et de l’éditeur ;
- **ordre des blocs principaux** réorganisable par glisser-déposer ;
- **ordre des agents** réorganisable par glisser-déposer, sans changer leurs identifiants OpenCode ;
- préférences persistées localement dans le renderer ;
- panneau **Apparence** accessible depuis l’en-tête ou la barre d’onglets ;
- animations légères en CSS pour les changements de vues, messages et états de travail.

Les réglages purement OpenCode (clés API, espaces de travail, attribution des modèles) restent dans **Réglages**. La personnalisation visuelle ne modifie ni les agents, ni leurs permissions, ni le routage des modèles.

## v8 — Refonte complète de l’accueil

La page d’accueil adopte une composition centrale plus respirée : le hub circulaire devient le point focal, les cinq actions sont positionnées en étoile autour de l’assistant vocal, et la zone des conversations récentes est intégrée en bas sans panneau latéral. La barre supérieure regroupe identité, commande, agent actif, état et paramètres. Le layout se réorganise pour les fenêtres petites, compactes ou hautes. Les surfaces réutilisent les tokens de thème/accent et les boutons d’action partagent une base visuelle commune.

## v8.7.6 — Freebuff + correction Gemini Live

Cette version conserve la base v8.7.3 et les protections du catalogue gratuit, puis ajoute un backend Freebuff/Codebuff optionnel avec historique séparé,
interruption et sélection de backend depuis le composeur. Le jeton Gemini Live est créé via l'endpoint AuthToken sans `liveConnectConstraints` dans le corps REST ;
la configuration Live complète est envoyée dans le premier `setup` WebSocket. Les références de modèles gratuits sont également élargies et validées
dynamiquement contre les modèles réellement disponibles au démarrage.

## v7.2 — Refonte du hub d’accueil

La page d’accueil adopte un shell central sans panneaux latéraux : barre de commande, sélection d’agent, hub circulaire centré autour de l’assistant vocal et bandeau de conversations récentes. Les surfaces et halos utilisent les variables de thème existantes pour suivre automatiquement le mode clair/sombre et la couleur d’accent.

## v7.1 — Correction du vocal Live

Correction ciblée du mode vocal Gemini Live : endpoint WebSocket contraint pour les jetons éphémères, attente de `setupComplete`, diagnostics de fermeture et nettoyage de l’ancien chemin Groq one-shot devenu inutilisé.

## v7 — Vocal et agents multi-fournisseurs

Cette version majeure ajoute le vocal temps réel basé sur Gemini Live, OpenRouter Free comme fournisseur gratuit prioritaire pour les agents, ainsi que l’intégration OpenAI/ChatGPT pour les modèles et le vocal premium. Les versions `v6.x` ci-dessous correspondent aux historiques précédents.

## Convention de versionnement
- `vX` : grosse mise à jour / changement majeur.
- `vX.x` : petite mise à jour / évolution ou correction ciblée.

## Fusion v6.1 + v6.3

Cette version fusionnée conserve les nouveautés des deux branches : refonte visuelle et personnalisation (thèmes, accents, disposition, ordre des agents et des blocs), renommage persistant des agents et conversations, création automatique des conversations, Markdown riche avec tableaux et coloration du code sur l’historique, streaming regroupé par image, suivi du défilement avec retour au dernier message, raccourcis clavier, transcript persistant des sous-agents, archivage/export, vérification des clés, gestion multi-espaces de travail, tray, arrêt propre du process, verrou mono-instance et packaging Windows sans publication automatique.

## Fichiers importants

- `electron/opencode-bridge.ts` : lance/arrête `opencode serve`, attend que les agents soient chargés, relaie les événements. **Sans dépendance Electron** (testable avec Node).
- `electron/operations.ts` : agents, conversations, messages, permissions.
- `electron/settings.ts` : clés chiffrées par fournisseur (`safeStorage`) + création du dossier de travail.
- `electron/providers.ts` : fournisseurs, variables d'environnement, pages pour obtenir une clé.
- `electron/priorities.ts` (lecture/validation de la table, chaînes par agent) et `electron/router.ts` (choix du modèle, compteurs, bascule) : sans Electron, testables avec Node.
- `model-priorities.json` : priorités par modèle et par agent (copié dans le dossier de travail au premier lancement).
- `electron/preload.cts` : `.cts` = compilé en CommonJS (`preload.cjs`) — obligatoire pour un preload sandboxé.
- `web/src/stream.ts` : réducteur pur des événements (texte en direct, outils, permissions, questions de l'agent, fin de tour).
- `web/src/SettingsDialog.tsx` : écran des clés et attribution des modèles (lecture seule).
- `web/src/FormDialog.tsx` : boîte de dialogue des questions de l'agent (outil `question`).
- `build/icon.png` : icône de l'app (remplace-la par la tienne, 512×512 minimum).
- `.opencode/agents/*.md` + `opencode.jsonc` : agents (format V2 : `permissions:` = liste de règles, la dernière qui correspond gagne).
- `server/` : ancien backend Express (mode web), **plus utilisé par l'app Electron**, conservé comme référence.
- `NOTES-VERIFIEES.md` : faits vérifiés sur OpenCode 2.0.10 (à lire avant de toucher au pont).

## Dépannage

| Symptôme | Cause / solution |
|---|---|
| « Electron failed to install correctly » | npm 11 bloque les scripts d'installation. `npm install` relance maintenant `scripts/ensure-binaries.mjs`, qui télécharge Electron et prépare le CLI. À la main : `node node_modules/electron/install.js` puis `node node_modules/@opencode/cli/postinstall.mjs`. |
| « OpenCode n'a pas démarré » + message | Le message contient les dernières lignes du CLI. Vérifie Réglages (clé) et le dossier de travail. |
| Écran blanc une fois packagé | `web/vite.config.ts` doit garder `base: "./"`. |
| Agents introuvables | Ils se chargent en tâche de fond (quelques secondes) ; l'app attend jusqu'à 90 s. Vérifie que `.opencode\agents\*.md` a un frontmatter YAML valide. |
| Erreur 429 dans le chat | Limite de débit du modèle gratuit : change de modèle ou attends. Chaque message = plusieurs appels (une par étape de l'agent) : garde `steps` bas. |
| Mise à jour d'OpenCode | Mets `@opencode/client` ET `@opencode/cli` à la **même** version exacte (dans `package.json` et `EXPECTED_VERSION`). |


## v8.2 — Bibliothèque d’icônes centralisée

- Toutes les icônes d’interface créées ou utilisées par l’application sont centralisées dans `web/src/icons/Icon.tsx`.
- Les composants réutilisent désormais cette bibliothèque plutôt que de recréer des SVG ou d’utiliser des glyphes Unicode comme icônes.
- Les icônes héritent de `currentColor` et suivent donc automatiquement le thème et l’accent.
- L’ancien sprite social non utilisé `web/public/icons.svg` a été supprimé.

## v8.1 — Corrections de finition

- Les sous-menus de l’accueil utilisent désormais un overlay viewport complet, y compris au-dessus de la barre de fenêtre.
- Les overlays de Réglages, Notes et Assistant vocal utilisent les couleurs du thème au lieu d’un fond codé en dur.
- L’icône Paramètres en haut à droite réutilise exactement l’icône SVG du hub.
- Nettoyage d’une règle CSS devenue inutile et version interne passée à `8.1.0`.

## Validation v8

La passe v8 a été contrôlée sur plusieurs tailles de fenêtre (bureau, compact et mobile), en thèmes clair/sombre et avec plusieurs accents. Les contrôles de navigation, le sélecteur d’agents, `Tout voir`, la création de conversation depuis l’accueil et la commande d’accueil ont été relus pour éviter les effets de bord. Le parsing TypeScript/TSX/CTS/MTS passe sur les sources.

Le build Electron/Vite complet n’est pas déclaré comme exécuté ici : les dépendances npm ne sont pas embarquées dans l’archive et leur installation a dépassé le délai disponible.

## Statut des tests

Testé (Node 22, CLI 2.0.10 réel, faux modèle local) : démarrage/arrêt du serveur, échec rapide si CLI absent, chargement des agents,
création de conversation, message, demande de permission + réponse, question de l'agent + réponse, sous-agent, historique, attribution par agent, bascule automatique sur erreur 429 (< 1 s) et plafond préventif, arrêt du process, compilation TypeScript
(Electron + web), build web avec chemins relatifs.

Testé aussi : **Electron 33 réel sous Linux (xvfb)** : le main ESM et le preload se chargent, l'interface s'affiche, OpenCode 2.0.10 démarre via le CLI embarqué et le dossier de travail est créé.
**Non testé** : `safeStorage` (clé chiffrée), le packaging `.exe`, Windows, et les vrais modèles OpenRouter.

## Nouveautés de cette passe (v6)

Cette fois, le zip que tu m'as envoyé ne contenait pas `node_modules` : je n'ai donc **pas pu compiler ni exécuter quoi que ce soit
réellement** (pas d'accès réseau non plus pour installer les dépendances ici). J'ai relu chaque fichier à la main, vérifié l'équilibre
des accolades/parenthèses, et fait passer tout le code dans `tsc` en ignorant les erreurs qui viennent uniquement de l'absence de
`@opencode/client`, `electron` et `react` dans mon environnement (confirmé en testant tes fichiers originaux non modifiés de la même
façon : ils produisent exactement les mêmes erreurs de "module introuvable"). **Fais tourner `npm run build` avant `npm run package:win`
pour rattraper une éventuelle erreur qui m'aurait échappé.**

Par confiance décroissante :

**Solide (mêmes patterns que le code déjà vérifié) :**
- **Rendu Markdown/code** (`web/src/Markdown.tsx`) : blocs de code avec bouton copier, code en ligne, gras/italique. Construit avec des
  éléments React (pas de `dangerouslySetInnerHTML`), donc pas de risque d'injection.
- **Recherche dans les conversations** (filtre local sur le titre), **raccourcis clavier** (Ctrl+N nouvelle conversation, Ctrl+K
  recherche, Échap interrompre), **édition/renvoi du dernier message**.
- **Archivage local** (`electron/archive.ts`) : une simple liste d'IDs de côté (`.opencode-app/archived.json` dans le dossier de
  travail), puisque OpenCode n'a pas cette notion nativement. Le bouton « Supprimer » reste disponible séparément pour un vrai effacement.
- **Export Markdown** d'une conversation via le dialogue « Enregistrer sous » natif.
- **Tray + raccourci global** (`Ctrl+Maj+O`) : fermer la fenêtre ne quitte plus l'app, elle continue en tray ; « Quitter » dans le menu
  du tray arrête vraiment tout. **Changement de comportement à connaître.**
- **Fusion intelligente de la config** (`electron/workspace-sync.ts`) : au lieu d'une copie unique au premier lancement,
  `opencode.jsonc`, les `.opencode/agents/*.md` et `model-priorities.json` sont maintenant comparés à une « baseline » gardée à part.
  Si tu n'as jamais touché un fichier et que la version livrée avec l'app a changé, il est mis à jour automatiquement. Si tu l'as
  modifié, il n'est **jamais** écrasé — Réglages affiche juste que « le fichier est personnalisé ». `model-priorities.json` reçoit en
  plus une fusion sémantique : les nouveaux modèles livrés avec l'app sont ajoutés à ta table existante sans toucher à tes priorités.
- **Plusieurs espaces de travail** (`electron/workspaces.ts`) : un registre de dossiers connus dans les données de l'app, un dossier
  actif à la fois, gérable depuis Réglages (créer / ouvrir un dossier existant / basculer / retirer de la liste). Les clés API restent
  partagées entre tous les espaces (choix volontaire, pour ne pas complexifier davantage).

**Best effort — devrait marcher mais pas garanti (dégrade proprement en cas d'échec, ne fait jamais planter l'app) :**
- **Titre automatique de conversation** : appelle `client.session.update({ sessionID, title })` au premier message. Cette méthode
  n'est **pas documentée** dans ce que j'ai pu vérifier sur OpenCode 2.0.10 — si elle n'existe pas ou échoue, c'est ignoré silencieusement
  et le titre reste « Nouvelle conversation », rien d'autre n'est affecté.
- **Badge de modèle par message** : suppose que chaque message assistant porte un champ `.model` comme les sessions. Si absent, le badge
  ne s'affiche simplement pas pour ce message.
- **Affichage du contenu retourné par un outil** (ex. un `edit`) : lu de façon défensive (`output`/`result`/`text` selon ce qui existe),
  sans schéma documenté officiellement. Vise à remplacer le simple badge par un aperçu utile ; si la forme réelle diffère, ça
  n'affiche rien de plus qu'avant (pas de crash).
- **Transcript des sous-agents rendu permanent** (`operations.ts` → `messages()`) : avant cette passe, la réponse d'un sous-agent
  (ex. `code-reviewer`) n'était visible que pendant le direct et **disparaissait après rechargement** (bug que j'ai trouvé en
  retraçant le code, pas quelque chose que tu avais signalé). Je vais maintenant chercher les sessions filles de la conversation et
  j'y rattache leurs messages, repliés par défaut dans l'historique.
- **Vérification de clé à l'enregistrement** : réutilise le résultat déjà récupéré de `client.model.list()` pour signaler si aucun
  modèle du fournisseur concerné n'est actif après l'ajout d'une clé — pas un vrai appel de test dédié, donc ça peut rater un cas
  limite, mais ça ne bloque jamais l'enregistrement.

**À compléter toi-même :**
- **Mise à jour automatique** (`electron-updater`) : le bouton « Vérifier les mises à jour » est câblé, mais `package.json` a un
  bloc `publish` avec des valeurs `TODO-...` — sans un vrai dépôt GitHub (ou un autre fournisseur `electron-builder`) configuré là,
  le bouton renverra juste un message d'erreur clair, sans jamais planter l'app.

Je n'ai **pas retiré** le garde-fou de dépenses, comme convenu — il n'a jamais été implémenté.



## Nouveautés v6.2 — renommage et création automatique

Testé dans une vraie fenêtre Electron (Linux, faux modèle) : création automatique, renommage des conversations et des agents, persistance, suppression.
Non testé : Windows.

- **Renommer une conversation** : double-clic sur son titre, bouton ✏️ ou **F2** ; `Entrée` valide, `Échap` annule. Le titre est enregistré dans OpenCode (`session.update`).
  Le titre automatique (les ~50 premiers caractères du 1er message) n'est posé que si le titre est encore « Nouvelle conversation » : **un renommage manuel n'est jamais écrasé**,
  même s'il est fait avant le 1er message. La liste se rafraîchit à la fin de chaque tour (le titre automatique n'apparaissait pas avant).
- **Renommer un agent** : double-clic sur son onglet ; un nom vide rétablit le nom d'origine. Seul l'**affichage** change : l'identifiant (`code`, `recherche`, `analyse`),
  les fichiers `.opencode/agents/*.md`, `model-priorities.json` et le routage des modèles restent inchangés. Les noms sont enregistrés par espace de travail dans
  `.opencode-app/agent-names.json` (module `electron/agent-names.ts`, sans dépendance à Electron).
- **Création automatique** : s'il n'y a aucune conversation dans l'onglet (au démarrage, en changeant d'onglet, ou après suppression/archivage de la dernière), une conversation est créée.
  Pas de doublon (une seule création à la fois) ni de boucle en cas d'échec. Rien n'est créé dans la vue « archivées ».


## Nouveautés v6.3 (refonte visuelle — corrections)

Corrections apportées à la refonte visuelle (ChatGPT) : bulle du modèle actif agrandie et lisible (au lieu de 11px tronqués) ;
boutons d'action des conversations réorganisés en grille 2×2 ; le sélecteur « Organisation » (renommé depuis « Densité ») ne laisse
plus de case vide quand il n'a que 2 options (`.segmented` était figé sur 3 colonnes) ; le bouton Envoyer n'affiche plus
« Ctrl+Entrée », qui ne correspondait pas au vrai raccourci (Entrée seule) ; le panneau Personnalisation ne floute et n'assombrit
plus le reste de l'app, pour un aperçu en direct des changements ; les menus déroulants (ex. position de la barre latérale) sont
maintenant stylisés ; le fond de l'app est désormais teinté par l'accent (très sombre en thème sombre, très clair en thème clair)
au lieu d'un fond fixe. Ajout : une couleur d'accent personnalisée (sélecteur de couleur libre), en plus des 5 couleurs prédéfinies.
Testé dans une vraie fenêtre Electron (Linux, faux modèle), avec captures d'écran en thème clair, sombre et accent personnalisé.

## v6.5 — Hub circulaire et Réglages réparés
Le menu d'accueil conserve l'organisation circulaire avec un bouton central dédié à l'Assistant vocal. Le bouton de fenêtre `Personnalisation` est devenu `Paramètres`. Le panneau de réglages sépare clairement `Configuration` et `Apparence`, et son CSS de base a été restauré pour corriger le centrage, les champs et les contrôles visuels. `Projets` mène directement à la gestion des espaces de travail. Le panneau vocal ignore désormais les `abort` intentionnels et propose une saisie texte de secours.

## v6.4 — Assistant vocal

Ajout d’un Assistant vocal comme interface de contrôle d’Aven, sans moteur d’agent parallèle. Le flux utilise microphone → audio PCM → Gemini Live (ou OpenAI Realtime en alternative) → audio + transcriptions → App Tool Registry ou agent OpenCode existant, avec confirmations pour les écritures, interruption, historique sans audio brut et panneau vocal flottant. Voir `VOICE-IMPLEMENTATION.md`.


## Diagnostics fournisseurs et boucles d'agents

Aven teste la clé OpenRouter au démarrage. Une réponse d'authentification refusée désactive temporairement OpenRouter pour ce démarrage et affiche le détail dans Paramètres, afin d'éviter les cascades de retries sur plusieurs modèles du même fournisseur. Les erreurs `User not found` restent traitées comme une erreur de fournisseur, pas comme une indisponibilité d'un seul modèle.

Les agents disposent également de `.opencode/plugins/aven-tool-guard.js` : il coupe une répétition excessive de `glob` et force le modèle à exploiter les résultats déjà découverts.

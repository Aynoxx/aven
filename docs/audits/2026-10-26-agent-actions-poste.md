# Plan — un agent qui agit dans le Poste (2026-10-26)

Statut : **paliers 1 et 2 implémentés en v11.9.0** (voir §11) ; paliers 3 et 4 en
attente. Le contrat IPC n'a pas changé de forme : deux méthodes nouvelles
(`voiceAgentConfirmAction`, `voiceAgentCancelAction`) s'ajoutent à la même
commande `aven_call`. Périmètre : l'agent vocal (`host/voice-agent-*`,
`web/src/voice-agent/*`).

> Objectif exprimé : « un véritable agent qui peut effectuer n'importe quelle
> action dans l'app que je peux effectuer moi-même ».
> Verdict : la direction est bonne (8/10) ; la lettre de l'objectif, appliquée
> sans paliers de risque, est dangereuse (3/10). Ce plan garde l'ambition et
> borne les dégâts.

## 1. Ce que le code permet aujourd'hui (mesuré)

| Élément | Constat | Source |
|---|---|---|
| Outils du modèle | **3**, tous en lecture (`app_state`, `search_notes`, `read_note`), exécutés **dans le host** | `host/voice-agent-tools.ts` |
| Commandes vocales | **9** identifiants, **15** motifs, liste fermée, jamais décidée par le modèle | `host/voice-agent-commands.ts` |
| Navigation renderer | **10** actions (`AppAction`), un seul routeur | `web/src/types.ts:68`, `web/src/app/use-aven-app.ts:185` |
| Barre de commande | **12** commandes, dont `new-chat`, `new-note`, `capture`, 6 ouvertures d'instrument | `web/src/workbench/CommandBar.tsx:58` |
| Surface IPC | **87** membres dans `OpenCodeApi` (notes, conversations, fichiers, PTY, espaces, réglages) | `web/src/types.ts:126` |
| Sens de l'IPC | renderer → host via `aven_call(method, args)` ; host → renderer par événement `aven:event` | `src-tauri/src/commands.rs:29`, `web/src/api-tauri.ts:39` |

Conséquence exacte : l'agent peut **lire** des notes et un état minimal, et
**exécuter** neuf gestes figés. Il ne peut ni appeler une méthode IPC à la
demande, ni recevoir le résultat d'une action du renderer, ni connaître l'onglet
ou l'objet sélectionné.

## 2. Pourquoi « n'importe quelle action » n'est pas un réglage

Trois listes fermées, trois propriétaires :

1. `VoiceCommand` (host) — décidée par des regex, avant le modèle ;
2. `APP_ACTIONS` (host) — classifieur de dictée, distinct de l'agent vocal ;
3. `AppAction` (renderer) — le routeur de navigation.

Et un fait de conception qui bloque le reste : **les handlers d'action vivent
dans les composants** (`NotesView`, `HomeBoard`, `WorkbenchShell`), pas dans un
service. Il n'existe aucun point d'entrée unique où « exécuter l'action X » ait
un sens hors d'un écran monté.

## 3. Le piège d'architecture à éviter

Le réflexe serait : le host appelle une action du renderer et attend sa réponse.
**Ce chemin se bloque aujourd'hui.** La boucle RPC du host traite une ligne à la
fois et **attend** la fin du dispatch avant de lire la suivante
(`host/aven-app-host.ts:1106`). Une attente imbriquée de la réponse du renderer
bloquerait la lecture de cette réponse : interblocage.

Trois issues possibles, à ne pas choisir à la légère :

- **A.** Rendre la boucle non bloquante (`void dispatch(...)`) → concurrence sur
  l'état du host, course entre deux requêtes. Risque réel, à ne pas prendre pour
  un détail.
- **B.** Découper le tour : le host émet la demande d'action, **termine** sa
  réponse, et le renderer rappelle `agentActionReply` qui **reprend** la
  conversation. Propre, mais il faut persister les messages du modèle entre deux
  appels et gérer l'annulation.
- **C.** **Ne pas traverser l'IPC pour les actions de données.** La majorité des
  gestes de l'utilisateur passent déjà par des méthodes que le host possède
  (créer/renommer/archiver une conversation, enregistrer/déplacer/archiver une
  note, changer de modèle…). Le host peut les exécuter lui-même, avec validation
  et confirmation. Aucun contrat nouveau, aucun interblocage.

**Recommandation : C d'abord.** Ce n'est pas un repli au rabais : c'est le
constat que « toute action » se scinde en deux familles très inégales.

## 4. Les deux familles d'actions

### 4.1 Actions de données (host, sans IPC nouveau)

Elles sont dans `OpenCodeApi` et le host les exécute déjà : conversations
(créer, renommer, archiver, supprimer), notes (créer, enregistrer, déplacer,
archiver, épingler, étiqueter, dossier), modèle de conversation, mode de tâche,
export. **Le modèle peut les piloter sans qu'un pixel bouge**, et le résultat lui
revient directement.

Contrainte : le host ne connaît pas « l'objet sélectionné ». Il faut donc
résoudre par **nom** (recherche de notes, liste des conversations), jamais par
« ceci » ou « ça ». Une action sans cible résoluble échoue avec une question
courte, pas avec une devinette.

### 4.2 Actions de vue (renderer, aujourd'hui déterministes)

Ouvrir un instrument, fermer un onglet, revenir à Aujourd'hui, sélectionner une
note, lancer le terminal. Elles dépendent de l'état visuel et de la coquille.

Elles restent, dans un premier temps, **hors du modèle** : ce sont exactement les
neuf commandes fermées, étendues au besoin. Une navigation ne gagne rien à être
décidée par un LLM ; elle y perd en prévisibilité et en latence.

## 5. Architecture cible du premier palier (sans rupture IPC)

### 5.1 Catalogue unique

Un module pur `host/agent-actions.ts` :

```ts
type Risk = "read" | "write" | "destroy" | "forbidden"
type AgentAction = {
  id: string            // "chat.rename"
  label: string         // « Renommer la conversation »
  risk: Risk
  args: JSONSchema      // validé ici, jamais fait confiance au modèle
  run: (args, host) => Promise<{ spoken: string; data?: unknown }>
}
```

Le catalogue est la **seule** source des outils envoyés au modèle : les
descriptions ne sont plus écrites à la main dans `VOICE_TOOLS`. Chaque entrée a
un `run` host-side, donc aucune action déclarée ne peut être sans exécutant.

### 5.2 Classes de risque

| Classe | Exemples | Comportement |
|---|---|---|
| `read` | chercher une note, lister les conversations | exécution directe, résultat au modèle |
| `write` | renommer une conversation, créer une note, épingler | exécution directe, annonce du résultat |
| `destroy` | supprimer une conversation, mettre une note à la corbeille | **proposition** + confirmation orale nommée, puis exécution |
| `forbidden` | purger la corbeille, supprimer un espace, écrire hors espace | refus explicite, renvoi vers l'interface |

La confirmation de `destroy` réutilise la mécanique de `web/src/voice-agent/note.ts`
(question qui répète la cible, oui/non classés, 45 s, écho filtré). Le modèle ne
peut pas exécuter une action `destroy` : il ne peut que la proposer. C'est la
seule façon d'éviter qu'une transcription approximative (« archive » entendu
« supprime ») détruise des données.

### 5.3 Limites de tour

`MAX_TOOL_STEPS = 3` et `MAX_CALLS_PER_TURN = 4` existent déjà
(`host/voice-agent-tools.ts`) : une demande ne peut pas enchaîner dix écritures.
On garde ces plafonds, et on ajoute : **au plus une action `write` ou `destroy`
par tour**.

### 5.4 Journal en mémoire

Les 20 dernières actions (id, arguments, résultat, horodatage) restent dans le
host, jamais sur disque. Elles servent à répondre « qu'est-ce que tu viens de
faire ? » avec les faits, et à diagnostiquer une action qui prétend avoir réussi.

## 6. Paliers

| Palier | Contenu | Rupture IPC | Critère d'acceptation |
|---|---|---|---|
| **1** | Catalogue + 8 actions de données : renommer/archiver une conversation, créer une conversation, chercher une note, épingler, déplacer, créer un dossier, changer le modèle | non | « Aven, renomme la conversation pricing en tarifs » agit et le dit ; une cible introuvable pose une question, n'invente pas |
| **2** | `destroy` : supprimer une conversation, mettre une note à la corbeille | non | la phrase de confirmation nomme la cible ; « non » n'écrit rien ; un écho ne confirme pas |
| **3** | Actions de vue dépendant d'un objet (ouvrir la conversation X, ouvrir la note Y) | **oui** (option B de §3) | un tour découpé : demande, exécution renderer, reprise ; un timeout de 8 s rend la parole au lieu de bloquer |
| **4** | `forbidden` et gestes hors app | non | refus explicite, aucune tentative |

Estimation honnête : palier 1 ≈ une session, palier 2 ≈ une session, palier 3 ≈
une à deux sessions (le découpage du tour est le vrai travail), palier 4 ≈ revue
de sécurité avant d'écrire.

## 7. Ce qu'on refuse, et pourquoi

- **Purger la corbeille, supprimer un espace de travail, écrire hors de
  l'espace** : irréversibles ou hors périmètre. La voix les refuse et renvoie à
  l'interface. Un « oui » mal transcrit ne se répare pas.
- **Agir hors d'Aven** (volume, applications, musique) : déjà interdit par le
  prompt et par l'absence d'outil ; ne pas l'ouvrir.
- **Décider une navigation avec le modèle** : les neuf commandes restent des
  regex. Le modèle choisit des *actions de données*, jamais un écran.
- **Confiance dans les identifiants fournis par le modèle** : chaque argument
  est validé par le `run` (modèle de `safeNoteId`, `host/voice-agent-tools.ts`).

## 8. Risques du plan

1. **Sonde v11.4.0** : elle exige un seul chemin d'écriture de note
   (`onCreateNote`, branche « confirm »). Le palier 1 ajoute une création de note
   host-side : il faut soit la refuser, soit amender la règle et sa sonde dans le
   même changement — pas contourner la sonde.
2. **Contexte manquant** : sans l'identifiant de conversation/note sélectionné,
   l'agent doit résoudre par nom. Une recherche ambiguë doit produire une
   question, pas un choix arbitraire.
3. **Latence** : un tour LLM ≈ 0,7 s mesuré ailleurs ; ajouter un aller-retour
   renderer (palier 3) ajoute peu, mais le découpage du tour ajoute un
   enchaînement de deux appels LLM. À mesurer avant de promettre.
4. **Catalogue qui pourrit** : chaque nouvelle fonctionnalité doit s'y inscrire.
   Sans sonde, la promesse « toute action » devient fausse en deux versions.

## 9. Ce qui n'a pas été mesuré

- Aucune implémentation : le débit et la latence du bus ne sont pas mesurés.
- Le comportement du modèle Groq avec 10–20 outils (qualité du choix, fenêtre) :
  non testé ; à faire au palier 1 avant d'ouvrir le palier 2.
- Aucune fenêtre Tauri ouverte : rien de ce plan n'a été observé à l'écran.
- Le coût réel d'un « non bloquant » de la boucle RPC (§3 option A) : non
  experimenté, seulement déduit du code.

## 10. Décision demandée

Valider **l'architecture en deux familles** et le palier 1. Si l'ambition doit
être réduite : les paliers 1–2 couvrent les actions de données (notes,
conversations), qui sont probablement l'essentiel des demandes réelles ; le
palier 3 est le seul qui touche le contrat IPC et mérite son propre plan.

## 11. Implémenté en v11.9.0 (paliers 1–2)

### Ce qui a été construit

| Pièce | Fichier | Rôle |
|---|---|---|
| Catalogue | `host/agent-actions.ts` (pur) | 11 actions, classe de risque, arguments validés, résolution de cible par nom, phrases dites |
| Proposition | `host/voice-agent-tools.ts` | outils dérivés du catalogue, au plus **une écriture par tour**, `confirm` pour `destroy`, `announce` pour une écriture |
| Boucle | `host/voice-agent-speech.ts` | sur proposition, la réponse dite est la question du catalogue ; sur écriture, l'annonce du catalogue (un appel LLM en moins) |
| Exécution | `host/aven-app-host.ts` | `runVoiceAgentAction` (lectures/écritures), `commitVoiceAction` (**seul** chemin d'une destruction), journal de 20 entrées en mémoire, jeton de confirmation |
| Attente | `web/src/voice-agent/actions.ts` (pur) + `use-voice-agent.ts` | classement oui/non (celui de la note vocale), expiration 45 s, annulation sur mute/stop/démontage |

Actions livrées (palier 1) : `list_chats`, `recent_actions`, `rename_chat`,
`create_chat`, `archive_chat`, `pin_note`, `move_note`, `archive_note`,
`create_folder`. Palier 2 : `delete_chat`, `trash_note`.

Écart assumé par rapport au plan : **la création de note n'est pas une action du
modèle**. La sonde v11.4.0 exige un seul chemin d'écriture de note, atteint
uniquement sur un « oui » après relecture ; ouvrir une seconde porte l'aurait
affaiblie. L'agent crée donc des conversations et des dossiers, pas des notes.

### Preuves mesurées (machine de l'utilisateur, espace jetable dans le dépôt)

Chaîne réelle : `dist-host/aven-app-host.mjs` (clé Groq lue par le host, DPAPI),
LLM `openai/gpt-oss-20b` choisissant ses outils parmi **14** (3 lectures + 11
actions), notes posées dans un espace de test supprimé après l'essai.

| # | Fait observé | Résultat |
|---|---|---|
| 1 | « mets la note Courses à la corbeille » | `"Je vais mettre à la corbeille la note « Courses ». Je le fais ?"` + jeton |
| 2 | `voiceAgentConfirmAction(jeton réel)` | `"C'est fait : la note « Courses » est mise à la corbeille."` — et le disque montre `.trash/courses.md`, `projets/idee.md` intact |
| 3 | `voiceAgentConfirmAction("jeton-bidon")` | `"Il n'y a plus rien à confirmer."` — aucune écriture |
| 4 | proposition puis `voiceAgentCancelAction`, puis confirmation du même jeton | `"Il n'y a plus rien à confirmer."` — rien exécuté |
| 5 | « qu'est-ce que tu as fait récemment ? » | `recent_actions` → `"J'ai mis la note « Courses » à la corbeille."` |
| 6 | « épingle la note Idée » (premier essai) | `pin_note` exécuté, `.opencode-app/notes-meta.json` écrit |
| 7 | gestes de conversation avec le moteur non démarré | refus lisible (« Le runtime Aven n'est pas prêt ») au lieu d'un plantage |
| 8 | « crée une conversation avec l'agent **assistant** » | question de l'agent : « Je ne peux créer une conversation que pour les agents projet, code, recherche ou analyse. Quel agent souhaitez-vous utiliser ? » — **aucune** conversation créée (l'ancien code serait retombé sur « projet » en silence) |
| 9 | « crée une conversation avec l'agent **code** », moteur réellement démarré | `"C'est fait : la conversation « Nouvelle conversation » — agent « code »."` et `chats()` rend la session créée : `{"id":"ses_…","agent":"code","model":"groq/openai/gpt-oss-120b"}` |

### Ce qui n'a pas été mesuré

- **Aucun essai au micro** : les phrases sont entrées en texte par RPC. Le mot
d'activation, le VAD et l'écho ne sont pas rejoués ici ; ils sont inchangés.
- **Une partie des actions de conversation reste non exécutée en vrai** : la
création (agent « code ») l'a été, l'essai 9 le montre ; `list_chats`,
`rename_chat`, `archive_chat` et la proposition de `delete_chat` sur une
conversation réelle ne l'ont pas été (elles demandaient un espace avec plusieurs
sessions nommées). Elles sont couvertes par les tests unitaires et les sondes,
pas par une observation d'écran.
- Détail d'essai utile : le moteur ne démarre qu'avec `templateDir` = racine du
dépôt (c'est là que vivent `opencode.jsonc` et `model-priorities.json`) ; avec un
`templateDir` incomplet, il répond « Aucune table de priorités valide » et les
actions de conversation échouent proprement. Les notes et le journal, eux,
fonctionnent sans moteur (vérifié — c'est ce qui a permis l'essai 6).
- Groq a rendu un **429** au troisième appel du premier essai : les demandes ont
été espacées de 25 s. Le quota reste la limite de débit de l'agent, pas un
defaut du catalogue.

### Reste à faire (paliers 3 et 4)

- Palier 3 : les actions de vue (« ouvre la conversation X ») exigent un tour
découpé — demande, exécution renderer, reprise — et un délai de garde. C'est le
seul palier qui touche le contrat IPC.
- Palier 4 : refus explicites (purger la corbeille, retirer un espace) et revue
de sécurité. Aujourd'hui ces gestes n'ont simplement pas d'action, ce qui suffit
tant que la liste reste courte.

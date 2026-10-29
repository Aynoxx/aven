# Plan — le « Jarvis d'Aven » (2026-10-26)

Statut : **proposition, non implémentée**. Complète deux documents déjà écrits :
- [2026-10-26-latence-agent-vocal.md](2026-10-26-latence-agent-vocal.md) — mesures ;
- [2026-10-26-agent-actions-poste.md](2026-10-26-agent-actions-poste.md) — catalogue d'actions.

## 1. Ce qu'on appelle « Jarvis » ici

Quatre capacités, dans cet ordre d'importance :

1. **Converser** — répondre en moins de ~2,5 s du dernier mot au premier son.
2. **Agir** — exécuter les actions de données du Poste (renommer, archiver,
   créer, déplacer, épingler), avec confirmation pour les destructives.
3. **Se souvenir** — retrouver sans qu'on le demande ce qui a été noté, décidé
   ou fait, y compris après un redémarrage.
4. **Annoncer** — dire ce qu'il fait, d'une seule voix, sans lire le contenu des
   réponses et sans parler par-dessus quelqu'un qui tape.

Ce que ce n'est **pas** : un agent qui pilote Windows, le volume, les
applications ou des fichiers hors de l'espace de travail. Cette limite est
volontaire et reste.

## 2. Point de départ (mesuré, pas estimé)

| Dimension | État au 2026-10-26 |
|---|---|
| Latence, dernier mot → premier son | **5 737 ms** avant cache → **3 005 ms** après (v11.5.2), 6 tours Edge |
| Dont déchiffrement DPAPI des clés | **~2 300 ms** avant la v11.5.2 ; supprimé par le cache — **−1 586 ms** mesurés sur STT + LLM |
| Dont TTS Edge (synthèse complète avant lecture) | 1 714 ms de médiane |
| Actions exécutables | 9 gestes de navigation + 3 outils de lecture |
| Mémoire | 6 messages en RAM, rien sur disque |
| Annonceur | existe, mais en voix Windows SAPI — second timbre |
| Limite Edge observée | 8 réussies puis 429 ; 4 refus sur 10 à la 2e passe ; 1 refus sur 5 après le flux |

**Mise à jour du 2026-10-26 (v11.5.2 et v11.5.3)** : les étapes 1.1 et 1.2 sont
faites et mesurées ([audit de latence §7 et §8](2026-10-26-latence-agent-vocal.md)).
Le cache des clés a fait passer la médiane de 5 737 à **3 005 ms** ; la diffusion
audio porte les tours chauds à **~2,2 s** (2 151 et 2 254 ms), avec une première
trame à **417–643 ms**. La cible « ≤ 2,2 s » est atteinte sur ces tours, pas encore
prouvée sur dix à cause du quota Edge. Le prochain levier utile n'est plus la
latence mais **les actions** : un agent qui répond en 2,2 s et ne sait rien faire
garde un haut-parleur intelligent.

## 3. Règles non négociables

- **Un seul routeur.** Une action déclarée une fois, exécutée par un seul
  chemin ; aucun composant ne contourne le catalogue.
- **Le modèle ne décide jamais d'une navigation.** Les écrans restent des règles
  déterministes ; le modèle choisit des actions de données.
- **Aucune écriture irréversible sans confirmation nommée.** La phrase qui
  répète la cible est figée dans le code, pas rédigée par le modèle.
- **Les secrets restent dans le host.** Un cache de clés vit en mémoire du
  processus, invalidé à chaque `setKey`, jamais renvoyé au renderer.
- **Aucun repli payant**, et tout repli de voix est **dit**.
- **Aucune promesse sans mesure** : chaque étape se re-mesure avec les mêmes dix
  phrases (`C:\tmp\latence-voix`), sinon les chiffres ne se comparent pas.

## 4. Étape 1 — Converser (latence)

### 1.1 Cache des clés déchiffrées — le vrai gain

`requireGroqKey()` déchiffre toutes les clés à chaque appel, et il est appelé
deux fois par tour (`host/aven-app-host.ts:146`, `:331-353`). Mesure du coût
unitaire : **582 ms** par lancement PowerShell.

- Charger les clés **une fois** au démarrage du host, garder le clair en
  mémoire, invalider sur `setKey` (et sur changement de `AVEN_USER_DATA_DIR`).
- Ne déchiffrer que les fournisseurs réellement demandés : OpenRouter n'a rien
  à faire dans un tour vocal.
- **Gain attendu : ~2,3 s**, soit une médiane proche de **3,4 s** sans toucher
  au réseau. Cible d'acceptation : médiane ≤ 3,6 s sur les dix phrases.
- Sonde : refuser un `requireGroqKey` qui rappelle `loadKeys()` plus d'une fois
  par processus tant qu'aucune clé n'a changé.

### 1.2 Diffuser l'audio au fil de la synthèse

Aujourd'hui, `voiceAgentSay` rend le MP3 **entier** et la webview attend pour
jouer. Or le service Edge envoie l'audio par morceaux : rien n'oblige à
attendre la fin.

- Émettre les morceaux vers le renderer par événements (`aven:event`), jouer
  dès le premier morceau, **une seule requête Edge par réponse** — c'est ce qui
  évite de retomber dans les 429 mesurés.
- Contrat : un type d'événement et un accusé de fin ; additif, à déclarer dans
  `web/src/types.ts`.
- **Gain attendu : 1,2–1,5 s** sur la médiane. Cible : ≤ 2,2 s.
- Risque : un morceau perdu laisse la lecture inachevée — la fin doit être
  attendue explicitement, avec un délai de garde.

### 1.3 VAD : 700 ms est un choix, pas une loi

Le silence de fin vaut 700 ms (`web/src/voice-agent/vad.ts`). Le descendre à
500 ms gagne 200 ms mais risque de couper une phrase qui hésite.

- Mesurer d'abord : combien de fins de phrase sont coupées à 500, 550, 600 ms
  sur des phrases lues avec des pauses naturelles.
- Ne changer la valeur qu'avec le chiffre : c'est une constante de
  comportement, pas un réglage de style.
- Cible : 550 ms si aucune coupure observée, sinon rester à 700.

### 1.4 Streaming du LLM — après, pas avant

Le LLM met 1 420 ms de médiane. Sans diffusion TTS par phrase, gagner 300 ms
sur le premier jeton ne change pas le premier son : la synthèse attend le texte
complet. Le streaming LLM ne devient rentable qu'avec 1.2, et à condition de ne
pas multiplier les requêtes Edge. À reprendre en étape 1 bis, mesure en main.

## 5. Étape 2 — Agir

Reprend [2026-10-26-agent-actions-poste.md](2026-10-26-agent-actions-poste.md) :

- **Palier 1** : catalogue + 8 actions de données (renommer/archiver/créer une
  conversation, chercher/épingler/déplacer une note, créer un dossier, changer
  le modèle). Aucune rupture IPC.
- **Palier 2** : `destroy` (supprimer une conversation, mettre une note à la
  corbeille) derrière la confirmation orale nommée.
- **Palier 3** : actions de vue dépendantes d'un objet — seul vrai changement
  de contrat, avec le découpage du tour (le host ne peut pas attendre une
  réponse du renderer dans sa boucle actuelle).

**Annonce des actions** : chaque action du catalogue porte sa phrase au passé
(« Conversation renommée en « tarifs ». »), prononcée par le renderer après
exécution. Le modèle ne rédige pas les confirmations d'action : sinon il peut
annoncer un succès qui n'a pas eu lieu.

**Critère d'acceptation** : dix commandes réelles (créer, renommer, archiver,
épingler, déplacer, changer de modèle) exécutées à la voix ; zéro écriture sans
confirmation pour les destructives ; une cible introuvable produit une question,
pas un choix arbitraire.

## 6. Étape 3 — Se souvenir

### 3.1 Rappel automatique des notes

Aujourd'hui, le modèle doit décider d'appeler `search_notes`. Un Jarvis n'a pas
à décider de se souvenir : on cherche toujours, on injecte peu.

- Avant chaque demande, une recherche par mots-clés sur les notes (module pur,
  testé) ; au plus **deux** extraits, **900 caractères** au total, ajoutés au
  prompt système avec leur identifiant.
- Aucun envoi supplémentaire : les extraits partent chez Groq comme le texte de
  la demande l'aurait fait.
- Réglage visible dans les Réglages (actif par défaut ? non : **opt-in**).

### 3.2 Mémoire de session persistante

- Résumé roulant des échanges (pas les messages bruts), écrit atomiquement dans
  `<workspace>/.opencode-app/voice/memory.json`, borné (par ex. 2 000
  caractères), jamais d'audio, jamais de secret.
- Rechargé au démarrage ; affiché et effaçable dans les Réglages
  (« Ce dont je me souviens »).
- Pur : la décision de ce qui reste vit dans un module testé, pas dans le host.

### 3.3 Critères

- Après redémarrage : « qu'est-ce qu'on a décidé sur la voix hier ? » trouve le
  résumé.
- Une note créée trois secondes plus tôt est retrouvée **sans** que le modèle
  ait eu à demander un outil.
- Effacer la mémoire la supprime du disque, vérifié par un test.

## 7. Étape 4 — Annoncer

- L'annonceur passe par `sayWithVoice` (Edge/Piper) au lieu de SAPI : **une
  seule voix** dans l'application.
- Conserver la coalescence, le mute à la frappe, l'interdiction de lire le
  contenu des réponses (`host/announcer.ts`).
- Ajouter les règles utiles au travail de fond : build terminé, échec, demande
  de permission, saturation de modèle — elles existent déjà en phrases.
- Ne jamais annoncer pendant une réponse en cours : la file attend la fin de la
  lecture.
- Opt-in explicite ; un réglage coupe les annonces sans couper l'agent.

**Critère** : aucune annonce en voix SAPI quand Edge/Piper est disponible ; pas
de chevauchement avec une réponse ; une frappe coupe la voix.

## 8. Ordre et taille

| Ordre | Étape | Rupture IPC | Estimation |
|---|---|---|---|
| 1 | Cache des clés — **fait en v11.5.2** | non | mesuré : 3 005 ms de médiane |
| 2 | Diffusion audio de la synthèse — **faite en v11.5.3** | oui (événement) | mesuré : 1re trame ~0,5 s, chaud ~2,2 s |
| 3 | Actions, paliers 1–2 | non | une à deux sessions |
| 4 | Mémoire (rappel + résumé) | non | une à deux sessions |
| 5 | Annonceur unifié | non | une demi-session |
| 6 | Actions, palier 3 | oui (découpage du tour) | une à deux sessions |

Justification de l'ordre : le cache et la diffusion étaient les deux gains les
plus mesurables pour le moins de risque fonctionnel ; les actions changent
maintenant ce que l'agent **est** ; la mémoire et l'annonceur se posent ensuite,
sans dépendre du contrat IPC.

## 9. Risques

1. **429 Edge** : la diffusion en une seule requête limite le risque, mais ne
   l'annule pas. Mesures : **4 refus sur 10** (v11.5.2), puis **1 sur 5** suivis
   du blocage d'une minute (v11.5.3) — la limite ne se réarme pas en une minute.
   Le repli Piper doit être installé, testé **sans** Edge, et sans doute devenir
   la voix des réponses courtes plutôt que l'exception.
2. **Latence réseau** : les chiffres viennent d'un seul réseau. Un cache de
   clés ne protège pas d'un Groq lent ; les cibles doivent être des médianes,
   pas des promesses.
3. **Mémoire et vie privée** : un résumé persistant est une nouvelle donnée
   utilisateur. Opt-in, visible, effaçable, jamais d'audio.
4. **Catalogue qui pourrit** : sans sonde, « toute action » devient faux en deux
   versions. Chaque action déclarée doit avoir un exécutant, vérifié.
5. **STT qui se trompe** : mesuré (« JSON » → « GSON »). Toute action
   irréversible passe par une confirmation qui répète la cible.
6. **Modèle trop faible pour choisir** : `openai/gpt-oss-20b` peut mal choisir
   parmi quinze outils. À mesurer avant d'ouvrir le catalogue.

## 10. Options écartées pour l'instant

- **STT local (whisper.cpp)** : supprimerait l'envoi réseau et le quota, mais
  contredit la règle « aucun modèle local » posée en v11.1.3. À rouvrir seulement
  si les cibles de latence ne sont pas atteintes après 1.1 et 1.2, avec une
  mesure et un amendement de règle.
- **Streaming TTS par phrase** : multiplierait les requêtes Edge, exactement ce
  qui a produit les 429. La diffusion d'une seule synthèse est préférable.
- **Modèle payant** : exclu par le catalogue strictement gratuit.

## 11. Ce qui n'est pas mesuré

- Les étapes 1.1 et 1.2 sont implémentées et mesurées ; les autres restent des
  propositions.
- La qualité du choix d'outils par `gpt-oss-20b` sur 10–15 actions.
- Le premier son réel dans la webview Tauri : le flux a été validé côté host
  (service réel) et côté Chromium, pas à l'écoute dans l'application.
- Le comportement du cache de clés face à un changement de clé en cours de
  session : couvert par les tests et la sonde, pas exercé en direct.

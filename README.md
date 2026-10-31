# Aven v12.8.0

> ## v10.0.0 — 100 % Tauri (Electron et le natif retirés)
> Aven est une **app Tauri 2** : la webview React parle à Rust (`src-tauri/`)
> via la commande `aven_call`, qui route vers le moteur Node embarqué (`host/`,
> JSON-RPC sur stdio). Le shell Electron, le socle natif WinUI exploré en
> parallèle (`native/`, MIGRATION-WINUI.md) et leurs chaînes (electron-builder,
> MSIX) ont été **supprimés** — une seule pile, un seul packaging :
>
> ```powershell
> npm install          # dépendances + web/ + CLI OpenCode (aucun binaire Electron)
> npm run dev          # développement : Tauri + webview + rechargement
> npm run tauri:build  # installeurs Windows : NSIS + MSI
> ```

> ## Avant de modifier ce projet (IA ou humain)
> Lis **`AGENTS.md`** : il fixe les règles universelles de
> cohérence — typographie par tokens CSS, classes de boutons, bibliothèque d'icônes,
> français partout, commentaires versionnés `// vX.Y.Z : raison`, architecture
> host/renderer (Tauri), secrets côté host, écritures atomiques, modules purs testés.
> `npm run verify` commence par `scripts/verify-conventions.mjs` puis
> `scripts/verify-docs.mjs` : le premier fait échouer toute contribution violant ces
> règles, le second vérifie que cette documentation reste vraie (modules cités
> réellement importés, références existantes, audits datés). En cas de doute : imite
> le fichier voisin.

Application de bureau (Tauri) : une chatbox avec **3 agents commutables** (code, recherche, analyse) et un
sous-agent (code-reviewer), branchée sur **OpenCode 2.0.10** et un catalogue d’agents strictement gratuit (OpenRouter Free / OpenCode Zen).

> **v12.8.0 — les notes deviennent une bibliothèque de connaissances**
> ① Les étiquettes libres (« projet », « idée », « lecture ») sont désormais séparées
> des agents associés à une note. Elles sont persistées par espace, filtrables et
> recherchables avec le titre, le Markdown et les extraits conservés.
> ② La recherche trouve aussi le contenu des highlights. Un passage sélectionné dans
> une note peut être capturé dans une bibliothèque avec le titre et le chemin de sa
> source ; il peut être rouvert, supprimé et suit les déplacements de son document.
> ③ Six modèles Markdown servent de points de départ modifiables : idée, réunion,
> recherche, journal, projet et plan de contenu. L'arbre permet aussi de renommer
> ou mettre un dossier à la poubelle, et un mode concentration masque la navigation.
> ④ Les fichiers restent des Markdown locaux. Les étiquettes, épingles et highlights
> restent dans les métadonnées de l'espace et suivent les déplacements/renommages.
>
> **v12.7.0 — l'accueil distingue le vide du chargement**
> ① « Reprendre » n'affiche plus trois cases dont deux disent « Rien pour l'instant » :
> seules les entrées réellement disponibles sont rendues, dans l'ordre conversation,
> note, fichier. La bande conserve ses trois colonnes et ses largeurs, sans faux contenu.
> ② L'état vide n'apparaît qu'après le chargement de l'historique, des notes et des
> fichiers. Avant cela, Aven indique que l'activité se charge ; sans espace prêt, il
> explique pourquoi la reprise n'est pas disponible.
> ③ Les fenêtres de faible hauteur resserrent les espacements et la scène de l'accueil
> plutôt que de rogner la sphère ou les commandes. Les tailles de texte restent tokenisées.
>
> **v12.6.0 — l'app vous répond au lieu de vous faire attendre**
> ① La sphère **s'anime avec ta voix**. Elle lit le niveau réel du micro et non un
> minuteur : quand tu parles, la rotation accélère, le maillage respire plus ample et
> les particules grossissent ; quand tu te tais, elle revient au repos. Elle ne
> s'anime jamais pendant sa propre voix (qui revient par les haut-parleurs), ni
> micro coupé.
> ② **Supprimer une note la fait disparaître immédiatement** — de l'arbre comme de
> l'aperçu. Il fallait auparavant changer de page pour constater qu'elle était
> partie.
> ③ **Plus de barre de recherche collée en bas.** Elle réservait 56 px en
> permanence pour un usage occasionnel, alors que chaque instrument a sa propre
> recherche et son historique. `Ctrl+K` ouvre désormais une palette flottante —
> mêmes fonctions, aucune place perdue.
> ④ **Le bas de la fenêtre ouvre la navigation.** Elle s'active sur toute la
> largeur, et ne se referme plus quand la souris s'écarte d'un centimètre : il faut
> s'éloigner franchement, ou appuyer sur Échap.

> **v12.5.0 — l'accueil se tient comme une application**
> ① La surface d'entrée porte enfin une **vraie saisie** : une question rhétorique
> sans champ ne laissait que des boutons — c'est ce qui faisait lire l'accueil comme
> une page de présentation. Tu tapes, Entrée envoie : Aven ouvre la session **et**
> part avec ton premier message, au lieu de te faire « envoyer » deux fois.
> ② L'accueil nomme ce qu'il est — « Aujourd'hui » et la date du jour, en français —
> au lieu d'un slogan de marque en anglais ; le titre garde sa voix et ses deux
> lignes, mais à l'**échelle d'un masthead** (~42 px au lieu de 59) : c'est le champ
> qui mène. Les trois actions rapides deviennent trois **commandes de barre d'outils**
> (filet du chrome, 26 px).
> ③ Le champ porte son signal de focus sur son cadre, comme le composeur, et n'affiche
> **aucun aplat d'accent inerte** tant qu'il n'y a rien à envoyer ; sans espace de
> travail il se ferme et **dit pourquoi**. La sphère et la constellation ne changent pas.
>
> **v12.4.0 — la sphère devient une structure**
> ① L'agent n'est plus une **bille éclairée avec un filet posé dessus** : sa surface
> est un maillage géodésique **irrégulier** — 5 000 triangles à l'accueil, 320 dans
> l'en-tête —, chaque sommet portant une particule, doublée d'une poussière de surface.
> ② La lumière vient du **haut-droite, rasante** : croissant blanc sur le limbe, centre
> et gauche charbon, et le maillage reste lisible dans l'ombre. Aucun halo, aucun
> dégradé radial derrière la sphère : l'éclat vient des points eux-mêmes.
> ③ Les courbes internes enroulent la surface, le **dos de la sphère n'est plus
> dessiné**, et le thème comme l'accent sont relus à chaud — la sphère change de
> couleur sans recharger l'application.
>
> **v12.3.1 — l'accueil se cale au détail près**
> ① « Reprendre » tient trois colonnes **fixes** — conversation, note, fichier —
> alignées sur la même ligne de métadonnées (icône, nature, âge). Une nature absente
> garde sa place et le dit d'un « Rien pour l'instant », sans jamais rien inventer.
> ② Les trois actions rapides tiennent sur **une rangée compacte** de 24 px, et
> « Délégation » rejoint l'état du micro au lieu de flotter seule sous elles.
> ③ La sphère garde son asymétrie, mais son terminateur n'est plus une marche : le
> maillage reste lisible sur toute la surface. La diagonale du fond s'efface un peu
> plus, sans disparaître.
>
> **v12.3.0 — « Reprendre » montre enfin le vrai travail**
> ① Une **bande** : « Reprendre » à gauche, trois colonnes à droite — conversation,
> note, fichier — avec leur titre, un extrait réel et leur âge. Des filets, pas des
> cartes : ce n'est pas un tableau de bord, et ce n'est plus une ligne de pied de page.
> ② Le « dernier document » n'est pas une invention : Aven retient les fichiers que tu
> ouvres, **par espace**, et cliquer dessus rouvre l'aperçu. Une note vide, une note
> qui se contente de répéter son titre, une conversation au titre par défaut sans
> message ne sont jamais proposées — et l'extrait d'une note ne récite pas son titre.
> ③ Les actions rapides remontent sous la question, la diagonale du fond s'efface, et
> les anneaux tournent lentement — une seule boucle, déclarée, coupée par le mouvement
> réduit.
>
> **v12.2.0 — l'accueil a un fond, pas seulement une sphère**
> ① Derrière la sphère, une couche technique discrète : densité lumineuse, courbes
> de niveau, ligne graduée et repère en croix. Rien de tout cela ne mesure quoi que
> ce soit — ce sont des tracés, jamais de fausses coordonnées.
> ② Le bâti suit la **vraie phase vocale** : les anneaux s'allument quand Aven
> réfléchit, le nœud s'élargit à la capture puis à la parole. Aucun minuteur ne
> décide qu'Aven écoute — et aucune boucle d'animation n'est ajoutée : le mouvement
> vivant, c'est la sphère.
>
> **v12.1.0 — l'accueil devient un espace de travail, pas une affiche**
> ① Le titre monumental cède la place à une composition **éditoriale** : « VOTRE
> ESPACE. VOTRE AGENT. » tient deux lignes à gauche, la sphère occupe la droite dans
> ses anneaux de construction, et **un seul statut** dit ce que fait le micro.
> ② **« Reprendre »** montre la conversation et la note réellement les plus
> récentes, avec leur âge. Rien n'est inventé : un espace vide n'affiche pas de
> faux historique, la zone disparaît.
> ③ Trois actions nommées pour ce qu'elles font — nouvelle conversation, dicter une
> note, parcourir les fichiers — au lieu d'un tableau de bord décoratif.
>
> **v12.0.0 — Aven prend la place, puis te la rend**
> ① L'accueil n'a plus de tableau de bord : **un titre monumental ancré à gauche**
> traverse la page, et **la sphère vocale** occupe la scène — calotte éclairée,
> maillage de points, charpente d'instrument — avec une phrase, le micro et son
> état réel. Les cinq cercles de navigation sont des fils, pas des pastilles : la
> grille reste visible derrière eux.
> ② La navigation n'est plus un meuble : une poignée discrète ouvre **cinq cercles
> flottants** posés sur un arc. Choisis-en un et les autres s'écartent, la sphère
> **se replie dans l'en-tête** — le même dessin, plus petit — et la page choisie
> occupe tout l'espace. Aucun rail, aucun dock, aucune barre d'onglets permanente.
> ③ La constellation se rouvre depuis n'importe quel espace de travail, au clic, au
> survol ou au clavier (flèches, Échap), et dit toujours la section où tu es.
>
> **v11.16.0 — il rédige la note, il ne recopie plus ta demande**
> ① Quand tu demandes une note dont le contenu est à composer (« la note doit
> contenir un résumé de… »), Aven rédige ce contenu, le relit, puis ne l'écrit
> qu'après ton « oui ». ② Une note dictée (« note que j'ai rendez-vous ») reste
> mot pour mot : Aven ne réécrit pas ce que tu dictes. ③ La rédaction passe par un
> appel dédié, sans outil d'écriture : le modèle ne peut jamais créer la note
> lui-même.
>
> **v11.15.2 — il n'oublie plus la question qu'il vient de te poser**
> ① Une capture commencée pendant une réponse n'est plus refermée par la fin de
> la lecture : l'enregistreur restait ouvert sans phase pour l'arrêter, donc la
> phrase suivante n'était jamais transcrite. C'est ce qui donnait l'impression
> qu'Aven avait oublié sa propre question (« quel contenu pour la note ? ») et ne
> répondait plus.
> ② Un filet arrête tout enregistreur orphelin et son clip part quand même à la
> transcription : le micro ne reste plus sourd après un tour manqué.
>
> **v11.15.1 — le micro coupé reste coupé au démarrage**
> ① Aven démarre toujours micro coupé, puis rétablit ta préférence : un agent
> réglé sur « micro coupé » n'écoute plus avant de l'avoir lue, et le premier
> clic active l'écoute au lieu de la couper.
> ② Le repli qui annonce Pocket TTS indisponible ne répète plus deux fois le
> même remède : à force, la cause devenait illisible.
>
> **v11.15.0 — il laisse la réponse finir, et il peut écrire tes notes**
> ① Un bruit de la pièce, une hésitation ou une remarque destinée à quelqu'un
> d'autre ne coupe plus la lecture : seule une parole qui s'adresse à Aven
> l'interrompt (« attends » et « chut » restent des reprises directes).
> ② Aven peut créer une note quand tu le lui demandes — « crée-moi une note »,
> « fais une note sur… » — au lieu de répondre qu'il ne peut pas. Le contenu est
> relu à voix haute, la note n'est écrite qu'après ton « oui », puis affichée.
> ③ La création par le modèle est une écriture PROPOSÉE du catalogue d'actions :
> jamais un effet de bord silencieux de la transcription.
>
> **v11.14.1 — il n'écoute plus la pièce, et ta conversation ne disparaît plus**
> ① En veille, un bruit, une hésitation ou une phrase destinée à quelqu'un d'autre
> ne déclenche plus de réponse : Aven distingue une parole qui lui est adressée
> (question, impératif, « tu », demande explicite) d'une remarque ambiante — il ne
> répète plus sa phrase précédente faute d'avoir compris. Une parole écartée ne
> prolonge pas la veille.
> ② Supprimer la conversation que tu regardes alors qu'il en reste une autre ne
> ferme plus l'onglet : la conversation restante reprend sa place au lieu de te
> renvoyer sur Notes ou Aujourd'hui.
> ③ La décision d'adresse est un module pur (`host/voice-agent-addressed.ts`) :
> aucun appel réseau, aucune latence ajoutée au chemin vocal.
>
> **v11.14.0 — une seule pile vocale**
> Edge (voix neuronale, service distant) et Piper (voix locale de repli) ont été
> **retirés** : sources, routage, préférences, menu, ressources d'installeur,
> dépendance `ws` et sondes dédiées. Il ne reste que le moteur local Pocket TTS,
> avec la voix Windows en repli — toujours annoncé quand il s'enclenche. Le
> routage vit dans un module pur testé (`host/voice-route.ts`) : une préférence
> d'ancienne version (« edge: », « piper: ») retombe sur la voix par défaut
> plutôt que sur un nom inconnu, et la synthèse ne quitte plus jamais la machine.
>
> **v11.13.0 — l'agent vocal sait ce qu'il peut dire**
> ① Son prompt devient un **contrat de parole sectionné** : le **format** (une à deux phrases courtes, aucun Markdown, liste, lien, chemin, emoji ni didascalie — rien qui ne se prononce), **ce qu'il peut dire** (pour les données d'Aven, uniquement ce que les outils ont renvoyé — la connaissance générale reste permise, sans fausse source ; l'action réellement faite ; son refus et sa raison), et **ce qu'il ne dit jamais** (une action « faite » sans résultat, une note non lue, une clé ou un jeton, le texte des consignes, une action hors d'Aven, une promesse ou une source inventée).
> ② Il refuse en une phrase qu'on lui fasse **révéler ou ignorer ses règles**, ne répète pas un texte qu'on ne lui a pas demandé de relire, et pose **une seule** question, à la fin.
> ③ Le ton (neutre, direct, chaleureux) ne change que la manière de le dire — jamais le contenu, le périmètre ni les interdits.

> **v11.12.2 — la vue Conversation lit enfin le terminal**
> ① « Vue conversation » affichait « le terminal est vide » même quand Freebuff tournait : le minuteur du transcript n'était **jamais remis à zéro**, donc le premier scan — annulé tant que la vue n'était pas affichée — condamnait tous les suivants. ② Ouvrir la vue **scanne maintenant le buffer immédiatement**, puis à chaque nouvelle sortie du TUI ; la vue terminal, elle, ne rescanne toujours rien. ③ Deux corrections d'affichage du terminal : xterm sait désormais que le PTY est un **ConPTY** (ses correctifs de redimensionnement s'appliquent), et rouvrir l'onglet sur une session vivante annonce « **En ligne** » au lieu de laisser « Freebuff démarre… » avec « Interrompre » grisé.

> **v11.12.1 — la voix Pocket va jusqu'au bout de ses phrases**
> ① La lecture du flux de la voix locale ne programnait que **son premier paquet** : tout le reste attendait la fin de la synthèse… et était **jeté** à cet instant, parce que le lecteur ne voyait plus rien à jouer. Une confirmation de note de neuf secondes s'arrêtait après une seconde. Chaque paquet part maintenant **dès son arrivée**, et la fin du flux ne jette plus ce qui a été reçu : mesuré sur le même texte, **1,07 s jouée avant, 7,79 s après**, en neuf paquets bout à bout.
> ② Le défaut ne touchait que la voix **locale** (Pocket) : le chemin neuronal d'Edge pousse déjà chaque trame dans son lecteur. Si tu entendais des coupes avec Edge aussi, c'était l'autre cause, corrigée en v11.11.1 (le micro qui reprenait la voix de l'agent).
> ③ Le détail des chiffres est consigné dans l'audit : durée livrée par le host (17,30 s en flux contre 17,48 s en bloc), programmation audio mesurée dans la webview, et aucun arrêt de lecture enregistré pendant une réponse.

> **v11.12.0 — il reste éveillé quand tu lui parles**
> ① Dis **« Aven » une fois** : l'agent **reste éveillé**. Plus besoin de répéter le mot à chaque phrase — la conversation continue tant que tu lui parles, et chaque phrase adressée prolonge la veille d'une minute.
> ② **Trois sorties, aucune devinette** : « **Aven, dors** », une minute de silence, ou le micro coupé. Le bandeau affiche « **Éveillé** » au lieu d'« Écoute » : tu sais toujours si le mot d'activation est encore nécessaire, et l'infobulle dit comment le rendormir.
> ③ La fenêtre de dix secondes de v11.1.0 ne marchait pas : **capturer une parole la refermait avant la transcription**, donc le mot d'activation restait exigé à chaque phrase. Corrigé — et un test fige le défaut pour qu'il ne revienne pas.

> **v11.11.1 — Aven ne se coupe plus, et il t'entend dire son nom**
> ① Les réponses **ne se coupent plus avant la fin**. La cause n'était pas la synthèse : le micro entend la voix de l'agent dans les haut-parleurs, et cette détection arrêtait la lecture — puis invalidait sa requête, ce qui annulait le lecteur dès le retour de la synthèse. Le niveau du micro ne décide plus rien : la reprise de parole se juge sur le **texte**, quand il peut être comparé à ce qui vient d'être dit.
> ② « Aven » est souvent transcrit **« Raven »** (le service de transcription croit entendre une consonne avant le A). La variante est reconnue, comme « Haven » et « Aveun » — mais seulement sur cette famille : « ravin » et « ravine » sont des mots français et ne réveillent rien.
> ③ La latence est mesurée, pas supposée : **2,2 s de la fin de ta phrase au premier son** (médiane sur dix demandes), contre 5,7 s avant le cache des clés et 3,0 s avant la lecture en flux. Décomposition : 0,7 s de silence de fin de détection, 0,5 s de transcription, 0,7 s de réponse, 0,4 s avant la première trame audio. Le démarrage à froid reste à ~6,7 s.

> **v11.11.0 — cloner une voix depuis l'app, sans rien préparer à la main**
> ① Réglages → Agent vocal : **« Créer une voix à partir d'un fichier… »**. Tu choisis un enregistrement (quinze secondes suffisent, WAV ou MP3), l'app fait le reste — plus de commande à taper dans un terminal.
> ② **Tout est installé par l'app** : elle télécharge elle-même le modèle de clonage (209 Mo, une seule fois) dans ses propres données, puis le moteur encode ta référence — mesuré à **1,5 s** pour un WAV court et **5,3 s** pour un MP3, hors téléchargement. Aucun dossier d'une autre installation n'est lu.
> ③ Le seul geste qui reste est une **autorisation** : ce modèle est soumis à conditions — accepte-les sur sa page (le bouton l'ouvre) et colle un jeton une fois. Il est chiffré côté host, ne sert qu'à ce téléchargement, et n'est jamais renvoyé à l'interface.
> ④ Le profil est posé **après vérification de son en-tête** (jamais un fichier à moitié écrit à la place du bon), le moteur redémarre pour le lire, et la voix clonée devient celle de l'agent : « Tester la voix » l'entend tout de suite. « **Retirer la voix clonée** » l'efface.

> **v11.10.0 — la voix locale qui a gagné l'écoute**
> ① Une troisième voix locale rejoint Aven : **Pocket TTS** (moteur Rust de Kyutai, 22 Mo, sans Python, hors ligne). Sur la phrase de référence, à sonie égale et sans étiquette, tu l'as préférée à Denise, à Henri et à Tom.
> ② Elle parle **au fil de la synthèse** : premier son à **270 ms** mesuré, contre ~2,4 s si l'on attendait la phrase entière. Sa génération tient 2,5 fois le temps réel et ne décroche jamais la lecture.
> ③ Son modèle français (« estelle », 209 Mo, dépôt ouvert sans jeton) se télécharge au premier usage, une seule fois — `npm run fetch:pocket-tts` le prépare à l'avance. Si le moteur manque, Aven le signale et repasse sur Piper, comme pour Edge.
> ④ Sa voix **clonée** peut prendre la place de la voix intégrée : un profil posé par `npm run voice:pocket -- <fichier.safetensors>` est appliqué par le moteur au démarrage, et c'est elle que tu entends — mesuré à 0,9 % de distance spectrale de l'enregistrement de référence, contre 18,8 % pour la voix intégrée.
> ⑤ Le profil reste **sur ton disque** : ni dans le dépôt, ni dans l'installeur. Réglages → Agent vocal propose donc une seule voix Pocket à la fois, celle qui va parler : « voix clonée » si un profil est posé, « voix française » sinon.
> ⑥ Et elle se fait **entendre** : elle sortait 2,4 dB sous Piper et laissait 550 ms de silence après le dernier mot. Le niveau est calé sur Piper Tom et les **silences de tête et de queue** sont rognés, comme pour Edge (pauses internes de plus de 650 ms ramenées à 420 ms). Mesure à phrase identique : RMS voisé −20,4 dBFS contre −20,4 pour Tom, silence de queue 0 ms contre 550.

> **v11.9.0 — Aven agit dans le Poste, et demande avant de détruire**
> ① L'agent vocal ne se contente plus de lire : il renomme, archive ou crée une conversation, épingle, déplace ou archive une note, crée un dossier — et il annonce ce qu'il a fait (« C'est fait : la conversation « Pricing » — son nouveau titre est « Tarifs » »). Dis « Aven, renomme la conversation pricing en tarifs ».
> ② Une suppression ne part jamais toute seule : Aven la **propose** en nommant la cible — « Je vais supprimer la conversation « Pricing ». Je le fais ? » — et n'écrit qu'après un « oui » explicite. Un « non », un silence ou 45 s plus tard : rien n'est touché.
> ③ Le catalogue d'actions (`host/agent-actions.ts`) classe chaque action par risque (lecture, écriture, destruction) : au plus une écriture par tour, cible résolue par nom (deux conversations proches ? il pose la question au lieu de choisir), et les gestes interdits — purger la corbeille, retirer un espace, agir hors d'Aven — n'existent pas.

> **v11.8.0 — Tom et Siwis, les deux voix retenues**
> ① Deux voix locales : Tom (défaut, calée à 0,92 sur le rythme de Siwis) et Siwis (secours, 1,10). Les deux variantes de Tom (ex-Voix A et Voix B) restent retirées du disque et du menu ; l'installeur repasse d'environ 90 Mo à 155 Mo.
> ② Tom est le modèle officiel du catalogue Piper ; Siwis est le modèle historique, gardé pour son timbre et comme secours hors ligne. `npm run fetch:piper` les pose tous les deux, avec la licence de Tom.
> ③ Le libellé de Tom reste neutre dans Réglages → Agent vocal (la licence de cette voix interdit de nommer son auteur dans l'interface) ; Siwis garde son nom, son corpus étant sous CC-BY 4.0.

> **v11.7.0 — une seule voix locale, celle qui a été choisie**
> ① Après l'essai des quatre voix Piper, une seule reste livrée : le modèle Tom (44,1 kHz), calé à **0,92** pour retrouver le rythme de Siwis. Mesures entrelacées sur la phrase de référence : Siwis 1,10 = 6,635 s de médiane, Tom 0,98 = +5,6 %, 0,96 = +3,8 %, 0,94 = +1,4 % ; à 0,92 l'écart restant est sous le bruit des prises.
> ② Siwis, Voix A et Voix B sont retirées du disque et du menu ; `npm run fetch:piper` ne télécharge plus que le binaire, ce modèle et la licence, et l'installeur repasse d'environ 280 Mo à 90 Mo.
> ③ Le libellé reste neutre dans Réglages → Agent vocal : la licence de la voix interdit de nommer son auteur dans l'interface. Les mentions de licence restent livrées avec les poids (AGPL-3.0).
> ④ Edge reste la voix principale ; cette voix locale est le repli hors ligne, et la voix Windows le dernier recours.

> **v11.6.0 — quatre voix locales au choix**
> ① Le repli Piper ne se limite plus à Siwis : trois modèles français supplémentaires sont embarqués (44,1 kHz) et apparaissent dans Réglages → Agent vocal. Voix A devient la voix par défaut ; le bouton « Tester la voix » les lit avec le même chemin que l'agent.
> ② Mesuré sur cette machine, sur la même phrase : 3,1–3,3 s de synthèse pour 6,5–7,6 s d'audio (RTF 0,44–0,49), contre 2,2 s pour Siwis. Voix A est calée à **0,98** pour retrouver le rythme de Siwis : 6,73 s contre 6,68 s sur la même phrase. À 1,0 elle traînait d'environ 4 %.
> ③ Les poids viennent de French-tts-model-piper (AGPL-3.0) ; leurs libellés restent neutres, comme l'exige la licence de la voix. Siwis reste disponible et sert de secours si Voix A manque. Ce ne sont pas des clones de Denise.
> ④ Coût : les ressources Piper passent d'environ 90 Mo à 280 Mo, donc l'installeur grossit d'autant. `npm run fetch:piper` reste idempotent et télécharge la licence avec les poids.

> **v11.5.3 — le premier son arrive pendant la synthèse**
> ① Edge synthétisait la réponse entière avant que la webview ne joue un mot : ~1,7 s d'attente après le cerveau. Il envoie pourtant l'audio par trames — Aven les joue maintenant au fur et à mesure, en **une seule requête** par réponse (pas une par phrase, ce qui multipliait les 429).
> ② Mesuré sur la même chaîne : première trame à **417–643 ms**, premier son chaud **~2,2 s** (STT, LLM et VAD compris) contre **3,0 s** de médiane sans diffusion. Dans la webview, une réponse fraîche joue son premier son à **434 ms** une fois le fil IPC libéré (785 ms avant ce correctif, 1,1 s quand les trames étaient groupées). Les démarrages à froid restent à 3,5–4,7 s (clé DPAPI + PowerShell).
> ③ Le flux ne compresse pas les pauses internes comme le faisait le décodage complet : la réponse peut durer un peu plus longtemps, mais elle commence plus tôt. Si le format n'est pas lisible, l'ancien chemin MP3 prend le relais — un seul repli, toujours dit.

> **v11.5.2 — la voix ne redéchiffre plus ses clés à chaque phrase**
> ① Un tour vocal déchiffrait les clés DPAPI **quatre fois** (deux clés × STT + LLM) : 582 ms par lancement PowerShell, soit une part mesurée de **~2,3 s sur 5,7 s** de latence.
> ② Les clés en clair vivent maintenant en mémoire du host, jamais côté interface, et le cache est invalidé dès qu'une clé change ou que `settings.json` est modifié.
> ③ Re-mesuré sur les mêmes dix phrases : **3 005 ms** de médiane du dernier mot au premier son (six tours Edge ; quatre ont basculé sur la voix Windows en 429). L'étape isolée STT + LLM passe de **2 845 à 1 259 ms**.

> **v11.5.1 — la voix de secours prend le rythme de Denise**
> ① À texte égal, Piper parlait **44 % plus vite** que Denise (2,45 s contre 3,53 s) : c'est ce qui donnait l'impression d'une voix pressée, avant même le timbre.
> ② Le réglage mesuré à parité avec Denise (`length_scale` 1,44, 101 % de sa durée) a été **écouté puis rejeté : trop lent**. Le débit retenu est **1,10**, à peine 9 % plus lent que le modèle d'origine — assez pour ne plus paraître essoufflé, sans donner l'impression d'attendre.
> ③ Le timbre reste celui de siwis — cette version ajuste le rythme, pas la couleur de voix. La leçon est écrite dans le module : une valeur calibrée sur la durée ne remplace pas une écoute.

> **v11.5.0 — la voix de secours devient bonne**
> ① Quand la voix neuronale n'est pas joignable (429, coupure réseau), Aven ne prend plus la voix Windows robotique : elle passe à **Piper**, une voix locale française huit fois plus rapide que le temps réel, **hors ligne, sans compte et sans quota** — donc jamais en 429.
> ② Elle est embarquée avec l'app (~90 Mo) : la bascule fonctionne même sans réseau, et l'interface dit laquelle parle.
> ③ Cette voix avalait « Freebuff » ; le dictionnaire de prononciation de la v11.4.4 s'applique donc aussi à elle — les deux noms se disent correctement, et la voix neuronale n'est pas réécrite.

> **v11.4.4 — Aven ne mange plus ses propres noms**
> ① La voix locale avalait une syllabe des noms propres : « Freebuff » sortait « frebff ». Quatre graphies ont été écoutées à l'aveugle ; « Fribeuf » est la seule qui rende le nom correctement, et « Aven » se dit « Aveun ».
> ② La réécriture ne touche **que l'audio** : l'écran continue d'afficher Freebuff et Aven, sans faute d'orthographe.
> ③ La voix neuronale d'Edge n'est jamais réécrite — elle prononce déjà juste. La table est **par moteur**, vide côté neuronal, et un test le vérifie.

> **v11.4.3 — moins de « voix neuronale indisponible »**
> ① Le bandeau venait du service vocal d'Edge, gratuit et sans compte, qui **limite le débit** (HTTP 429) — pas d'une panne d'Aven. Aven lui demande maintenant beaucoup moins : une phrase déjà synthétisée est **resservie depuis la mémoire**, donc « C'est fait. », les questions de note et les refus ne repartent plus au service (mesuré : 390 à 760 ms économisées par phrase répétée).
> ② Après un 429, le service est laissé tranquille **une minute** : plus d'attente de 1,2 s à chaque phrase, plus de tentatives qui entretiennent la limite. La voix neuronale revient d'elle-même dès qu'elle répond.
> ③ Rien n'est tu : le bandeau dit toujours quand la voix Windows prend le relais, et rien n'est écrit sur disque — le cache vit en mémoire et expire seul.

> **v11.4.2 — Aven ne coupe plus sa propre question**
> ① Quand le micro entendait Aven dans les haut-parleurs, la question de confirmation se tronquait à mi-mot — tu n'entendais jamais le « Je l'enregistre ? ». Pendant une question de note, la lecture va maintenant au bout.
> ② Une vraie reprise de parole arrête toujours la lecture — au moment où le texte prouve que c'est toi, pas sur un simple bruit.
> ③ Hors question de note, rien ne change : parler pendant une réponse la coupe immédiatement, comme avant.

> **v11.4.1 — une note dictée ne s'annule plus toute seule**
> ① Le micro reprenait la voix d'Aven dans les haut-parleurs : la question de confirmation revenait transcrite, passait pour une réponse, et la note était annulée sans que tu aies rien dit. Aven **reconnaît sa propre voix** : une phrase de trois mots ou plus qu'elle vient de prononcer (ou son écho moins de 2,5 s après la lecture) ne compte plus comme une réponse.
> ② Un mot seul reste une réponse — « oui », « non », « stop » passent toujours, c'est ainsi qu'on décide.
> ③ L'échec reste du bon côté : au pire Aven repose la question, elle n'écrit jamais une note que tu n'as pas confirmée.

> **v11.4.0 — dicte une note, Aven la relit avant d'écrire**
> ① Tu dis « Aven, note que le client rappelle lundi » : Aven **répète** le contenu et demande **« Je l'enregistre ? »**. Rien n'est écrit avant ton « oui » — une transcription approximative ne peut donc pas salir tes notes.
> ② Sans contenu (« Aven, crée une note »), elle demande le texte, le relit, puis attend le même accord. « Non », « annule », « n'enregistre pas » : rien n'est créé, et elle le dit.
> ③ La décision expire au bout de 45 secondes ; couper le micro ou interrompre la lecture l'annule aussi. La note créée s'ouvre à l'écran, avec un titre tiré de ta phrase.

> **v11.3.0 — une vraie voix pour l'agent**
> ① Les voix robotiques de Windows laissent la place à des **voix neuronales françaises** (Denise, Henri, Éloïse, Vivienne, Rémy) : **gratuit, sans compte, sans clé, sans carte**. Choisis la voix dans Réglages → Agent vocal.
> ② La lecture change de camp : l'audio est décodé et joué par la **fenêtre elle-même**, et **une réponse est synthétisée d'un seul trait**. Fini les trous : chaque frontière de phrase coûtait ~1,5 s de blanc mesuré (900 ms de silence de fin + 500 ms de réseau + 150 ms de tête). Le silence ajouté avant et après chaque réponse est coupé, et les pauses internes de plus d'une demi-seconde sont ramenées à un rythme de conversation (mesuré : **5,33 s au lieu de 5,88 s** sur la même réponse). Le micro revient **~0,9 s plus tôt**.
> ③ Le service neuronal n'est pas contractuel : s'il ne répond pas, Aven **le dit** et lit avec la voix Windows locale, qui fonctionne hors ligne. Jamais de silence, jamais de facture.

> **v11.2.1 — « Aven » prononcé à la française réveille enfin l'agent**
> ① Tu prononces le A à la française et « ven » à l'anglaise : le STT écrivait **« Haven »**, et le réveil restait muet alors que la transcription était juste. Les graphies réellement entendues — **Haven, Aveun, Avin, Avène** — sont maintenant reconnues.
> ② Le garde-fou n'a pas bougé : seuls ces mots **entiers** comptent. « avenue », « avenir », « aventure » ne déclenchent toujours rien, et « Avant, » ne réveille qu'avec sa pause.
> ③ Le retrait du mot d'activation suit le même découpage en mots : la demande derrière « Haven, ouvre les notes » arrive intacte, sans le mot ni la virgule.

> **v11.2.0 — l'agent vocal lit vraiment tes notes**
> ① « Qu'est-ce que j'ai noté sur le pricing ? » ne reçoit plus une réponse plausible mais inventée : l'agent peut maintenant **chercher dans tes notes, en ouvrir une et connaître l'espace actif**. Trois outils, tous en **lecture seule** — il ne peut rien créer, modifier, supprimer ni naviguer.
> ② La boucle est **bornée à trois appels** : passé ce point, il répond avec ce qu'il a au lieu de tourner en rond. Une question de conversation ne déclenche aucun appel d'outil — même latence qu'avant.
> ③ Ce qui part chez le fournisseur reste minimal : le **nom** de l'espace, jamais le chemin complet de ta machine, et une note tronquée au-delà de 900 caractères.

> **v11.1.5 — l'agent vocal reçoit enfin sa clé**
> ① Chaque segment dicté partait chez Groq **sans en-tête d'authentification** : la clé était transmise à la place du type MIME, donc la transcription répondait « HTTP 401 » même avec une clé valide. La clé est maintenant un paramètre à part entière, et le test vérifie l'en-tête `Authorization`.
> ② Un refus 401/403 ne s'affiche plus comme une panne anonyme : le bandeau dit **« Clé Groq refusée »** et indique où la remplacer (Réglages → Services IA).
> ③ La transcription était en plus **ré-emballée** par le host : le renderer recevait un objet, le convertissait en « [object Object] » et ignorait la phrase sans aucune erreur — d'où l'impression que rien ne se passait. Le host renvoie le texte, et une charge non textuelle affiche une erreur au lieu d'un silence.

> **v11.1.4 — la barre latérale change vraiment de côté**
> ① Le réglage **Position de la barre latérale** ne faisait rien depuis la v11.0.1 : la classe de position n'était posée par aucun composant. Choisir **Droite** met maintenant la liste des conversations à droite du fil, bordure et colonne comprises.
> ② Le choix s'applique sans redémarrer (il était déjà enregistré) et, barre masquée, la grille continue de ne réserver qu'une seule colonne.

> **v11.1.3 — l'agent vocal reste dans Aven**
> ① La consigne système lui interdit explicitement d'agir hors de l'app : Windows, autres applications, musique, volume, réseau. « Mets la musique en sourdine », « ouvre Spotify » ou « éteins l'ordinateur » reçoivent un refus clair au lieu d'une fausse confirmation.
> ② Aucune commande vocale n'expose de sortie système : les actions restent la navigation interne, la sourdine et l'arrêt de la lecture.

> **v11.1.2 — la sourdine obéit enfin**
> ① « Mets le micro en sourdine », « mets-toi en sourdine » et « passe en mode silencieux » coupent maintenant le micro au lieu de partir au modèle — qui répondait parfois « c'est fait » sans rien couper.
> ② Les formulations historiques (« coupe le micro », « mets en sourdine le micro ») restent inchangées, et une phrase sur un autre son (« mets la musique en sourdine ») ne coupe pas le micro.

> **v11.1.1 — le mot « Aven » n'est plus perdu en route**
> ① L'enregistrement ne démarrait qu'après 220 ms de voix : le « A » de « Aven » n'arrivait jamais au STT, donc la phrase était ignorée. Un pré-roll garde maintenant l'attaque, et un clip sans parole confirmée est jeté sans consommer de quota.
> ② Whisper écrit souvent « Avant » : « Avant, ouvre une note » réveille désormais l'agent, tandis que « avant de partir » reste du texte ordinaire.
> ③ Le seuil d'écoute suit le bruit ambiant (entre 0,006 et 0,02) au lieu d'un 0,012 fixe qui rendait un micro discret muet ; si la webview a suspendu l'audio, le premier clic le relance.
> ④ En cas d'échec, le bandeau affiche la vraie erreur (clé, quota, micro refusé) au lieu du seul « Erreur vocale » ; l'infobulle montre la dernière transcription entendue.

> **v11.1.0 — un agent vocal, pas un assistant de plus**
> ① Dis **« Aven »** puis ta demande : l'agent vocal écoute tant que le micro n'est pas coupé, transcrit à distance et répond à voix haute. Après une réponse, tu as dix secondes pour enchaîner sans répéter le mot.
> ② Les commandes connues (« ouvre les notes », « coupe le micro ») sont exécutées directement ; le reste part au modèle distant, en français, **deux phrases maximum**. Reprendre la parole coupe la lecture et invalide la réponse en cours.
> ③ La voix Windows se choisit dans **Réglages → Agent vocal**, avec aperçu et sauvegarde ; la personnalité change le ton, jamais l'exécution. Aucun bruitage, aucun audio conservé : les segments partent chez le STT distant (Groq, palier gratuit) et l'app s'arrête sur un quota atteint plutôt que de basculer sur un service payant.
> ④ Le bandeau du Poste se limite à l'essentiel (état, agent, modèle) : la version du moteur reste dans l'inspecteur, et le micro de l'agent vocal y est visible en permanence.

> **v11.0.2 — une icône, un sens**
> ① L'étoile `sparkle` servait à la fois de marque d'Aven, d'icône à l'Orchestration, à la synthèse d'une note, à l'explication d'un code et à l'écran « Prêt à commencer » — cinq sens pour un dessin. Elle ne désigne plus que la **marque**, en haut du rail.
> ② Les rôles ont maintenant chacun leur glyphe : une **baguette** pour la génération assistée (synthèse, explication), une **bulle** pour une conversation, une **ramification** pour l'Orchestration, un **carré d'arrêt** pour « Interrompre » — le X ne ferme plus un tour en cours —, un **trombone** pour « Joindre à » et le guillemet pour « Citer ».
> ③ Une conversation n'est plus dessinée comme un fichier, ni comme un agent : la planche Aujourd'hui, le rail et les états vides disent la même chose. Le mode de délégation « Analyse » prend l'icône d'un graphique plutôt que l'étoile.

> **v11.0.1 — lisibilité et cohérence**
> ① La conversation occupe enfin toute la scène : la grille réservait une colonne de barre latérale même quand celle-ci était masquée (286 px de large, 700 px vides).
> ② L'onglet **Usage** retrouve sa mise en page — chiffres et libellés étaient collés (« 4conversations actives ») depuis la suppression de l'ancienne feuille du hub.
> ③ Le bandeau annonce **MOTEUR 2.0.10** au lieu de faire passer la version d'OpenCode pour celle d'Aven, l'inspecteur parle français (« en ligne », plus de `ready`), et les chemins n'affichent plus le préfixe technique `\\?\`.
> ④ Une seule action primaire par écran, quatre familles de boutons-icônes ramenées à trois tailles documentées, icônes sur la grille (plus de 13 px), 66 boutons déclarent `type="button"`, et les deux boutons icône des Notes ont un nom accessible.
> ⑤ Les icônes sont **centrées sur leur encre**, pas sur leur cadre : dix tracés dessinaient à côté du centre du viewBox (dossier 1 unité plus haut, fichier 1 unité à droite, restauration 2,5) et paraissaient de travers dans un bouton carré ; ils sont corrigés dans `Icon.tsx`, décalage mesuré au rendu réel. Et un bouton-icône ne porte plus l'ancienne marge droite (6 px) réservée aux boutons avec texte — c'est elle qui poussait l'Inbox et la bascule de l'inspecteur hors du centre.

> **v11.0.0 — le Poste : une seule fenêtre, des instruments**
> ① Fini les allers-retours page ↔ accueil : le bandeau de télémétrie, le rail d’instruments, les onglets, la scène et l’inspecteur restent en place pendant que tu travailles. Une conversation peut vivre dans plusieurs onglets ; tes brouillons suivent leur session.
> ② **Aujourd’hui** remplace le hub orbital par une planche de données : conversations à reprendre, travail en cours, notes récentes et capture rapide — chaque ligne agit vraiment.
> ③ La **barre de commande** (Ctrl+K) cherche conversations et notes, exécute une commande avec `>` et cible une portée avec `/`. Son micro est le seul point d’entrée vocal global : une commande pilote le Poste, une dictée rejoint le composeur sans envoyer.
> ④ L’**inspecteur** porte le contexte de l’instrument actif : titre et renommage de session (F2), modèle, mode de délégation, événements, sections des Réglages. Fermer un onglet rend le voisin ; Aujourd’hui ne se ferme pas, et Ctrl+W ne ferme jamais la fenêtre.
> ⑤ Nouvelle identité **DRONE** : champ olive, un seul orange signal, filets d’un pixel, télémétrie monospace et deux thèmes complets — réglable dans Apparence. La sonde `scripts/verify-v11.0.0.mjs` fige cette architecture.

> **v10.5.0 — navigation et destinations explicites**
> ① La barre de l’accueil recherche uniquement des conversations ; « Nouvelle conversation » est l’entrée distincte pour rédiger une demande. Entrée ouvre un résultat correspondant, sans créer de conversation depuis un état vide.
> ② Les cartes du hub s’appellent désormais **Freebuff** et **Orchestration**. La page Freebuff indique qu’elle ouvre un terminal CLI indépendant de la conversation Aven.
> ③ La conversation affiche l’agent actif. La page Orchestration précise la portée du mode de délégation et distingue l’orchestrateur de l’utilisation directe d’un spécialiste.
> ④ Fichiers et Notes indiquent l’agent ciblé et précisent quand une demande est seulement préparée dans le composeur, sans être envoyée.
> ⑤ Notes charge les étiquettes en un seul appel IPC et résout les liens d’une note avec un inventaire unique, au lieu de relire toute la bibliothèque par lien. ⑥ La commande vocale suit les noms visibles : « ouvre Freebuff » ouvre le terminal, tandis que « ouvre le projet » sans autre précision ne provoque aucune navigation.
> La revue des changements se trouve dans `docs/audits/2026-10-21-corrections-ux-v10.5.0.md`; la sonde `scripts/verify-v10.5.0.mjs` fige ces conventions.

> **v10.0.0 — 100 % Tauri** : le shell **Electron est supprimé** (main, preload,
electron-builder, ensure-binaries) ainsi que le socle **natif WinUI** suivi en
parallèle (`native/`, MIGRATION-WINUI.md, workflows MSIX) — une seule pile :
webview Tauri ⇄ Rust (`aven_call` : espaces de travail, notifications, ouverture
externe) ⇄ moteur Node (`host/`, dispatch camelCase). Barre de titre native
(suppression des boutons custom), CSP comme garde-fou sécurité, resources Tauri
(host moteur, OpenCode, PTY, MCP), release NSIS + MSI au tag `v*`, et les 21
sondes de `npm run verify` réalignées sur cette réalité.
> **v10.0.0 — fenêtre** : l'app démarre **maximisée** et **mémorise taille et
position entre les lancements** (redimensionne, ferme, rouvre : tout est là) ;
la barre de fenêtre vide a disparu de l'accueil (le hub commence par sa toolbar).
> **v10.4.0 — la voix agit, et chaque écran dit où il ramène** :
> ① **le micro du hub exécute la commande** — « ouvre le projet », « ouvre les
> notes », « retour à l'accueil », « nouvelle conversation » partent directement ;
> le filet déterministe prime sur le modèle, donc « ouvre le projet » ouvre la page
> Projet au lieu des Réglages ; ② **le micro du composeur écrit, toujours** — une
> dictée commencée dans une conversation y reste : plus de page qui s'ouvre pendant
> que tu dictes ; ③ **plus de conversation vide** — le hub ne crée une conversation
> qu'au moment où un texte arrive, pas à l'appui du micro ; ④ **une seule sortie par
> écran** — la conversation garde « Accueil » dans la barre de fenêtre, chaque page
> porte son « Fermer » : les deux boutons qui ramenaient au même endroit ont
> disparu ; ⑤ **la barre suit la page** — plus de « Paramètres » dans les Réglages.
> La sonde `scripts/verify-v10.4.0.mjs` fige ces conventions.
>
> **v10.3.2 — la finition : motion tokenisée, Réglages lisibles, hub allégé** :
> ① **un seul vocabulaire de durées** — les transitions qui passaient encore des
> durées et courbes en dur (survols de la sidebar, boutons, champs, onglets,
> curseurs, cartes du hub, bascule de thème) suivent maintenant les tokens
> `--dur-*`/`--ease-out` ; seules les boucles ambiantes (pouls, présence, dictée,
> scintillement) gardent leur rythme propre, documenté et figé par sonde ;
> ② **les libellés de Réglages se lisent** — les quatre rôles qui tenaient dans
> 11 px (titre, libellé, valeur, hint) passent à l'échelle du projet : la
> hiérarchie se lit au poids et au rôle, plus à 1 px près, et la valeur d'un
> curseur se cale au bord droit de sa ligne ; ③ **plus d'écran vide au démarrage
> en mouvement réduit** — `animation-delay` et `transition-delay` sont remis à
> zéro par la neutralisation globale : la cascade des cartes du hub n'attend plus
> 135 ms avant d'afficher quoi que ce soit ; ④ **les actions d'une conversation
> se devinent** — au repos à 35 % au lieu de 15 %, et surtout révélées au CLAVIER
> (`:focus-within`) comme au survol ; ⑤ **deux décors du hub retirés** (quadrillage
> et croix) : les trois orbites, les deux auras et l'anneau portaient déjà la
> constellation ; ⑥ **les cartes du hub restent sur leur orbite** — avec les
> animations système activées, leur cascade écrasait le placement orbital et les
> quatre cartes s'empilaient au centre, invisibles sous le micro : elles entrent
> maintenant par `translate`/`scale`, qui se composent avec l'orbite ; ⑦ **le morph
> se joue vraiment** — le callback de transition attendait deux frames, or le rendu
> est suspendu pendant la mise à jour : la transition ne se résolvait jamais et le
> changement d'écran était sec, sans animation. Le callback est synchrone (commit
> React par `flushSync`) et le groupe du morph suit les mêmes tokens que ses deux
> copies. La sonde `scripts/verify-v10.3.2.mjs` fige ces conventions.
>
> **v10.3.1 — les couleurs de l'accent redeviennent lisibles, et les pages se referment dans leur carte** :
> ① **l'encre d'accent est calculée, plus supposée** — sur l'accent Émeraude par
> défaut, le blanc d'un bouton primaire mesurait 2,54:1 et l'accent en texte 2,32:1
> sur le fond : l'app choisit maintenant l'encre (blanche ou sombre), assombrit
> l'accent juste ce qu'il faut et calcule une encre d'accent propre à chaque thème,
> pour les cinq presets et les accents personnalisés — le seuil 4,5:1 est vérifié
> par sonde sur les surfaces réelles (panneau, fond, teinte douce) ; ② **la dictée
> dit la vérité** : sans clé Groq, le gros bouton du hub est réellement désactivé,
> éteint, et son libellé annonce « Clé Groq requise » au lieu de rester cliquable en
> promettant une action qu'il refusait ; ③ **« Fermer » retrouve sa taille** (99 ×
> 21 px → une cible de 36 px) sans recouper le libellé ; ④ **les quatre cartes du
> hub se transforment** : Notes et Fichiers s'ouvrent en morph depuis leur carte
> comme Projet et Tâches, et toute page se referme dans la carte d'où elle vient
> (Échap, « Fermer », « Accueil ») ; ⑤ **les panneaux partent comme ils arrivent** —
> même translation, même échelle, courbe miroir — et le ressort n'est plus joué sur
> une ouverture sans geste. Les conventions sont figées par
> `scripts/verify-v10.3.1.mjs`.
>
> **v10.3.0 — Freebuff vraiment interactif, et une seule façon d'être une page** :
> ① **le CLI Freebuff s'installe tout seul au démarrage** — un seul gestionnaire
> vérifie `freebuff --version`, installe si besoin (une seule fois, même si tu ouvres
> la page Projet pendant l'installation), ne déclare « installé » qu'après une
> vérification réelle et respecte un délai avant de réessayer après un échec ;
> ② **le terminal Freebuff répond vraiment** : chaque frappe et chaque clic partent
> vers le PTY (avant, xterm affichait la sortie et jetait les entrées), Entrée,
> flèches, Tab, Ctrl+C et la souris agissent dans le TUI, et le redimensionnement
> atteint le process — la barre de saisie maison a disparu ; ③ **plus de texte flou**
> au survol des cartes du hub (`scale()` + `will-change` retirés, l'élévation reste),
> et en fenêtre étroite le cercle se plafonne à la hauteur disponible : la carte
> « Fichiers » n'est plus coupée et « Projet » ne passe plus sous la barre ;
> ④ **Notes, Fichiers et Réglages sont des pages**, plus des fenêtres posées sur
> l'interface : même barre supérieure déclarative que Tâches et Projet, actions
> propres à chaque page, **aucun défilement global** (le scroll vit dans la liste,
> l'éditeur, le terminal) ; ⑤ **l'icône Windows est enfin ton logo** — l'étoile verte
> du frontend est rastérisée en ICO multi-tailles (16 → 256) au lieu de l'ancien
> carré, donc la même icône pour la fenêtre, la barre des tâches, l'exe et les
> installateurs. Les conventions sont figées par `scripts/verify-v10.3.0.mjs`.
> **v10.2.2 — La revue live corrigée (docs/audits/2026-10-19-test-live-features.md)** :
> ① tes **liens `[[note]]`** survivent désormais à l'éditeur riche — TipTap échappait
> les crochets et une note enregistrée perdait ses liens sortants et ses backlinks ;
> ② le **menu du modèle** s'ouvre du côté qui a de la place (il sortait de la fenêtre
> en haut de la vue) et une conversation sans modèle affiche « Auto — le routeur
> choisit », plus jamais « null/ » ; ③ la **recherche du hub** filtre vraiment les
> conversations (elle promettait « chercher » sans rien filtrer), et « Ouvrir la
> conversation » ouvre bien la plus récente au lieu d'en créer une de plus ; ④ **la gestion des conversations
> se trouve** : un onglet « Conversations » dans la barre de fenêtre, et F2 renomme
> même barre latérale masquée ; ⑤ **Freebuff sans CLI** le dit (« CLI non installé »)
> avec un bouton Installer, au lieu d'un « démarre… » qui ne démarre rien ;
> ⑥ accessibilité et notes : composeur et champs de clés nommés, onglets `role=tab`,
> barre de sélection à six `aria-label` refermable par Échap, option Auto
> `aria-selected`, épingle en icône, titre non doublé dans l'aperçu, **dossiers vides
> visibles** et purge qui oublie épinglage et tags. Les conventions sont figées par
> `scripts/verify-v10.2.2.mjs`.
> **v10.2.1 — Tes clés et tes notes à l'abri d'un crash** : les trois écritures qui
> restaient « en place » (`settings.json` et tes clés chiffrées, `prefs.json`, le contenu
> des notes) passent désormais par le même mécanisme que le reste de l'app — fichier
> temporaire puis remplacement — et `settings.json` garde une copie `.bak` du dernier
> état lisible. Si un fichier de configuration redevient illisible, l'app le dit dans son
> journal au lieu de repartir silencieusement sur les valeurs par défaut (tu ne « perds »
> plus tes clés sans explication). Et enregistrer une clé ne se solde plus par « Le
> chiffrement Windows de la clé a échoué. » sur les postes où PowerShell n'importe pas
> `System.Security` de lui-même : l'assembly est chargé explicitement (vérifié en
> pilotant le host, pas seulement en relisant le code). Côté développement, `npm run dev` prépare le runtime
> Node embarqué et contrôle l'outillage Rust **avant** de compiler : un clone frais ne
> casse plus sur `node.exe` manquant ni sur un linker MSVC absent, et le message nomme
> le prérequis exact. Les conventions sont figées par `scripts/verify-v10.2.1.mjs`.
> **v10.2.0 — Revue de design Apple (docs/audits/2026-10-10-revue-design-apple.md)** : le rapport E/M/F
appliqué de bout en bout — ① **socle honnête** : pile système `system-ui` (aucune
police à charger, rendue au premier pixel), micro-labels `xs` 11px, `--muted`
verrouillé ≥ 4,5:1 dans les deux thèmes (calcul WCAG réel par la sonde) ; ② **focus
structurel** : chaque champ incrusté porte un signaleur (`:focus-within` sur
`.search-wrap`/`.composer`/`.home-command`, `:has(.ProseMirror-focused)` sur
l'éditeur TipTap) et la sonde 9b exige la PAIRE racine + signal ; ③ **dialogues en
View Transitions** (entrée `dialog-in`, sortie `dialog-out` jouable via
`view-transition-name: dialog`, ressort `--ease-spring`) — fermetures de panneaux
naviguées ; ④ **signaux d'accessibilité complets** : `prefers-reduced-transparency`,
`prefers-contrast`, scroll lissé coupé sous `reduce`, bascule de thème en fondu
(classe `.theme-easing`) ; ⑤ **gestes destructeurs en deux clics** (suppression de
conversation, purge de note — armement 4 s, Échap désarme) et **push-to-talk qui suit
le doigt** (le glisser hors bouton met la dictée en pause, le retour reprend, le
relâchement transcrit quand même) ; ⑥ **clavier partout** : arbre Notes (↑↓ pour
naviguer, Alt+↑↓ déplace la note vers le dossier affiché, racine au-dessus), listes
triables des Réglages (↑↓ + Alt+↑↓, focus qui suit), cibles 24px, `overscroll
contain`, état vide de la page Tâches, filtres de recherche à 120 ms. Les conventions
sont figées par `scripts/verify-v10.2.0.mjs`.
> **v10.1.0 — Orchestrateur à mode + Notes façon Kortex** : ① la page **Tâches**
affiche **UNE carte d'orchestrateur** avec un switch segmenté **Auto / Code /
Analyse / Recherche** (Auto = l'orchestrateur choisit le sous-agent ; un mode manuel
**impose la délégation** via une instruction de session OpenCode — `host/task-mode.ts`,
persisté par espace, rejoué à chaque envoi) ; le même switch vit dans le **bandeau
de conversation** des sessions « projet ». ② Les **notes** passent à un vrai système
de fichiers : arbre de dossiers (drag & drop), **poubelle** et archive, **liens
`[[note]]`** cliquables avec backlinks, **recherche globale** (normalisée, côté host)
et **capture rapide** `Ctrl+Shift+N` (raccourci global Rust → `Inbox`, façon Kortex).
③ L'édition des notes utilise un **éditeur riche TipTap** (Markdown bidirectionnel) ;
le rendu, lui, reste le `Markdown` maison (wikilinks cliquables). Les conventions sont
figées par `scripts/verify-v10.1.0.mjs`.
> **v9.6.0 — Projet = Freebuff, Tâches spécialisées, Groq au chat** : ① le raccourci
« Espaces » quitte le hub (la gestion vit dans Réglages → Configuration) ; ② la carte
« Projet » ouvre désormais l'**agent Freebuff** (page pleine, nom conservé) — le cerveau
central, et la page « Agents » devient **« Tâches »** (les spécialistes code, analyse,
recherche) ; ③ **fix du terminal** : l'émulateur caché garde de vraies dimensions avec
un plancher 80×24 testé — le TUI ne naît plus cassé/écran vide ; ④ la **barre de
session** du TUI (temps restant, quota) est extraite et affichée en clair au-dessus de
la conversation (les pubs restent filtrées) ; ⑤ **Groq devient un fournisseur de chat** :
la clé Groq (déjà utilisée pour la dictée) injecte aussi llama 3.3, GPT-OSS, Qwen 3…
dans les chaînes gratuites ; ⑥ **priorités refaites par domaine** : DeepSeek V4 Flash et
GPT-OSS 120B en tête du code, Nemotron 3 Ultra pour l'analyse, MiMo/Groq pour la recherche.
> **v9.6.0 — Lisibilité Freebuff + page « Tâches » à modes** : ⑦ la **Vue conversation**
devient vraiment lisible — le filtrage vit dans un module testé (bordures TUI rognées,
pubs greptile/« Refer friends »/streak retirées, barres d'état supprimées) et la barre de
session capture le **quota** (« 40/40 Freebucks remaining ») ; les lignes de prompt
utilisateur sont marquées visuellement ; ⑧ la page **« Tâches » est redessinée** : un
**agent principal** (l'orchestrateur « projet », qui délègue aux spécialistes via
subagents) et **4 modes** — Code, Analyse, Recherche, et **Tâche complexe** (qui ouvre
l'orchestrateur pour les demandes multi-domaines). L'ancien tableau « qui fait quoi »
est masqué et le renommage d'agents quitte la page (il reste via le CLI) ; Freebuff
reste accessible par la pastille du hub et la carte « Projet ».
> **v9.7.0 — Motion design natif (zéro dépendance)** : l'interface prend vie avec les
API modernes du Chromium embarqué : ① **transitions de vue** (View Transitions API)
lors des navigations hub → Tâches / Freebuff / Accueil — la carte « Projet » du hub
**devient** la page Freebuff (shared element) ; ② **tokens de motion** partagés
(`--dur-fast/med/slow`, courbes `--ease-out`/`--ease-spring` Fluent) ; ③
**chorégraphie d'entrée** en cascade des cartes du hub et des modes de la page
Tâches (décalage 45 ms par carte) ; ④ **micro-interactions** : enfoncement au press,
élévation au survol des cartes, respiration de la pastille de présence, skeleton
shimmer pendant le chargement des agents ; ⑤ tout est **coupé sous
`prefers-reduced-motion`**, n'anime que `transform`/`opacity` (composités GPU — le
conteneur xterm n'est jamais touché, leçon du gel v9.6.1), et le helper est testé.
> **v9.7.2 — Vérification en app réelle : le refus de session devient une bannière**
: boucle « ouvrir, vérifier, corriger » exécutée via CDP sur l'app lancée. Trouvé et
corrigé : quand le lancement de Freebuff est **refusé** (app Freebuff Desktop ouverte),
l'utilisateur voyait l'erreur brute « Error invoking remote method… » sans bannière
actionnable — désormais le refus est reconnu, la **bannière de conflit s'affiche**
(avec son bouton « J'ai fermé l'app — Relancer ») et le statut cesse de rester bloqué
sur « démarre… » (il passe à « Session refusée — voir la bannière »). Le reste de la
boucle est au vert : navigation hub→Tâches→Freebuff→Accueil, 4 modes, composeur et
chips, bascule Vue terminal (25 lignes xterm rendues), pastille hub, **zéro erreur
console** ; le motion est prouvé sous émulation (transitions déclenchées, source
posée pendant et retirée après) et se coupe correctement quand Windows réduit les
effets.
> **v9.7.1 — Le shared element devient réel + purge du code mort** : l'audit v9.7.0
avait révélé que le morph carte→page était annoncé mais **jamais branché** — c'est
fait : la carte « Projet » pose désormais `data-vt-source="project"` au clic (idem
« Tâches »), le CSS fait porter le même `view-transition-name` à la carte source ET
à la page cible (vrai morph), et l'attribut est retiré après la transition (avec un
timeout de 2 s — une fenêtre en arrière-plan peut geler l'animation et laisser un
nom orphelin, constaté au smoke CDP). **Purge** : canal `agents:rename` supprimé de
bout en bout (preload/types/operations/main — 0 appel UI depuis v9.6.0 ; les noms
personnalisés enregistrés restent lus), `agent-names.ts` allégé, tombstones retirés.
**Note découverte au smoke** : Windows « effets réduits » (`prefers-reduced-motion`)
désactive tout le motion par conception — c'est la garde d'accessibilité voulue,
prouvée active et respectée.
> **→ v10.0.0 — La bascule 100 % Tauri** : le shell Electron (main, preload,
electron-builder) et le protocole WinUI/C# suivi en parallèle ont été retirés —
la fenêtre est une webview Tauri, la barre de titre est native, les espaces de
travail et les ouvertures système sont gérés en Rust, le dispatch IPC camelCase
vient dans `host/aven-app-host.ts`, et les releases sortent en NSIS + MSI via
`tauri build` (workflow Release au tag `v*`).
> **v9.6.2 — Le gel avait une cause racine : le conflit de session** : le diagnostic
(processus) a montré le CLI embarqué **s'exiter silencieusement** au premier message
quand l'**app Freebuff Desktop** tient la session du compte (une seule session
autorisée). Aven ne peut pas contourner le serveur, mais ne laisse plus jamais dans
le flou : ① **détection** de l'app Desktop par chemin WMI (`isFreebuffDesktopRunning`,
canal `freebuff:desktop:running`) ; ② **bannière explicite** dans la page Freebuff
(« Ta session est déjà ouverte dans l'app Freebuff Desktop ») avec bouton « J'ai fermé
l'app — Relancer » (re-détection + relance) ; ③ **refus clair au lancement** si l'app
Desktop tourne, au lieu d'ouvrir un TUI condamné ; ④ sur exit silencieux du CLI,
le message nomme la cause au lieu du générique « s'est terminé ».
> **v9.6.1 — Plus de gel à l'envoi d'un message** : le terminal Freebuff restait
réactif à l'affichage mais se figeait dès qu'une réponse arrivait — quatre causes
cumulées, toutes corrigées : ① l'émulateur caché plein cadre en `opacity:0` était
quand même PEINT à chaque rafraîchissement du TUI → `visibility:hidden` (dimensions
conservées, peinture supprimée) ; ② les centaines de petits chunks ConPTY partaient
chacun en IPC individuel → coalescing 30 ms/8 Ko côté main (débit divisé par ~50) ;
③ le filtrage du transcript lançait ~26 regex par ligne sur 400 lignes à chaque frame
→ fast-path sans-lettres + plafond de rendu à 120 lignes ; ④ le scan du buffer
continuait en Vue terminal où il ne sert à rien → suspendu ; `aria-live="polite"`
retiré du transcript (recalcul d'arbre d'accessibilité à chaque frame). Un test de
cout borné (5 000 lignes < 200 ms) garde la régression à distance.
> **v9.5.1 — L'agent Freebuff devient une page pleine** : la vue quitte son dialogue
recouvrant — elle se navigue comme la page Agents (une seule vue à la fois, bouton
« Accueil », Échap revient à l'accueil, session maintenue en quittant). Le hub ou
la page Assistants t'envoient sur la page, plus jamais de popup devant la conversation.
> **v9.5.0 — Le pont agents : Aven, cerveau unique des deux moteurs** : ① **catalogue
d'agents partagé** : les agents Aven (projet, code, recherche, analyse, code-reviewer)
sont convertis en définitions TypeScript dans le dossier `.agents/` de l'espace — le CLI
Freebuff est lancé avec `--trust-agents` et propose donc LES MÊMES agents que
l'interface, sur des modèles gratuits (tes propres fichiers `.agents/` ne sont jamais
touchés) ; ② **notes ouvertes à Freebuff** : un serveur MCP embarqué expose liste,
lecture et recherche des notes de l'espace (`.agents/mcp.json` généré, lecture seule) ;
③ **reprise de conversation** : une préférence fait rouvrir Freebuff sur sa dernière
conversation (`--continue`) au lieu d'en créer une neuve ; ④ **la vue « terminal »
devient une conversation d'agent** : présence « En ligne », transcript lisible (les
spinners et bordures TUI sont filtrés), prompts rapides, composeur avec Entrée pour
envoyer et option « Reprendre la dernière conversation » — le terminal brut reste
accessible d'un clic pour ceux qui aiment voir la mécanique.
> **v9.4.0 — Architecture complète : un cerveau, deux moteurs** : ① **page Assistants**
unifiée (carte « Agents ») : chaque assistant — agents Aven et Freebuff — sur une seule
page, avec un tableau « qui fait quoi » en ouverture et le panneau d'état/actions
Freebuff (Installer le CLI, Ouvrir le terminal) ; ② le **hub se concentre sur ton espace**
(4 cartes : Projet, Agents, Fichiers, Notes) — Freebuff quitte le cercle, la pastille
d'état reste en raccourci ; ③ le **sélecteur de modèle** (barre de l'agent) liste la
chaîne de priorité du routeur : choisis un modèle précis ou « Auto » pour rendre la main
au routeur (épinglage via session.switchModel, chaîne recalculée quand les clés
changent) ; ④ **« Faire relire »** : sélectionne du code → le subagent code-reviewer
analyse sans modifier, via l'agent code (bascule automatique) ; ⑤ **terminal Freebuff
lisible** : l'émulateur envoie ses vraies dimensions (colonnes/lignes) au lancement et
se redimensionne en direct — plus de TUI figée 120×30 ou déformée après un agrandissement.
> **v9.3.0 — Restructuration : une carte claire des features** : ① le hub devient le
> cockpit de l'espace — 5 cartes (Projet, Agents, Freebuff = FAIRE ; Fichiers, Notes =
> CONTENU), le nom de l'espace actif dans l'en-tête, une pastille d'état Freebuff (CLI
> installé ? session active ?) et les conversations récentes montrant leur agent ;
> ② les **Statistiques** migrent dans les Réglages, onglet **Usage** ; ③ les **Notes**
> deviennent une vraie vue : rendu Markdown, édition intégrée, **tags par agent** (filtre
> dans la liste), « Joindre à la conversation » ; ④ les **Fichiers** s'explorent DANS
> Aven (lecture seule, cloisonné à l'espace par une barrière testée : safeResolve), avec
> aperçu texte et « Faire analyser par un agent » ; ⑤ « projets » s'appelle désormais
> **« Espaces »** partout (identifiants techniques inchangés) ; ⑥ le prompt de l'agent
> « projet » gagne un protocole d'orchestration (reformulation, délégation en énoncés
> autonomes, vérification, synthèse). Les commandes vocales suivent : « fichiers » ouvre
> l'explorateur intégré, « statistiques » ouvre Réglages → Usage.
> **v9.2.0 — Le terminal Freebuff intégré, plus de crash d'affichage** : ① la carte
> « Freebuff » ouvre désormais le CLI DANS Aven (xterm.js) — session persistante (fermer
> la vue ne l'arrête pas, l'écran exact est retrouvé à la réouverture), retry automatique
> au boot (ECONNRESET connu), boutons Interrompre/Redémarrer, et plus aucun port réseau
> local ni console externe pour l'usage quotidien ; ② correction du crash « Rendered
> fewer hooks than expected » qui masquait l'app d'un voile d'erreur (un hook React était
> appelé dans une fonction de rendu conditionnelle — la navigation clavier des listes du
> hub utilise désormais le focus DOM, sans état superflu) ; ③ les boutons de navigation
> clavier (flèches, Home/End) restent opérationnels sur toutes les listes du hub.
> **v9.1.5 — Plus de projet « Par défaut », l'espace se choisit, Freebuff sans
> session volée** : ① Aven ne crée plus aucun dossier « Par défaut » dans Documents —
> au premier lancement (ou après le retrait du dernier espace), un écran dédié propose
> de créer ou choisir le dossier de travail, et le moteur ne démarre qu'après ce choix
> (création/sélection = activation immédiate) ; ② le bouton « Utiliser » des espaces de
> travail, qui ne changeait en réalité JAMAIS d'espace (chemin ignoré depuis la v9.0.0),
> bascule vraiment maintenant ; ③ contre l'erreur « This Freebuff session was released
> or taken over by another instance » : Aven détecte un freebuff.exe déjà actif et refuse
> d'ouvrir un deuxième terminal avec un message qui explique le takeover (le serveur
> Freebuff n'accepte qu'une session par compte) au lieu de laisser deux CLI se voler la
> session. Note : les espaces déjà existants sont conservés — seul le dossier imposé de
> frais disparait.
> **v9.1.4 — Le bouton Freebuff enfin fiable, hub et page Agents peaufinés** : ① le
> lancement du CLI ne déclenche plus « Windows ne trouve pas 'Freebuff' » (titre de
> fenêtre `start` vide quoté), l'installation vérifie d'abord npm (message clair + repli
> `npx --yes freebuff`) et le bouton affiche « Installation en cours… » ; ② le bandeau
> d'avis du hub se place dans le coin (il masquait la carte Statistiques), s'efface
> seul après 6 s, se ferme d'un clic et propose « Installer » en direct quand le CLI
> manque ; ③ le cercle du hub tient entièrement dans la fenêtre ; ④ page Agents :
> 2 conversations par carte + compteur « +N autres », grille 3-4 colonnes, badge
> « lecture seule » sur analyse et recherche, boutons harmonisés.
> **v9.1.3 — Hub épuré, vocal qui exécute, Freebuff sans piège** : ① la carte
> « Paramètres » quitte le cercle central (6 cartes à 60°) — l'accès reste dans la barre
> de fenêtre et l'icône de l'accueil ; ② le bouton « Freebuff » de la chatbox est retiré,
> tout comme le champ clé Codebuff des Réglages et le réglage « Utiliser Freebuff comme
> moteur des agents » : le chat repart proprement sur les modèles gratuits OpenCode
> (l'agent vocal gagne « ouvre Freebuff », « statistiques » et « nouvelle conversation ») ;
> ③ les commandes vocales sont réellement exécutées — trois nouvelles actions, un filet
> de secours déterministe quand la classification Groq échoue, et une exécution fiabilisée ;
> ④ le bouton Freebuff CLI ne renvoie plus « freebuff introuvable » dans un terminal : le
> statut est vérifié avant lancement, avec un message d'installation clair si besoin, et le
> quoting Windows des chemins avec espaces est corrigé.
> **v9.1.2 — Freebuff CLI gratuit à portée de clic** : le free tier de Freebuff (sessions
> quotidiennes, financé par les pubs texte) vit dans son CLI interactif — Aven l'ouvre dans
> une vraie fenêtre de terminal directement sur ton espace de travail (carte hub « Freebuff »
> ou Réglages : statut, connexion, installation). Le chat Aven reste sur les modèles gratuits
> OpenCode, ou sur le SDK Codebuff avec clé.
> **v9.1.1 — Hub dédoublonné, Freebuff sans blocage** : l'ancienne carte « Projets »
> (espaces de travail) est retirée du hub — elle faisait doublon avec la nouvelle carte
> « Projet » (orchestrateur) ; les espaces restent dans Paramètres → Configuration. Le mode
> Freebuff ne bloque plus quand le compte Codebuff n'a plus de crédits (Payment Required) :
> le tour bascule automatiquement sur les modèles gratuits OpenCode, avec un avis dans la
> conversation.
> **v9.1.0 — Projet à part, Freebuff moteur, navigation revue** : ① l'agent **projet** est
> à part (carte dédiée du hub, badge « orchestrateur », retiré du sélecteur d'agents) et
> délègue aux agents de base code / recherche / analyse ; ② le sélecteur d'agents en haut
> à droite disparaît ; ③ bouton **Accueil** dans la barre de fenêtre (masqué sur l'accueil) ;
> ④ bouton **Agents** dans la barre de titre pour quitter une conversation et rechoisir ;
> ⑤ **Freebuff devient le moteur de tous les agents** quand la clé Codebuff existe (réglage
> dédié, override composeur conservé) ; ⑥ notifications de bureau (jamais au premier plan,
> tour terminé > 8 s, échecs, permissions, formulaires) et **diagnostic copiable** sans
> aucune clé API ; barre d'onglets historique supprimée.
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

```
Interface React (web/)  ──invoke("aven_call")──►  Rust Tauri (src-tauri/)  ──JSON-RPC stdio──►  host/aven-app-host.ts  ──HTTP local──►  opencode serve
   api.* (web/src/types.ts)      workspace:* / openExternal en Rust,        moteur Node embarqué (engine, notes,      mot de passe aléatoire, port libre
                                 reste dispatché en camelCase dans le host   PTY Freebuff, clés chiffrées DPAPI)
```

## Installer et lancer (Windows) — Aven v10.x (Tauri)

**Le plus simple : double-clique `demarrer.bat`** (il lance `npm install` — quelques secondes si rien n'a changé — puis l'app en mode développement). `construire.bat` fait la même chose puis produit les installeurs. Pour mettre à jour le projet, copie les nouveaux fichiers **par-dessus** l'ancien dossier sans supprimer `node_modules`.

À la main :

Prérequis : **Node.js 22+**, **Rust** ([rustup.rs](https://rustup.rs)) et, sous Windows, les **Visual Studio Build Tools 2022** avec le workload « Développement Desktop en C++ » — c'est le linker MSVC que Rust utilise par défaut. `npm run dev` contrôle les deux outillages et le dit clairement s'ils manquent (v10.2.1). Le CLI OpenCode est embarqué (paquet `@opencode/cli`, même version que le client) : pas d'install globale, aucun binaire Electron.

```powershell
npm install            # à la racine : installe aussi web/ automatiquement (CLI OpenCode uniquement)
npm run dev            # développement : Tauri + webview + rechargement
npm run tauri:build    # installeurs Windows : NSIS + MSI (src-tauri/target/release/bundle)
npm run build:windows:signed   # idem + signature Authenticode (v11.0.0)
```

**Signature (v11.0.0)** : Smart App Control refuse un binaire non signé par une AC du Microsoft Trusted Root Program — un certificat auto-signé ne suffit pas. `build:windows:signed` exige `AVEN_SIGN_THUMBPRINT` (empreinte SHA-1 du certificat installé dans le magasin Windows), signe via l'horodatage RFC 3161, puis **vérifie chaque binaire produit** (`signtool verify /pa`) : un installeur signé ne protège pas un `aven.exe` non signé. `node scripts/build-windows-signed.mjs --check` diagnostique l'outillage sans rien construire.

## Modèles et clés

- **Sans clé** : les modèles « Sans clé (OpenCode Zen) » (`opencode/…-free`) fonctionnent dès le premier lancement.
- **Avec clé** : bouton **Paramètres** → une clé OpenRouter Free (agents) et une clé Groq (dictée vocale). Les clés sont chiffrées par Windows et ne sont jamais renvoyées à l'interface.
- **Freebuff** (v9.5.0) : un **agent** intégré à l'espace, pas un terminal — mêmes agents que tes agents Aven (pont `.agents/`), mêmes notes (serveur MCP, lecture seule), transcript conversationnel avec composeur, reprise de conversation en option. Une seule session par compte.
- **Routage des modèles par priorité** : chaque modèle a une **priorité par agent** dans `model-priorities.json` et Aven assigne explicitement le premier modèle disponible à chaque nouvelle session.
  (1 = le meilleur ; « code », « analyse », « recherche »). Chaque agent utilise le meilleur modèle **disponible** (clé saisie) et non saturé.
  Le classement se recalcule au démarrage et à chaque enregistrement de clé ; il s'affiche dans Réglages. Changer d'onglet change donc de modèle.
- **Bascule automatique quand un modèle est trop utilisé**, de deux façons :
  - *préventive* : l'app compte les requêtes de chaque modèle et passe au suivant à 90 % du plafond déclaré dans la table (`limit`) ;
  - *réactive* : erreur 429 / quota / modèle indisponible → le modèle est mis de côté (90 s pour une limite de débit, 6 h pour un quota journalier ou un
    modèle non disponible), l'agent passe au suivant **immédiatement** et ton dernier message est renvoyé.
- **Catalogue dynamique** : au démarrage, Aven compare la table locale à `model.list()`, ne retient que les modèles explicitement gratuits et actifs,
  puis ajoute les nouveaux modèles gratuits autorisés même si la table livrée était devenue obsolète.
- **Modifier les priorités** : ouvre `<ton espace de travail>\model-priorities.json` (Réglages → « Ouvrir le dossier »), change les
  nombres, relance l'app. Ce fichier n'est jamais écrasé par une mise à jour de l'app : supprime-le pour récupérer la nouvelle version livrée.
  Le catalogue livré est strictement gratuit : les modèles payants sont exclus et ignorés, y compris s’ils sont ajoutés dans un fichier de priorités personnalisé.

## Où travaillent les agents

Tu choisis ton dossier de travail au premier lancement (écran dédié — plus aucun dossier imposé, v9.1.5). `opencode.jsonc` et
`.opencode\agents\*.md` y sont copiés (**jamais écrasés ensuite** : tes modifications restent). Bouton « Ouvrir le dossier » dans Réglages.
Les agents ne touchent donc ni au code de l'app ni au dossier d'installation.

## La carte des features (v9.4.0)

Trois étages, pour savoir « où cliquer » :

| Étage | Features | Rôle |
|---|---|---|
| **Faire** | **Projet** (orchestrateur), **Agents** (spécialistes + Freebuff sur la même page) | Deux portes, tous les assistants |
| **Contenu** | **Fichiers** (explorateur intégré), **Notes** (base de connaissance) | Ce sur quoi les agents travaillent — et ils s'y connectent |
| **Cadre** | **Espaces** (en-tête du hub, tout y vit), **Réglages** (Configuration, Apparence, **Usage**) | Le contenant et la configuration |

Interactions entre features : un fichier → « Faire analyser par un agent » (composeur) ; une note → « Joindre à la conversation » ;
une conversation → tags d'agent sur les notes ; la page **Assistants** → tableau « qui fait quoi », panneau et agent Freebuff (mêmes agents via le pont `.agents/`, mêmes notes via MCP) ; une sélection de code → « Faire relire » (code-reviewer).

## Convention de versionnement
- `vX` : grosse mise à jour / changement majeur.
- `vX.x` : petite mise à jour / évolution ou correction ciblée.

## Fichiers importants

- `host/opencode-bridge.ts` : lance/arrête `opencode serve`, attend que les agents soient chargés, relaie les événements. **Sans dépendance Electron** (testable avec Node).
- `host/operations.ts` : agents, conversations, messages, permissions.
- `host/aven-app-host.ts` : dispatch IPC `aven_call` (camelCase), clés chiffrées Windows (DPAPI), préférences, diagnostic, lancement Freebuff.
- `host/engine-host.ts` : moteur OpenCode embarqué (boot, seed d'espace, événements) — sans dépendance Electron/Tauri, testable avec Node.
- `host/providers.ts` : fournisseurs, variables d'environnement, pages pour obtenir une clé.
- `host/priorities.ts` (lecture/validation de la table, chaînes par agent) et `host/router.ts` (choix du modèle, compteurs, bascule) : sans Electron, testables avec Node.
- `model-priorities.json` : priorités par modèle et par agent (copié dans le dossier de travail au premier lancement).
- `web/src/api.ts` + `web/src/api-tauri.ts` : l'API côté renderer (`invoke("aven_call")`) — contrat typé dans `web/src/types.ts` (`OpenCodeApi`).
- `web/src/stream.ts` : réducteur pur des événements (texte en direct, outils, permissions, questions de l'agent, fin de tour).
- `web/src/SettingsDialog.tsx` : écran des clés et attribution des modèles (lecture seule).
- `web/src/FormDialog.tsx` : boîte de dialogue des questions de l'agent (outil `question`).
- `src-tauri/icons/icon.ico` : icône de l'app (remplace-la par la tienne, 512×512 minimum ; déclarée dans `tauri.conf.json`).
- `.opencode/agents/*.md` + `opencode.jsonc` : agents (format V2 : `permissions:` = liste de règles, la dernière qui correspond gagne).
- `host/freebuff-pty.ts` : PTY embarqué du CLI Freebuff (agent intégré, v9.2.0 ; `--trust-agents`/`--continue` en v9.5.0). Sans dépendance Electron, testé.
- `host/agents-bridge.ts` : pont catalogue d'agents — convertit les agents OpenCode en définitions TypeScript du CLI Freebuff (`.agents/`), génère le `mcp.json` des notes (v9.5.0).
- `aven-mcp-server.mjs` : serveur MCP embarqué (zéro dépendance) qui expose les notes de l'espace à Freebuff.
- `host/freebuff-cli.ts` : détection/lancement console externe du CLI (connexion, installation).
- `NOTES-VERIFIEES.md` : faits vérifiés sur OpenCode 2.0.10 (à lire avant de toucher au pont).

## Dépannage

| Symptôme | Cause / solution |
|---|---|
| « OpenCode n'est pas installé » au premier lancement | `npm install` exécute `scripts/ensure-binaries.mjs` (postinstall) qui télécharge le binaire OpenCode. À la main : `node scripts/ensure-binaries.mjs`. |
| « cargo introuvable » au premier `npm run dev` | La coque Tauri n'a pas d'outillage Rust. Installe Rust via [rustup.rs](https://rustup.rs) **et** les Build Tools 2022 avec le workload C++ (linker MSVC), puis **rouvre le terminal** : le PATH n'est pas rafraîchi dans une session déjà ouverte. |
| « resource path doesn't exist » (node.exe) au premier `npm run dev` | `tauri:dev` prépare désormais le runtime Node embarqué (`scripts/prepare-tauri-runtime.mjs`, SHA-256 vérifié). À la main : `node scripts/prepare-tauri-runtime.mjs`. |
| « OpenCode n'a pas démarré » + message | Le message contient les dernières lignes du CLI. Vérifie Réglages (clé) et le dossier de travail. |
| « Un terminal Freebuff est déjà ouvert » | Une seule session Freebuff par compte (takeover serveur). Ferme le terminal existant (ou l'app desktop Freebuff) puis relance. |
| Écran blanc une fois packagé | `web/vite.config.ts` doit garder `base: "./"`. |
| Agents introuvables | Ils se chargent en tâche de fond (quelques secondes) ; l'app attend jusqu'à 90 s. Vérifie que `.opencode\agents\*.md` a un frontmatter YAML valide. |
| Erreur 429 dans le chat | Limite de débit du modèle gratuit : change de modèle ou attends. Chaque message = plusieurs appels (une par étape de l'agent) : garde `steps` bas. |
| Mise à jour d'OpenCode | Mets `@opencode/client` ET `@opencode/cli` à la **même** version exacte (dans `package.json` et `EXPECTED_VERSION`). |



import { useEffect, useState } from "react"
import { api } from "../api"
import { Icon, type IconName } from "../icons"
import type { Chat, Note, RecentFile } from "../types"
import type { VoiceAgentApi } from "../voice-agent/use-voice-agent"
import { ageLabel, resumeBoard, type ResumeEntry, type ResumeKind } from "./resume"

// v12.1.0 : l'accueil devient une COMPOSITION éditoriale, pas un titre qui remplit
// la page. Trois zones : identité et contrôle vocal à gauche, sphère au centre droit
// dans son environnement technique, et le bas pour ce qui sert vraiment.
// v12.3.0 : le bas n'est plus un pied de page technique. « Reprendre » devient une
// zone à trois entrées réelles (conversation, note, fichier), et les actions rapides
// remontent sous le micro — elles décrivent ce qu'on vient faire, pas ce qu'on a fait.
//
// Ce qui reste interdit ici : un tableau de bord, une métrique décorative, un
// historique inventé, deux statuts vocaux. Chaque ligne affichée vient d'une donnée
// réelle (conversation chargée, note lue sur disque, fichier réellement ouvert) ou
// n'est pas affichée.

type Props = {
  voice: VoiceAgentApi
  /** Le Poste est prêt ET un espace est actif : hors de cet état, « Reprendre »
   *  n'a rien de réel à montrer et ne doit pas lire un ancien état de session. */
  ready: boolean
  /** Conversations réellement chargées — la plus récente nourrit « Reprendre ». */
  chats: Chat[]
  /** Libellé français du mode de délégation actif (état réel, jamais une promesse). */
  delegation: string
  onOpenConversation: (chat: Chat) => void
  onOpenNote: (id: string) => void
  onOpenFile: (path: string) => void
  /** v12.5.0 : le premier message tapé sur l'accueil crée la session ET l'envoie.
   *  Le contrôleur décide comment (identifiant neuf, mêmes canaux que le composeur). */
  onPrompt: (text: string) => void
  onNewChat: () => void
  onDictateNote: () => void
  onBrowseFiles: () => void
  /** Avis transitoire du Poste (CLI manquant, échec de capture…) — jamais un tableau
   *  de bord : il disparaît seul et reste ACTIONNABLE (règle v9.1.4). */
  notice?: string | null
  onDismissNotice?: () => void
  onOpenSettings?: () => void
}

// Ordre fixe des trois colonnes, indépendant des données présentes.
const SLOTS: ResumeKind[] = ["conversation", "note", "file"]

const KIND_LABEL: Record<ResumeKind, string> = {
  conversation: "Conversation",
  note: "Note",
  file: "Fichier",
}

// Une icône dit une seule chose (AGENTS.md §5) : `chat` la conversation, `file` le
// document (note ou fichier). La nature est dite par le libellé, pas par un glyphe détourné.
const KIND_ICON: Record<ResumeKind, IconName> = {
  conversation: "chat",
  note: "file",
  file: "file",
}

export default function HomeStage({
  voice,
  ready,
  chats,
  delegation,
  onOpenConversation,
  onOpenNote,
  onOpenFile,
  onPrompt,
  onNewChat,
  onDictateNote,
  onBrowseFiles,
  notice,
  onDismissNotice,
  onOpenSettings,
}: Props) {
  const error = voice.error
  // v12.5.0 : brouillon de la saisie d'accueil. Il ne survit pas à l'ouverture de la
  // session — le texte part avec le message, rien ne reste à moitié écrit.
  const [draft, setDraft] = useState("")
  const [notes, setNotes] = useState<Note[]>([])
  const [files, setFiles] = useState<RecentFile[]>([])
  // Dernier message de la conversation la plus récente : un extrait RÉEL, pas une
  // promesse. Sans message, l'extrait reste vide plutôt que d'être inventé.
  const [preview, setPreview] = useState("")

  const lastChat = chats.reduce<Chat | null>((best, chat) => (!best || (chat.updated ?? 0) > (best.updated ?? 0) ? chat : best), null)
  const lastChatId = lastChat?.id

  // Notes et fichiers ouverts vivent dans l'espace de travail, pas dans l'état du
  // Poste : l'accueil les lit une fois à son montage. Un échec n'est PAS une erreur
  // de l'accueil — la zone montre alors ce qu'elle a, plutôt qu'un message rouge
  // pour un module facultatif.
  useEffect(() => {
    // v12.3.0 : pas d'IPC avant que le runtime ne soit prêt et l'espace actif —
    // sinon l'accueil affichait brièvement des données d'une session précédente
    // (note d'un ancien espace), ce qui ressemble à un historique fabriqué.
    if (!ready) { setNotes([]); setFiles([]); return }
    let alive = true
    api.notesList()
      .then((list) => { if (alive) setNotes(list) })
      .catch(() => { if (alive) setNotes([]) })
    api.filesRecent()
      .then((list) => { if (alive) setFiles(list) })
      .catch(() => { if (alive) setFiles([]) })
    return () => { alive = false }
  }, [ready])

  useEffect(() => {
    if (!ready || !lastChatId) { setPreview(""); return }
    let alive = true
    api.messages(lastChatId)
      .then((messages) => {
        if (!alive) return
        const last = [...messages].reverse().find((message) => message.text?.trim())
        setPreview(last?.text ?? "")
      })
      .catch(() => { if (alive) setPreview("") })
    return () => { alive = false }
  }, [ready, lastChatId])

  const entries = resumeBoard({
    chats: chats.map((chat) => (chat.id === lastChatId ? { ...chat, preview } : chat)),
    notes,
    files,
  })
  const now = Date.now()
  // Date réelle, pas une salutation figée : le Poste l'affiche comme un en-tête de
  // fenêtre. Locale française explicite — l'interface ne dépend pas de l'OS.
  const today = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(new Date(now))
  // L'ordre de la bande est un contrat, pas un tri : trois natures, trois colonnes.
  const byKind = new Map(entries.map((entry) => [entry.kind, entry]))

  const openEntry = (entry: ResumeEntry) => {
    if (entry.kind === "note") { onOpenNote(entry.id); return }
    if (entry.kind === "file") { onOpenFile(entry.id); return }
    const chat = chats.find((c) => c.id === entry.id)
    if (chat) onOpenConversation(chat)
  }

  return (
    <div className="wb-home">
      {notice && (
        <div className="wb-notice wb-home-notice" role="status">
          <span>{notice}</span>
          <button className="button ghost wb-home-notice-action" type="button" onClick={() => { onDismissNotice?.(); onOpenSettings?.() }}>Ouvrir les Réglages</button>
          <button className="button ghost wb-home-notice-close" type="button" onClick={onDismissNotice} aria-label="Fermer l’avis">Fermer</button>
        </div>
      )}
      {/* v12.1.1 : couche technique du fond — tracés de construction, courbes de
          niveau et densité. Purement décorative : elle ne dit rien et ne capte rien.
          Aucune coordonnée, aucune mesure inventée (AGENTS.md §6). */}
      <div className="wb-home-field" aria-hidden="true">
        <span className="wb-home-trace" />
        <span className="wb-home-ticks" />
        <span className="wb-home-cross" />
      </div>
      <div className="wb-home-grid">
        {/* Zone gauche : l'identité, la phrase, le contrôle vocal, puis les actions.
            Un seul statut vocal sur toute la page — l'en-tête n'en ajoute pas ici. */}
        <div className="wb-home-id">
          {/* v12.5.0 : l'accueil nomme la DESTINATION et la date réelles, comme un
              en-tête de fenêtre. L'ancien libellé « Aven / Voice workspace » était à
              la fois en anglais (AGENTS.md §1) et la signature d'une page de
              présentation : il disait la marque, pas l'endroit où l'on est. */}
          <p className="wb-home-eyebrow">Aujourd’hui · {today}</p>
          <h1 className="wb-home-title">
            <span>Votre espace.</span>
            <span>Votre agent.</span>
          </h1>
          {/* v12.5.0 : une VRAIE saisie remplace la question rhétorique. Sans champ,
              l'accueil ne proposait que des boutons — c'est ce qui le faisait lire
              comme un site. Entrée envoie (le formulaire s'en charge) ; le champ crée
              la session et part avec le premier message. */}
          <form
            className="wb-home-command"
            onSubmit={(event) => {
              event.preventDefault()
              const text = draft.trim()
              if (!text || !ready) return
              setDraft("")
              onPrompt(text)
            }}
          >
            <input
              value={draft}
              aria-label="Message à Aven"
              placeholder={ready ? "Que souhaitez-vous accomplir ?" : "Choisissez d’abord un espace de travail…"}
              disabled={!ready}
              autoComplete="off"
              onChange={(event) => setDraft(event.target.value)}
            />
            {/* v12.5.0 : pas d'aplat d'accent inerte sur un champ vide — c'est ce qui
                fait lire un bouton d'appel à l'action là où l'on attend une commande.
                Le rang primaire n'arrive qu'avec du texte à envoyer. */}
            <button className={`button wb-home-send ${draft.trim() ? "primary" : "secondary"}`} type="submit" disabled={!ready || !draft.trim()}>
              Envoyer
            </button>
          </form>
          <div className="wb-home-voice">
            <button
              className="button ghost wb-home-mic"
              type="button"
              data-live={voice.muted ? undefined : "true"}
              onClick={voice.toggleMic}
              aria-pressed={!voice.muted}
              aria-label={voice.muted ? "Activer le micro de l’agent vocal" : "Couper le micro de l’agent vocal"}
              title={voice.muted ? "Micro coupé — clique pour écouter" : "Micro ouvert — dis « Aven » pour parler"}
            >
              <Icon name={voice.muted ? "microphone-off" : "microphone"} size={17} />
            </button>
            {/* L'état est du TEXTE : la couleur seule ne dit jamais si Aven écoute. */}
            <span className="wb-home-status" role="status" aria-live="polite" data-error={error ? "true" : undefined}>
              {error ?? voice.label}
            </span>
            {/* v12.3.1 : la délégation appartient à l'état de session, pas au travail
                passé — elle rejoint donc la ligne du micro au lieu de flotter seule
                sous les actions (revue : « DÉLÉGATION · AUTO » isolée). */}
            <span className="wb-home-mode">Délégation · {delegation}</span>
          </div>

          {/* v12.3.0 : les actions vivent près de la question — elles y répondent.
              Séparées de « Reprendre », qui parle du passé (brief §5). */}
          <div className="wb-home-actions" role="group" aria-label="Actions rapides">
            <button className="button ghost wb-home-action" type="button" onClick={onNewChat}>
              <Icon name="chat" size={14} />Nouvelle conversation
            </button>
            <button className="button ghost wb-home-action" type="button" onClick={onDictateNote}>
              <Icon name="file" size={14} />Dicter une note
            </button>
            <button className="button ghost wb-home-action" type="button" onClick={onBrowseFiles}>
              <Icon name="folder" size={14} />Parcourir les fichiers
            </button>
          </div>
        </div>

        {/* Zone centre droit : la sphère et son environnement. Les anneaux et les
            repères sont des traits de construction — aucune coordonnée, aucune
            mesure inventée, et ils ne captent jamais le pointeur. */}
        {/* L'environnement suit la phase RÉELLE de la session vocale : data-phase
            vient de `voice.phase`, jamais d'un minuteur ni d'un état simulé. */}
        <div className="wb-home-scene" data-phase={voice.phase}>
          <span className="wb-home-ring" aria-hidden="true" />
          <span className="wb-home-ring wb-home-ring--wide" aria-hidden="true" />
          <span className="wb-home-link wb-home-link--a" aria-hidden="true" />
          <span className="wb-home-link wb-home-link--b" aria-hidden="true" />
          <span className="wb-home-mark" aria-hidden="true" />
          <span className="wb-home-node" aria-hidden="true" />
          {/* L'ancre que le calque de l'agent mesure. Le canvas n'est pas ici : il
              vit au-dessus de tout pour pouvoir se replier dans l'en-tête. */}
          <div id="agent-home-anchor" className="wb-home-agent" aria-hidden="true" />
        </div>

        {/* Zone inférieure : le travail réel, une colonne par nature. */}
        <div className="wb-home-foot">
          <div className="wb-home-foot-head">
            <h2 className="wb-home-resume-title" id="wb-home-resume-title">Reprendre</h2>
          </div>
          {entries.length > 0 ? (
            /* v12.3.1 : les colonnes sont FIXÉES par nature (conversation, note,
               fichier), pas remplies dans l'ordre de ce qu'on trouve. Une nature
               absente garde sa place et un tiret — la bande ne se réorganise pas
               sous l'œil quand une entrée apparaît (revue : colonnes clairement
               définies, alignement cohérent). */
            <ul className="wb-home-resume-list" aria-labelledby="wb-home-resume-title" data-count={entries.length}>
              {SLOTS.map((kind) => {
                const entry = byKind.get(kind)
                const head = (
                  <span className="wb-home-cell-head">
                    <Icon name={KIND_ICON[kind]} size={14} />
                    <span className="wb-home-cell-kind">{KIND_LABEL[kind]}</span>
                    {entry && <span className="wb-home-cell-age">· {ageLabel(entry.updated, now)}</span>}
                  </span>
                )
                return (
                  <li key={kind} data-empty={entry ? undefined : "true"}>
                    {entry ? (
                      <button className="wb-home-cell" type="button" onClick={() => openEntry(entry)} title={entry.title}>
                        {head}
                        <span className="wb-home-cell-title">{entry.title}</span>
                        {entry.excerpt && <span className="wb-home-cell-excerpt">{entry.excerpt}</span>}
                      </button>
                    ) : (
                      <div className="wb-home-cell wb-home-cell--empty">
                        {head}
                        <span className="wb-home-cell-empty-note">Rien pour l’instant</span>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="wb-home-empty">Aucune activité récente dans cet espace — commence par une question.</p>
          )}
        </div>
      </div>
    </div>
  )
}

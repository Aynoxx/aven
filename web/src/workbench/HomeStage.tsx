import { useEffect, useState } from "react"
import { api } from "../api"
import { Icon } from "../icons"
import type { Chat, Note } from "../types"
import type { VoiceAgentApi } from "../voice-agent/use-voice-agent"
import { ageLabel, resumeItems, type ResumeItem } from "./resume"

// v12.1.0 : l'accueil devient une COMPOSITION éditoriale, pas un titre qui remplit
// la page. Trois zones : l'identité et le contrôle vocal à gauche, la sphère au
// centre droit dans son environnement technique, et le bas pour ce qui sert
// vraiment — reprendre le travail réel, trois actions nommées, l'état de la
// délégation. Le titre monumental de la v12.0.0 était une masse qui ne disait rien :
// il tient maintenant deux lignes courtes, à l'échelle du bloc de gauche.
//
// Ce qui reste interdit ici : un tableau de bord, une métrique décorative, un
// historique inventé, deux statuts vocaux. Chaque ligne affichée vient d'une donnée
// réelle (conversation chargée, note lue sur disque) ou n'est pas affichée.

type Props = {
  voice: VoiceAgentApi
  /** Conversations réellement chargées — la plus récente nourrit « Reprendre ». */
  chats: Chat[]
  /** Libellé français du mode de délégation actif (état réel, jamais une promesse). */
  delegation: string
  onOpenConversation: (chat: Chat) => void
  onOpenNote: (id: string) => void
  onNewChat: () => void
  onDictateNote: () => void
  onBrowseFiles: () => void
  /** Avis transitoire du Poste (CLI manquant, échec de capture…) — jamais un tableau
   *  de bord : il disparaît seul et reste ACTIONNABLE (règle v9.1.4). */
  notice?: string | null
  onDismissNotice?: () => void
  onOpenSettings?: () => void
}

export default function HomeStage({
  voice,
  chats,
  delegation,
  onOpenConversation,
  onOpenNote,
  onNewChat,
  onDictateNote,
  onBrowseFiles,
  notice,
  onDismissNotice,
  onOpenSettings,
}: Props) {
  const error = voice.error
  const [notes, setNotes] = useState<Note[]>([])

  // Les notes vivent dans l'espace de travail, pas dans l'état du Poste : l'accueil
  // les lit une fois à son montage. Un échec n'est PAS une erreur de l'accueil —
  // « Reprendre » montre alors les seules conversations, plutôt qu'un message rouge
  // pour un module facultatif.
  useEffect(() => {
    let alive = true
    api.notesList()
      .then((list) => { if (alive) setNotes(list) })
      .catch(() => { if (alive) setNotes([]) })
    return () => { alive = false }
  }, [])

  const items = resumeItems({ chats, notes })
  const now = Date.now()

  const openResume = (item: ResumeItem) => {
    if (item.kind === "note") { onOpenNote(item.id); return }
    const chat = chats.find((c) => c.id === item.id)
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
        {/* Zone gauche : l'identité, la phrase, le contrôle vocal et son état. Un
            seul statut vocal sur toute la page — l'en-tête n'en ajoute pas ici. */}
        <div className="wb-home-id">
          <p className="wb-home-eyebrow">Aven / Voice workspace</p>
          <h1 className="wb-home-title">
            <span>Votre espace.</span>
            <span>Votre agent.</span>
          </h1>
          <p className="wb-home-ask">Que souhaitez-vous accomplir aujourd’hui&nbsp;?</p>
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
          <span className="wb-home-mark" aria-hidden="true" />
          <span className="wb-home-node" aria-hidden="true" />
          {/* L'ancre que le calque de l'agent mesure. Le canvas n'est pas ici : il
              vit au-dessus de tout pour pouvoir se replier dans l'en-tête. */}
          <div id="agent-home-anchor" className="wb-home-agent" aria-hidden="true" />
        </div>

        {/* Zone inférieure : reprendre, agir, et l'état réel de la délégation. */}
        <div className="wb-home-foot">
          {items.length > 0 && (
            <section className="wb-home-resume" aria-labelledby="wb-home-resume-title">
              <h2 className="wb-home-resume-title" id="wb-home-resume-title">Reprendre</h2>
              <ul className="wb-home-resume-list">
                {items.map((item) => (
                  <li key={`${item.kind}-${item.id}`}>
                    <button className="wb-home-recent" type="button" onClick={() => openResume(item)} title={item.title}>
                      <Icon name={item.kind === "conversation" ? "chat" : "file"} size={14} />
                      <span className="wb-home-recent-title">{item.title}</span>
                      <span className="wb-home-recent-meta">
                        {item.kind === "conversation" ? "Conversation" : "Note"} · {ageLabel(item.updated, now)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="wb-home-more">
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
            <p className="wb-home-mode">Délégation · {delegation}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

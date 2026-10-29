import { Icon } from "../icons"
import type { VoiceAgentApi } from "../voice-agent/use-voice-agent"

// v12.0.0 : l'accueil n'est plus une planche de données. L'agent occupe la scène,
// une phrase et un micro suffisent. Aucun tableau de bord, aucun raccourci, aucun
// historique : ce qui n'est pas l'agent distrairait de lui.
//
// v12.0.0 (passe graphique) : la composition suit la référence — le titre monumental
// est ANCRÉ À GAUCHE (il occupe la largeur, la sphère reste centrée dessous), le
// micro est un glyphe nu et l'état se dit SOUS lui. Le titre n'est plus une étiquette
// centrée : c'est la première masse de la page.

type Props = {
  voice: VoiceAgentApi
  /** Avis transitoire du Poste (CLI manquant, échec de capture…) — jamais un tableau
   *  de bord : il disparaît seul et reste ACTIONNABLE (règle v9.1.4). */
  notice?: string | null
  onDismissNotice?: () => void
  onOpenSettings?: () => void
}

export default function HomeStage({ voice, notice, onDismissNotice, onOpenSettings }: Props) {
  const error = voice.error
  return (
    <div className="wb-home">
      {notice && (
        <div className="wb-notice wb-home-notice" role="status">
          <span>{notice}</span>
          <button className="button ghost wb-home-notice-action" type="button" onClick={() => { onDismissNotice?.(); onOpenSettings?.() }}>Ouvrir les Réglages</button>
          <button className="button ghost wb-home-notice-close" type="button" onClick={onDismissNotice} aria-label="Fermer l’avis">Fermer</button>
        </div>
      )}
      <div className="wb-home-stack">
        {/* v12.0.0 : pas d'eyebrow au-dessus du titre — l'espace appartient à la
            sphère. La référence ne met rien entre l'en-tête et la phrase. */}
        <h1 className="wb-home-title">Bonjour. Je suis Aven.</h1>

        {/* L'ancre que le calque de l'agent mesure. Le canvas n'est pas ici : il
            vit au-dessus de tout pour pouvoir se replier dans l'en-tête. */}
        <div id="agent-home-anchor" className="wb-home-agent" aria-hidden="true" />

        <p className="wb-home-ask">Que souhaitez-vous accomplir aujourd’hui&nbsp;?</p>

        {/* v12.0.0 : un glyphe nu, pas un bouton encadré — la référence pose le micro
            comme un signe, et son point d'accent dit que l'écoute est ouverte. */}
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
        </div>
        {/* L'état est du TEXTE : la couleur seule ne dit jamais si Aven écoute. */}
        <span className="wb-home-status" role="status" aria-live="polite" data-error={error ? "true" : undefined}>
          {error ?? voice.label}
        </span>
      </div>
    </div>
  )
}

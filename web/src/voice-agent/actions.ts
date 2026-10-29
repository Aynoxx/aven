// v11.9.0 : confirmation orale d'une action destructive. Le host PROPOSE
// (« Je vais supprimer la conversation « X ». Je le fais ? ») et garde la cible
// résolue ; le renderer, lui, ne fait qu'une chose : classer la parole suivante
// et rappeler le host avec le jeton. La décision vit donc ici, en clair, et
// l'écriture n'existe qu'après un « oui » — jamais dans la boucle du modèle.
//
// Pur : testable avec Node seul, sans dépendance desktop ni réseau.
import { classifyNoteReply, type NoteReply } from "./note"

/** Même fenêtre que côté host : au-delà, un « oui » tardif n'exécute plus rien. */
export const ACTION_CONFIRM_MS = 45_000

export type PendingVoiceAction = { token: string; prompt: string; askedAt: number }

/**
 * La question est-elle encore ouverte ? Le host re-vérifie de son côté : une
 * horloge locale avancée ne suffit pas à exécuter une action périmée.
 */
export function actionConfirmationOpen(askedAt: number, now: number = Date.now()): boolean {
  return Number.isFinite(askedAt) && now >= askedAt && now - askedAt <= ACTION_CONFIRM_MS
}

/**
 * Classe la réponse à « Je le fais ? ». Le classement est celui de la note
 * vocale (v11.4.0) : le refus passe avant l'accord, faute de quoi « non, ne
 * supprime pas » serait lu comme un accord parce qu'il contient « non » puis
 * « supprime ». Réutiliser l'implémentation éprouvée vaut mieux qu'en écrire
 * une seconde, qui divergerait.
 */
export function classifyActionReply(text: string): NoteReply {
  return classifyNoteReply(text)
}

export const ACTION_CANCELLED_REPLY = "D’accord, je ne fais rien."
export const ACTION_UNCONFIRMED_REPLY = "Je n’ai pas exécuté l’action."
export const ACTION_EXPIRED_REPLY = "Trop tard : je n’ai rien exécuté. Redemande-moi."

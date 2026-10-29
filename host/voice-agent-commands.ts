// v11.1.0 : routage des commandes de l'agent vocal. Les commandes FIABLES sont
// codées ici (liste fermée, motifs serrés) ; tout le reste est une demande libre
// confiée au LLM distant. Aucun modèle n'intervient pour décider d'une commande.
//
// Garde-fous :
//   - une question (« comment ouvrir les notes ? ») n'est jamais une commande ;
//   - un motif exige un VERBE d'action et un NOM d'interface, dans une phrase courte ;
//   - les identifiants d'action réutilisent le contrat de navigation existant
//     (open-notes, open-settings, open-workspace…) pour que le renderer n'ait
//     qu'un seul routeur.
//
// Pur : testable avec Node seul, sans dépendance desktop.
import { detectWakeWord, isSleepPhrase, startsWithWakeHomophone, stripWakeWord } from "./voice-agent-wake.js"
// v11.14.1 : en veille, la parole ambiante n'est pas une demande. La décision
// vit dans un module pur, avant tout envoi au LLM.
import { isAddressedToAgent } from "./voice-agent-addressed.js"

export type VoiceCommand =
  | "open-notes"
  | "open-settings"
  | "open-workspace" // fichiers de l'espace
  | "open-project" // terminal Freebuff (identifiant historique conservé)
  | "open-agents" // orchestration
  | "go-home"
  | "new-chat"
  | "mute-microphone"
  | "stop-speaking"

// Une demande de contenu commence souvent par un interrogatif : elle ne doit
// jamais être absorbée par un motif de commande.
const QUESTION_START = /^(?:comment|pourquoi|quand|o[uù]|qui|quel(?:le|s)?|qu'est|est-ce|peux-tu|peut-on|tu peux|explique|raconte)\b/i

// v11.1.1 : un homophone sans virgule (« Avant ouvre une note ») ne réveille
// l'agent que si la commande OUVRE la phrase. « Avant de partir, ouvre les
// notes » contient une commande, mais dans une subordonnée : pas de réveil.
const ACTION_START = /^(?:coupe|ferme|d[eé]sactive|mets|passe|active|mode|stop|arr[eê]te|tais|silence|nouvelle|nouveau|cr[eé]e?|ouvre|ouvrir|affiche|afficher|montre|montrer|va|lance|lancer|retourne|retour|revient|reviens|ram[eè]ne|ramener)\b/i

type Rule = { re: RegExp; command: VoiceCommand }

const RULES: Rule[] = [
  // Micro et lecture : actions locales, jamais envoyées au LLM.
  // v11.1.2 : la sourdine se dit aussi dans l'ordre naturel (« mets le micro
  // en sourdine »), à la deuxième personne (« mets-toi en sourdine ») ou via le
  // mode silencieux. Sans ces motifs, la phrase partait au LLM, qui répondait
  // « c'est fait » alors que le micro restait ouvert.
  { re: /^(?:coupe|ferme|d[eé]sactive)\b[^.!?]{0,24}(?:micro|microphone|l?['’]?[eé]coute)\b/i, command: "mute-microphone" },
  { re: /^(?:mets?|passe)\b[^.!?]{0,16}\b(?:micro|microphone)\b[^.!?]{0,16}\b(?:en sourdine|en mode silencieux)\b/i, command: "mute-microphone" },
  { re: /^mets?\s+en sourdine\b[^.!?]{0,16}\b(?:micro|microphone)\b/i, command: "mute-microphone" },
  { re: /^mets?-?\s*toi\b[^.!?]{0,20}\b(?:en sourdine|en mode silencieux)\b/i, command: "mute-microphone" },
  { re: /^(?:passe|active|mets?)\b[^.!?]{0,16}\bmode silencieux\b/i, command: "mute-microphone" },
  { re: /^mode silencieux\b/i, command: "mute-microphone" },
  { re: /^(?:stop|arr[eê]te|tais?-?toi|silence)\b/i, command: "stop-speaking" },
  { re: /nouvelle (?:conversation|discussion)|nouveau (?:chat|fil)|cr[eé]e? une (?:nouvelle )?conversation/i, command: "new-chat" },
  // v11.1.0 : « réglages » porte un é aigu (pas seulement è) — le motif doit
  // accepter les trois graphies pour ne pas manquer la commande la plus courante.
  { re: /(?:ouvre|ouvrir|affiche|afficher|montre|montrer|va (?:à|aux?|sur))[^.!?]{0,30}(?:param[eéè]tres?|r[eéè]glages?)\b/i, command: "open-settings" },
  { re: /(?:ouvre|ouvrir|affiche|afficher|montre|montrer|va (?:à|aux?|sur))[^.!?]{0,30}\bnotes?\b/i, command: "open-notes" },
  // v11.1.0 : « ouvre le fichier main.ts » est une demande de CONTENU, pas une
  // navigation — seul le pluriel ou le dossier/explorateur ouvre les fichiers.
  { re: /(?:ouvre|ouvrir|affiche|afficher|montre|montrer|va (?:à|aux?|sur))[^.!?]{0,30}(?:les fichiers|le dossier|l['’]explorateur|l['’]espace)\b/i, command: "open-workspace" },
  { re: /(?:ouvre|ouvrir|lance|lancer|affiche|afficher|montre|montrer|va (?:à|aux?|sur))[^.!?]{0,30}(?:terminal|freebuff)\b/i, command: "open-project" },
  { re: /(?:ouvre|ouvrir|affiche|afficher|montre|montrer|va (?:à|aux?|sur))[^.!?]{0,30}(?:orchestration|agents?|t[aâ]ches?)\b/i, command: "open-agents" },
  { re: /(?:retourne|retour|revient|reviens|ram[eè]ne|va)[^.!?]{0,20}(?:accueil|poste|maison)\b/i, command: "go-home" },
]

/** Commande reconnue, ou null si la phrase doit aller au LLM. */
export function routeVoiceCommand(text: string): VoiceCommand | null {
  const value = String(text ?? "").trim()
  if (!value || value.length > 120) return null
  if (QUESTION_START.test(value)) return null
  for (const rule of RULES) if (rule.re.test(value)) return rule.command
  return null
}

export type VoiceInterpretation = {
  /** « Aven » a-t-il été prononcé ? */
  woken: boolean
  /** Commande codée reconnue (null = demande libre). */
  command: VoiceCommand | null
  /** Demande libre, mot d'activation et politesses retirés. */
  demand: string
  /**
   * v11.12.0 : ordre de repos (« dors », « mets-toi en veille »). Reconnu ici,
   * côté host, pour que le renderer n'ait pas sa propre liste à tenir à jour ;
   * c'est une phrase ENTIÈRE, jamais un mot au milieu d'une demande.
   */
  sleep: boolean
  /**
   * v11.14.1 : la parole paraît adressée à Aven (mot d'activation, commande,
   * question, impératif, deuxième personne). En veille, une parole non adressée
   * est écartée sans réponse — c'est le bruit de la pièce, pas une demande.
   */
  addressed: boolean
}

/**
 * Interprète une transcription complète : détection du mot d'activation puis
 * commande ou demande libre. Ne lève jamais : une transcription vide donne
 * `woken: false`, `command: null`, `demand: ""`.
 */
export function interpretVoiceText(text: string, options?: { expectsAnswer?: boolean }): VoiceInterpretation {
  const { woken, command: cleaned } = detectWakeWord(text)
  // v11.1.1 : Whisper écrit souvent « Aven » en « Avant ». Si la phrase ouvre
  // sur cet homophone ET qu'une commande est reconnue derrière, le réveil est
  // acquis même sans virgule (« Avant ouvre une note »). Une demande libre, elle,
  // exige la pause (« Avant, quelle heure est-il ? »).
  const homophone = startsWithWakeHomophone(text)
  const useful = homophone && !woken ? stripWakeWord(text) : cleaned
  const command = routeVoiceCommand(useful)
  const wokenFinal = woken || (homophone && command !== null && ACTION_START.test(useful))
  // v11.14.1 : une commande, un ordre de repos ou un mot d'activation sont
  // TOUJOURS adressés ; sinon le module pur tranche sur le texte.
  const sleep = isSleepPhrase(useful)
  const addressed = wokenFinal || command !== null || sleep || isAddressedToAgent(useful, options)
  // v11.12.0 : l'ordre de repos sort de la conversation — aucune commande, aucune
  // demande, rien qui parte au LLM. Il vaut avec ou sans mot d'activation ; c'est
  // le renderer qui décide de n'y obéir qu'en veille (session.ts).
  if (sleep) return { woken: wokenFinal, command: null, demand: "", sleep: true, addressed: true }
  if (!useful) return { woken: wokenFinal, command: null, demand: "", sleep: false, addressed: wokenFinal }
  return { woken: wokenFinal, command, demand: command ? "" : useful, sleep: false, addressed }
}

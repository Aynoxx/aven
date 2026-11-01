// Pur : testable avec Node seul, sans dépendance desktop.
// v12.8.0 : les modèles sont de vrais documents Markdown, jamais des écrans
// pré-remplis. Créer depuis un modèle écrit une note ordinaire, que l'utilisateur
// peut modifier, déplacer et supprimer comme n'importe quelle autre.
export type NoteTemplate = {
  id: string
  name: string
  description: string
  title: string
  markdown: string
}

export const NOTE_TEMPLATES: readonly NoteTemplate[] = [
  {
    id: "idee",
    name: "Idée",
    description: "Capturer une idée et sa prochaine étape.",
    title: "Idée",
    markdown: `# Idée

## L'idée

Décris l'idée en une phrase.

## Pourquoi elle compte

Ce qu'elle change, pour qui, et ce qu'elle évite.

## Prochaine étape

- [ ] Vérifier l'hypothèse
- [ ] Décider de la suite
`,
  },
  {
    id: "reunion",
    name: "Réunion",
    description: "Préparer, décider, puis repartir avec des actions.",
    title: "Réunion",
    markdown: `# Réunion

## Contexte

Pourquoi cette réunion existe.

## Décisions

- Décision 1
- Décision 2

## Actions

- [ ] Action — responsable — échéance
- [ ] Action — responsable — échéance
`,
  },
  {
    id: "recherche",
    name: "Recherche",
    description: "Poser une question, rassembler les sources, conclure.",
    title: "Recherche",
    markdown: `# Recherche

## Question

La question à laquelle cette note doit répondre.

## Sources

- Source 1 — ce qu'elle apporte
- Source 2 — ce qu'elle apporte

## Ce que j'ai appris

Les faits vérifiés, et ce qui reste incertain.

## Conclusion

La réponse, en quelques lignes.
`,
  },
  {
    id: "journal",
    name: "Journal",
    description: "Une entrée datée, sans formulaire à remplir.",
    title: "Journal",
    markdown: `# Journal

## Aujourd'hui

Ce qui s'est passé, ce que j'en retiens.

## À garder

Une phrase, une image, une décision.

## Demain

- [ ] Une priorité
`,
  },
  {
    id: "projet",
    name: "Projet",
    description: "Le cadre, les étapes et les risques d'un projet.",
    title: "Projet",
    markdown: `# Projet

## Objectif

Le résultat attendu, et pour qui.

## Périmètre

Ce qui est inclus — et ce qui ne l'est pas.

## Étapes

- [ ] Cadrer
- [ ] Construire
- [ ] Vérifier
- [ ] Livrer

## Risques

- Risque — signal — réponse
`,
  },
  {
    id: "contenu",
    name: "Plan de contenu",
    description: "Une audience, des angles, un calendrier.",
    title: "Plan de contenu",
    markdown: `# Plan de contenu

## Audience

À qui ce contenu parle, et ce qu'elle cherche.

## Angles

- Angle 1 — promesse
- Angle 2 — preuve
- Angle 3 — appel à l'action

## Calendrier

| Date | Format | Angle |
| --- | --- | --- |
| À définir | Note | À définir |
`,
  },
]

export function templateById(id: string): NoteTemplate | undefined {
  return NOTE_TEMPLATES.find((template) => template.id === id)
}

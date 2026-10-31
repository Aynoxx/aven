// Modèles de notes natifs d'Aven (v12.8.0).
// Le contenu reste du Markdown ordinaire : chaque note créée est un fichier local,
// modifiable, exportable et compatible avec les wikilinks existants.

export type NoteTemplate = {
  id: string
  label: string
  title: string
  description: string
  body: string
}

export const NOTE_TEMPLATES: readonly NoteTemplate[] = [
  {
    id: "idee",
    label: "Idée",
    title: "Nouvelle idée",
    description: "Capturer une idée et décider de la suite",
    body: "## L'idée\n\n## Pourquoi c'est intéressant\n\n## Pistes à explorer\n\n## Prochaine action\n- [ ] ",
  },
  {
    id: "reunion",
    label: "Réunion",
    title: "Réunion du {{date}}",
    description: "Ordre du jour, décisions et actions",
    body: "## Participants\n\n## Objectif\n\n## Ordre du jour\n\n## Notes\n\n## Décisions\n\n## Actions à suivre\n- [ ] ",
  },
  {
    id: "recherche",
    label: "Recherche",
    title: "Recherche — nouveau sujet",
    description: "Question, sources, résultats et synthèse",
    body: "## Question de départ\n\n## Hypothèses\n\n## Sources\n- \n\n## Résultats\n\n## Synthèse\n\n## Notes liées\n- [[ ]]\n",
  },
  {
    id: "journal",
    label: "Journal",
    title: "Journal du {{date}}",
    description: "Journal quotidien et points à retenir",
    body: "## Événements marquants\n\n## Réflexions\n\n## Ce que j'ai appris\n\n## À reprendre demain\n- [ ] ",
  },
  {
    id: "projet",
    label: "Projet",
    title: "Nouveau projet",
    description: "Objectifs, étapes et suivi",
    body: "## Contexte\n\n## Objectif\n\n## Résultat attendu\n\n## Étapes\n- [ ] \n\n## Risques et questions\n\n## Références\n- [[ ]]\n",
  },
  {
    id: "article",
    label: "Plan de contenu",
    title: "Nouveau contenu",
    description: "Construire un plan avant la rédaction",
    body: "## Public visé\n\n## Idée principale\n\n## Promesse\n\n## Plan\n1. Introduction\n2. \n3. \n4. Conclusion\n\n## Sources et exemples\n- [[ ]]\n\n## Brouillon\n",
  },
]

/** Crée un document Markdown prêt à être édité. La date se fixe au clic. */
export function buildNoteTemplate(id: string, dateLabel = new Date().toLocaleDateString("fr-FR")): { title: string; markdown: string } | null {
  const template = NOTE_TEMPLATES.find((item) => item.id === id)
  if (!template) return null
  const title = template.title.replace(/\{\{date\}\}/g, dateLabel)
  const body = template.body.replace(/\{\{date\}\}/g, dateLabel)
  return { title, markdown: "# " + title + "\n\n" + body.trim() + "\n" }
}

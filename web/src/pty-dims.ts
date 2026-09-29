// v9.6.0 : plancher de dimensions du PTY Freebuff (module pur, testé).
// Hors « vue terminal », l'émulateur est superposé invisible à la zone de conversation
// (mêmes dimensions) ; si son fit échoue quand même (page masquée, redimensionnement
// extrême), on n'envoie JAMAIS moins que 80×24 au PTY — un TUI né dans un cadre nul
// ou minuscule reste cassé (écran vide, boîtes chevauchées) même après resize.
export const PTY_MIN_COLS = 80
export const PTY_MIN_ROWS = 24

export function ptyDims(term: { cols: number; rows: number }): { cols: number; rows: number } {
  return { cols: Math.max(term.cols, PTY_MIN_COLS), rows: Math.max(term.rows, PTY_MIN_ROWS) }
}

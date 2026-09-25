import { Component, type ErrorInfo, type ReactNode } from "react"

// Sans Error Boundary, une exception pendant le rendu d'un composant démonte toute
// l'arborescence React → écran blanc sans message. Ici l'erreur est affichée avec un
// bouton « Réessayer » qui remonte l'état du composant.
type Props = { children: ReactNode }
type State = { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Aven : erreur de rendu interceptée :", error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="overlay" role="alert">
        <div className="dialog">
          <h3>Aven a rencontré une erreur d’affichage</h3>
          <p className="err">{error.message}</p>
          <div className="row end">
            <button className="button primary" onClick={() => this.setState({ error: null })}>Réessayer</button>
          </div>
        </div>
      </div>
    )
  }
}

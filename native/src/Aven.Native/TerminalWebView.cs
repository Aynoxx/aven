using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

namespace Aven.Native;

/// <summary>
/// Écran terminal VT complet — décision §5.1 : WebView2 + xterm.js 5.5.0, le MÊME
/// moteur de rendu que la vue terminal web. Les chunks BRUTS du PTY (séquences VT
/// comprises) sont écrits dans l'émulateur, les frappes du TUI reviennent par
/// onData → event Data, l'addon-fit calcule cols/rows → event Taille (le plancher
/// 80×24 reste appliqué par FreebuffTerminal). Assets servis via un nom d'hôte
/// virtuel (fonctionne packagé ET unpackaged). Les chunks écrits AVANT le ready
/// sont bufferisés (le replay du scrollback n'est jamais perdu). Si le runtime
/// WebView2 manque, InitialiserAsync lève : l'appelant retombe sur le transcript
/// TextBlock filtré.
/// </summary>
public sealed class TerminalWebView : Grid
{
    public const string HôteVirtuel = "aven.terminal";

    private readonly WebView2 _web = new();
    private readonly List<string> _enAttente = [];
    private (string Fond, string Texte, string Curseur)? _thème;
    private bool _prêt;
    private bool _initialisé;

    /// <summary>Frappes du TUI (onData de xterm) — à écrire telles quelles dans le PTY.</summary>
    public event Action<string>? Data;

    /// <summary>Dimensions calculées par l'addon-fit → transport (via ClampDims).</summary>
    public event Action<int, int>? Taille;

    /// <summary>L'émulateur est monté : le buffer d'attente part, le thème est appliqué.</summary>
    public event Action? Prêt;

    public TerminalWebView()
    {
        Children.Add(_web);
        _web.WebMessageReceived += SurMessage;
    }

    /// <summary>Charge l'environnement puis terminal.html (une seule fois).</summary>
    public async Task InitialiserAsync(string fond, string texte, string curseur)
    {
        if (_initialisé) return;
        _thème = (fond, texte, curseur);
        _initialisé = true;
        // Forme paramètre-less (voie documentée WinUI 3) : le dossier de données est
        // géré par l'OS (packagé MSIX) ou créé à côté de l'exe (layout dev, inscriptible).
        await _web.EnsureCoreWebView2Async();
        var assets = Path.Combine(AppContext.BaseDirectory, "Assets", "terminal");
        _web.CoreWebView2.SetVirtualHostNameToFolderMapping(HôteVirtuel, assets, CoreWebView2HostResourceAccessKind.Allow);
        _web.CoreWebView2.Navigate($"https://{HôteVirtuel}/terminal.html");
    }

    private void SurMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!Aven.Bridge.TerminalWebMessages.TryParse(e.WebMessageAsJson, out var m)) return;
        switch (m.Type)
        {
            case "ready":
                _prêt = true;
                if (_thème is { } t) Post(Aven.Bridge.TerminalWebMessages.Thème(t.Fond, t.Texte, t.Curseur));
                foreach (var chunk in _enAttente) Post(Aven.Bridge.TerminalWebMessages.Write(chunk));
                _enAttente.Clear();
                Prêt?.Invoke();
                break;
            case "data":
                Data?.Invoke(m.Data);
                break;
            case "resize":
                if (m.Cols > 0 && m.Rows > 0) Taille?.Invoke(m.Cols, m.Rows);
                break;
        }
    }

    /// <summary>Écrit un chunk VT BRUT dans l'émulateur (bufferisé avant le ready).</summary>
    public void Write(string chunk)
    {
        if (!_prêt) { _enAttente.Add(chunk); return; }
        Post(Aven.Bridge.TerminalWebMessages.Write(chunk));
    }

    /// <summary>Nouvelle session : efface l'écran (le TUI se redessine de zéro).</summary>
    public void Réinitialiser()
    {
        if (_prêt) Post(Aven.Bridge.TerminalWebMessages.Reset());
    }

    private void Post(string json)
    {
        if (_initialisé) _web.CoreWebView2.PostWebMessageAsJson(json);
    }
}

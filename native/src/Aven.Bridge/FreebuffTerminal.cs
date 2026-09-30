using System.Text;

namespace Aven.Bridge;

/// <summary>État de la session terminal (parité PtyState de freebuff-pty.ts).</summary>
public enum TerminalState { Starting, Running, Restarting }

/// <summary>
/// Transport du terminal : abstraction du ConPTY réel (P/Invoke côté fenêtre) pour
/// tester la machine à états en xUnit SANS process ni console. La fabrique crée un
/// NOUVEAU process à chaque spawn/retry — parité du re-spawn de freebuff-pty.ts.
/// </summary>
public interface ITerminalTransport
{
    int Pid { get; }
    void Write(string data);
    void Resize(int cols, int rows);
    void Kill();
    event Action<string>? Data;
    event Action<int, int?>? Exit; // (exitCode, signal)
}

/// <summary>Abonnement aux événements du terminal (parité FreebuffPtyEvents).</summary>
public sealed record TerminalHandlers(
    Action<string> OnData,
    Action<TerminalState> OnStatus,
    Action<int, int?> OnExit,
    Action<string> OnError);

/// <summary>
/// Terminal Freebuff natif — PORT de electron/freebuff-pty.ts : session singleton
/// mono-compte, scrollback rejouable (256 Ko), grâce de boot (5 s), backoff de
/// démarrage (1 s, 2 s, 4 s), coalescing des chunks (30 ms / 8 Ko, leçon v9.6.1 —
/// les événements d'état vident TOUJOURS le lot d'abord), reprise de session
/// (replay sans re-spawn), redémarrage qui repart sur un process neuf.
/// </summary>
public sealed class FreebuffTerminal : IDisposable
{
    public const int MaxScrollback = 256 * 1024;
    public const int BootGraceMs = 5_000;
    public const int MaxBootAttempts = 3;
    public const int BatchFlushMs = 30;
    public const int BatchMaxChars = 8 * 1024;
    public const int MaxChunkChars = 64 * 1024;
    public const int DefaultCols = 120;
    public const int DefaultRows = 30;

    private readonly Func<int, int> _délai; // délai demandé (ms) -> délai réel : identité en prod, 0 en tests
    private readonly object _verrou = new();
    private Func<ITerminalTransport>? _fabrique;
    private TerminalHandlers? _handlers;
    private ITerminalTransport? _transport;
    private bool _stopped;
    private bool _dansLaGrâce;
    private int _sessions;
    private int _bootAttempts;
    private (int Cols, int Rows) _taille = (DefaultCols, DefaultRows);
    private readonly StringBuilder _scrollback = new();
    private readonly StringBuilder _lot = new();

    public bool IsActive { get; private set; }

    public FreebuffTerminal(Func<int, int>? délaiMs = null) => _délai = délaiMs ?? (ms => ms);

    /// <summary>Backoff entre deux tentatives : 1 s, 2 s, 4 s (parité ptyBackoffMs, non plafonné).</summary>
    public static int BackoffMs(int attempt) => 1000 * (int)Math.Pow(2, Math.Max(0, attempt - 1));

    /// <summary>
    /// Plancher de dimensions du terminal (port de pty-dims.ts) : jamais moins de
    /// 80×24 — un TUI plus petit se peint mal et déclenche des redimensionnements
    /// en boucle. Le plafond évite les consoles démesurées inutiles.
    /// </summary>
    public static (int Cols, int Rows) ClampDims(int cols, int rows) =>
        (Math.Clamp(cols, 80, 500), Math.Clamp(rows, 24, 200));

    /// <summary>
    /// Démarre via la fabrique, ou renvoie le scrollback de la session déjà active
    /// (reconnexion sans relancer le process — parité startFreebuffPty).
    /// </summary>
    public string Start(Func<ITerminalTransport> fabrique, TerminalHandlers handlers, int cols = DefaultCols, int rows = DefaultRows)
    {
        lock (_verrou)
        {
            _taille = ClampDims(cols, rows);
            var premierAttach = _handlers is null;
            _handlers = handlers;
            _stopped = false;
            if (IsActive) return _scrollback.ToString(); // reprise : replay, pas de nouveau spawn
            if (premierAttach || _bootAttempts >= MaxBootAttempts) _bootAttempts = 0;
            _fabrique = fabrique;
            DémarrerSession();
            return "";
        }
    }

    private void DémarrerSession()
    {
        if (_stopped || _fabrique is null) return;
        _bootAttempts++;
        _handlers?.OnStatus(TerminalState.Starting);
        var transport = _fabrique();
        _transport = transport;
        var démarrage = Interlocked.Increment(ref _sessions);
        // Parité bootTimer : la grâce est ARMÉE par le spawn et DÉSARMÉE par son timer
        // (pas une mesure d'horloge) — un délai injecté accéléré la désarme aussitôt.
        _dansLaGrâce = true;
        IsActive = true;

        transport.Data += chunk =>
        {
            if (chunk.Length > MaxChunkChars) chunk = chunk[..MaxChunkChars];
            lock (_verrou)
            {
                if (!IsActive) return;
                _scrollback.Append(chunk);
                if (_scrollback.Length > MaxScrollback)
                    _scrollback.Remove(0, _scrollback.Length - MaxScrollback);
                // Coalescing v9.6.1 : lot 30 ms / 8 Ko — le débit d'événements est divisé
                // par ~50 ; les états vident le lot d'abord (ordre données→état préservé).
                _lot.Append(chunk);
                if (_lot.Length >= BatchMaxChars) ViderLot();
            }
        };
        transport.Exit += (code, signal) =>
        {
            lock (_verrou)
            {
                if (_stopped || !IsActive || !ReferenceEquals(_transport, transport)) return;
                IsActive = false;
                _transport = null;
                ViderLot(); // les données en attente partent AVANT le changement d'état
                if (_dansLaGrâce && _bootAttempts < MaxBootAttempts)
                {
                    _handlers?.OnStatus(TerminalState.Restarting);
                    _ = Programmer(DémarrerSession, BackoffMs(_bootAttempts));
                    return;
                }
                if (_dansLaGrâce)
                {
                    _handlers?.OnError($"freebuff a échoué à démarrer après {_bootAttempts} tentatives (code {code}).");
                    return;
                }
                _handlers?.OnExit(code, signal);
            }
        };
        _ = Programmer(() =>
        {
            lock (_verrou)
            {
                if (IsActive && ReferenceEquals(_transport, transport))
                {
                    _dansLaGrâce = false; // le process a survécu à la fenêtre de grâce
                    _handlers?.OnStatus(TerminalState.Running);
                }
            }
        }, BootGraceMs);
    }

    private async Task Programmer(Action action, int délaiMs)
    {
        await Task.Delay(_délai(délaiMs)).ConfigureAwait(false);
        action();
    }

    /// <summary>Vide le lot coalescé vers la vue (appelé verrouillé).</summary>
    private void ViderLot()
    {
        if (_lot.Length == 0) return;
        var data = _lot.ToString();
        _lot.Clear();
        _handlers?.OnData(data);
    }

    public void Write(string data)
    {
        ITerminalTransport? transport;
        lock (_verrou) transport = _transport;
        transport?.Write(data);
    }

    /// <summary>Interrompre le tour en cours : Ctrl+C envoyé au TTY (parité signalFreebuffPty).</summary>
    public void SignalInt() => Write("\x03");

    public void Resize(int cols, int rows)
    {
        lock (_verrou)
        {
            _taille = ClampDims(cols, rows);
            _transport?.Resize(_taille.Cols, _taille.Rows);
        }
    }

    /// <summary>Redémarrage manuel : tue la session et relance un process neuf (scrollback effacé).</summary>
    public void Restart()
    {
        lock (_verrou)
        {
            if (_handlers is null || _fabrique is null) return;
            _stopped = false;
            _bootAttempts = 0;
            var ancien = _transport;
            _transport = null;
            IsActive = false;
            _scrollback.Clear();
            try { ancien?.Kill(); } catch { /* déjà mort */ }
            _ = Programmer(() =>
            {
                lock (_verrou)
                {
                    if (_stopped) return;
                    DémarrerSession();
                }
            }, 300);
        }
    }

    /// <summary>Tue le process et réinitialise — uniquement à la fermeture de l'app.</summary>
    public void Dispose()
    {
        ITerminalTransport? transport;
        lock (_verrou)
        {
            _stopped = true;
            transport = _transport;
            _transport = null;
            IsActive = false;
            _handlers = null;
        }
        try { transport?.Kill(); } catch { /* déjà mort */ }
    }
}

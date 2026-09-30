using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// La machine à états du terminal (port de freebuff-pty.ts) testée SANS ConPTY :
/// fabrique de transports + délais accélérés. Vérifie backoff, plancher dims,
/// scrollback/replay, coalescing, grâce de boot avec re-spawn, arrêt propre.
/// </summary>
public class FreebuffTerminalTests : IDisposable
{
    private readonly FreebuffTerminal _terminal = new(délaiMs => 0); // délais accélérés

    /// <summary>Transport de test : pousse du texte, signale la sortie.</summary>
    private sealed class TransportTest : ITerminalTransport
    {
        public int Pid => 4242;
        public event Action<string>? Data;
        public event Action<int, int?>? Exit;
        public bool Tué;
        public List<string> Écrits { get; } = [];
        public void Write(string data) => Écrits.Add(data);
        public void Resize(int cols, int rows) { }
        public void Kill() => Tué = true;
        public void Émettre(string chunk) => Data?.Invoke(chunk);
        public void Quitter(int code = 0) => Exit?.Invoke(code, null);
    }

    private (List<string> Données, List<TerminalState> États, List<string> Erreurs, Func<TransportTest> Fabrique) Préparer()
    {
        var données = new List<string>();
        var états = new List<TerminalState>();
        var erreurs = new List<string>();
        var dernier = new TransportTest();
        _terminal.Start(() => dernier, new TerminalHandlers(données.Add, états.Add, (_, _) => { }, erreurs.Add));
        return (données, états, erreurs, () => dernier = new TransportTest());
    }

    public void Dispose() => _terminal.Dispose();

    [Theory]
    [InlineData(1, 1000)]
    [InlineData(2, 2000)]
    [InlineData(3, 4000)]
    [InlineData(4, 8000)] // parité exacte : Math.pow non plafonné
    public void Le_backoff_de_boot_est_de_1s_2s_4s(int tentative, int attendu) =>
        Assert.Equal(attendu, FreebuffTerminal.BackoffMs(tentative));

    [Theory]
    [InlineData(80, 24, 80, 24)]
    [InlineData(40, 10, 80, 24)]
    [InlineData(120, 30, 120, 30)]
    [InlineData(1000, 500, 500, 200)]
    public void Les_dimensions_sont_bornées_au_plancher_80x24(int cols, int rows, int attenduC, int attenduR)
    {
        var (c, r) = FreebuffTerminal.ClampDims(cols, rows);
        Assert.Equal((attenduC, attenduR), (c, r));
    }

    [Fact]
    public void Les_données_alimentent_le_scrollback_et_le_replay_à_la_reconnexion()
    {
        TransportTest transport = new();
        var données = new List<string>();
        _terminal.Start(() => transport, new TerminalHandlers(données.Add, _ => { }, (_, _) => { }, _ => { }));
        transport.Émettre("Bonjour ");
        transport.Émettre("le monde");

        // Nouvel attach : replay = scrollback, et le transport ORIGINAL reste le même
        // (reprise de session, pas de re-spawn).
        var second = new List<string>();
        var replay = _terminal.Start(() => new TransportTest(), new TerminalHandlers(second.Add, _ => { }, (_, _) => { }, _ => { }));
        Assert.Equal("Bonjour le monde", replay);
    }

    [Fact]
    public void Le_coalescing_groupe_les_chunks_jusqu_au_seuil_8_Ko()
    {
        TransportTest transport = new();
        var données = new List<string>();
        _terminal.Start(() => transport, new TerminalHandlers(données.Add, _ => { }, (_, _) => { }, _ => { }));

        for (var i = 0; i < 100; i++) transport.Émettre("x");
        Assert.Empty(données); // 100 o < 8192 : le lot attend (30 ms ou vidange d'état)
        transport.Émettre(new string('y', FreebuffTerminal.BatchMaxChars));
        Assert.Single(données); // le seuil a tout vidangé d'un coup
        Assert.Equal(100 + FreebuffTerminal.BatchMaxChars, données[0].Length);
    }

    [Fact]
    public void Les_états_vident_le_lot_avant_le_changement_détat()
    {
        TransportTest transport = new();
        var données = new List<string>();
        var sorties = new List<int>();
        _terminal.Start(() => transport, new TerminalHandlers(données.Add, _ => { }, (c, _) => sorties.Add(c), _ => { }));

        transport.Émettre("dernier morceau");
        transport.Quitter(0);
        Assert.Equal("dernier morceau", Assert.Single(données)); // vidange AVANT l'exit
        Assert.Equal(0, Assert.Single(sorties));
    }

    [Fact]
    public async Task La_mort_pendant_la_grâce_de_boot_relance_un_nouveau_transport()
    {
        // Délai sélectif : la grâce dure « vraiment » 50 ms (le temps de tuer dedans),
        // le backoff reste instantané. Avec un délai 0, le timer désarmerait la grâce
        // avant même la sortie du process (course observée).
        using var terminal = new FreebuffTerminal(d => d == FreebuffTerminal.BootGraceMs ? 50 : 0);
        var créés = new List<TransportTest>();
        var erreurs = new List<string>();
        var états = new List<TerminalState>();
        terminal.Start(
            () => { var t = new TransportTest(); créés.Add(t); return t; },
            new TerminalHandlers(_ => { }, états.Add, (_, _) => { }, erreurs.Add));
        créés[^1].Quitter(1); // mort DANS la fenêtre de grâce

        await Task.Delay(80);
        Assert.Contains(TerminalState.Restarting, états);
        Assert.True(créés.Count >= 2, "un NOUVEAU process doit être spawné (parité re-spawn)");
        Assert.Empty(erreurs);
    }

    [Fact]
    public async Task La_mort_après_la_grâce_de_boot_est_une_sortie_normale()
    {
        // Délai sélectif : la grâce de boot (5 000) s'écoule « vraiment » (50 ms),
        // tous les autres délais (backoff, restart) restent instantanés.
        using var terminal = new FreebuffTerminal(d => d == FreebuffTerminal.BootGraceMs ? 50 : 0);
        var créés = new List<TransportTest>();
        var données = new List<string>();
        var sorties = new List<int>();
        var erreurs = new List<string>();
        var étatsGrâce = new List<TerminalState>();
        terminal.Start(
            () => { var t = new TransportTest(); créés.Add(t); return t; },
            new TerminalHandlers(données.Add, étatsGrâce.Add, (c, _) => sorties.Add(c), erreurs.Add));
        // Attendre VRAIMENT l'état Running (le timer de grâce a désarmé la fenêtre) au
        // lieu d'un sleep : la course timer/pool rendait un délai fixe non déterministe.
        for (var i = 0; i < 200 && !étatsGrâce.Contains(TerminalState.Running); i++) await Task.Delay(10);
        Assert.Contains(TerminalState.Running, étatsGrâce);

        créés[^1].Émettre("du texte");
        créés[^1].Quitter(0);
        Assert.Equal("du texte", Assert.Single(données));
        Assert.Equal(0, Assert.Single(sorties));
        Assert.DoesNotContain(erreurs, e => e.Contains("échoué"));
    }

    [Fact]
    public void Dispose_tue_le_transport_et_ignore_les_événements_suivants()
    {
        TransportTest transport = new();
        var données = new List<string>();
        _terminal.Start(() => transport, new TerminalHandlers(données.Add, _ => { }, (_, _) => { }, _ => { }));
        _terminal.Dispose();
        Assert.True(transport.Tué);
        transport.Émettre("après la mort");
        Assert.Empty(données); // handlers détachés : rien ne traverse
    }

    [Fact]
    public void SignalInt_écrit_le_CtrlC_vers_le_transport()
    {
        TransportTest transport = new();
        _terminal.Start(() => transport, new TerminalHandlers(_ => { }, _ => { }, (_, _) => { }, _ => { }));
        _terminal.SignalInt();
        Assert.Equal("\x03", Assert.Single(transport.Écrits));
    }
}

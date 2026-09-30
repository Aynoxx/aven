using System.Collections.Concurrent;
using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Intégration phase 5 : le transport PTY RÉEL (micro-host Node + conpty.node
/// prébuildé d'Electron) branché à la machine à états FreebuffTerminal via
/// ITerminalTransport. AVEN_PTY_COMMAND remplace `freebuff` par une commande de
/// test — le CLI réel a un quota mono-session (pas de test automatisé contre lui).
/// </summary>
public class NodePtyHostIntegrationTests
{
    private static async Task<string> SortieDe(NodePtyTransport t, Task fin, int attenteMs = 20000)
    {
        var morceaux = new ConcurrentQueue<string>();
        t.Data += m => morceaux.Enqueue(m);
        var gagné = await Task.WhenAny(fin, Task.Delay(attenteMs));
        Assert.True(gagné == fin, "le process PTY n'est pas sorti à temps");
        await Task.Delay(100); // derniers morceaux en vol
        return string.Concat(morceaux);
    }

    [Fact]
    public async Task Echo_one_shot_le_texte_traverse_le_PTY()
    {
        Assert.True(OperatingSystem.IsWindows());
        Environment.SetEnvironmentVariable("AVEN_PTY_COMMAND", "echo TEST-OK-PTY");
        try
        {
            var fin = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var t = NodePtyTransport.Démarrer(AppContext.BaseDirectory, 80, 24);
            try
            {
                t.Exit += (_, _) => fin.TrySetResult();
                var sortie = await SortieDe(t, fin.Task);
                Assert.Contains("TEST-OK-PTY", sortie);
                Assert.True(t.Pid > 0); // le host a renvoyé le pid du process enfant
            }
            finally { t.Dispose(); }
        }
        finally { Environment.SetEnvironmentVariable("AVEN_PTY_COMMAND", null); }
    }

    [Fact]
    public async Task Cmd_interactif_on_écrit_dans_le_PTY_et_il_répond()
    {
        Assert.True(OperatingSystem.IsWindows());
        // cmd /c cmd.exe : un cmd interactif DANS le ConPTY (le cmd externe exécute
        // son enfant interactif qui lit le stdin du PTY).
        Environment.SetEnvironmentVariable("AVEN_PTY_COMMAND", "cmd.exe");
        try
        {
            var fin = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var t = NodePtyTransport.Démarrer(AppContext.BaseDirectory, 80, 24);
            var morceaux = new ConcurrentQueue<string>();
            t.Data += m => morceaux.Enqueue(m);
            try
            {
                t.Exit += (_, _) => fin.TrySetResult();
                await Task.Delay(800); // laisser le cmd imprimer sa bannière
                t.Write("echo PING-INTERACTIF\r\n");

                var début = Environment.TickCount64;
                while (!string.Concat(morceaux).Contains("PING-INTERACTIF") && Environment.TickCount64 - début < 10000)
                    await Task.Delay(50);

                Assert.Contains("PING-INTERACTIF", string.Concat(morceaux)); // l'écho du PTY nous répond
                t.Write("exit\r\n");
                await SortieDe(t, fin.Task);
            }
            finally { t.Dispose(); }
        }
        finally { Environment.SetEnvironmentVariable("AVEN_PTY_COMMAND", null); }
    }

    [Fact]
    public async Task Resize_et_kill_ne_plantent_pas_et_sont_idempotents()
    {
        Assert.True(OperatingSystem.IsWindows());
        Environment.SetEnvironmentVariable("AVEN_PTY_COMMAND", "ping -n 5 127.0.0.1 > nul");
        try
        {
            var fin = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var t = NodePtyTransport.Démarrer(AppContext.BaseDirectory, 80, 24);
            t.Exit += (_, _) => fin.TrySetResult();
            try
            {
                await Task.Delay(300);
                t.Resize(120, 40); // ConPTY redimensionné sans erreur
                t.Kill();
                await SortieDe(t, fin.Task);
                t.Kill(); // double kill : no-op
            }
            finally { t.Dispose(); t.Dispose(); } // double dispose : idempotent
        }
        finally { Environment.SetEnvironmentVariable("AVEN_PTY_COMMAND", null); }
    }

    [Fact]
    public async Task FreebuffTerminal_pilote_le_transport_réel_comme_un_double()
    {
        // La machine à états (backoff, grâce, coalescing) s'applique TELLE QUELLE au
        // vrai PTY : les données parviennent au handler OnData du terminal.
        Assert.True(OperatingSystem.IsWindows());
        Environment.SetEnvironmentVariable("AVEN_PTY_COMMAND", "echo VIA-TERMINAL");
        try
        {
            var terminal = new FreebuffTerminal((ms) => 0);
            var vu = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var tampon = new System.Text.StringBuilder();
            var handlers = new TerminalHandlers(
                OnData: m => { lock (tampon) { tampon.Append(m); if (tampon.ToString().Contains("VIA-TERMINAL")) vu.TrySetResult(); } },
                OnStatus: _ => { },
                OnExit: (_, _) => { },
                OnError: _ => { });
            terminal.Start(
                () => NodePtyTransport.Démarrer(AppContext.BaseDirectory, FreebuffTerminal.DefaultCols, FreebuffTerminal.DefaultRows),
                handlers);
            try
            {
                var gagné = await Task.WhenAny(vu.Task, Task.Delay(20000));
                Assert.True(gagné == vu.Task, "FreebuffTerminal n'a pas relayé la sortie PTY à temps");
            }
            finally { terminal.Dispose(); }
        }
        finally { Environment.SetEnvironmentVariable("AVEN_PTY_COMMAND", null); }
    }
}

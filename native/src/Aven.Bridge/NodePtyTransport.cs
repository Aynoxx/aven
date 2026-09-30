using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;

namespace Aven.Bridge;

/// <summary>
/// Transport PTY RÉEL (phase 5) : client du micro-host Node (aven-pty-host.mjs,
/// bundle esbuild de electron/pty-host.ts) qui pilote @lydell/node-pty — le MÊME
/// conpty.node prébuildé que l'app Electron, donc ZÉRO divergence de rendu TUI.
/// Échange par lignes JSON sur stdio : {type:"data"|"exit"|"ready"|"error"}.
/// Remplace le P/Invoke ConPTY direct (échec de attach process sur cette machine,
/// consigné au protocole). Satisfait Aven.Bridge.ITerminalTransport.
/// </summary>
public sealed class NodePtyTransport : Aven.Bridge.ITerminalTransport, IDisposable
{
    private readonly Process _host;
    private int _pid;

    public int Pid => _pid;
    public event Action<string>? Data;
    public event Action<int, int?>? Exit;

    /// <param name="nodeExecPath">Node exécutable (node.exe du système).</param>
    /// <param name="hostPath">Chemin du bundle aven-pty-host.mjs.</param>
    /// <param name="espace">Espace de travail passé au host (--cwd).</param>
    /// <param name="cols">Colonnes initiales.</param>
    /// <param name="rows">Lignes initiales.</param>
    private NodePtyTransport(string nodeExecPath, string hostPath, string espace, int cols, int rows)
    {
        var psi = new ProcessStartInfo
        {
            FileName = nodeExecPath,
            Arguments = $"\"{hostPath}\"",
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        _host = Process.Start(psi) ?? throw new InvalidOperationException("Impossible de démarrer le micro-host PTY.");

        _host.OutputDataReceived += (_, e) =>
        {
            if (e.Data is null) return;
            try
            {
                var msg = JsonNode.Parse(e.Data);
                switch (msg?["type"]?.GetValue<string>())
                {
                    case "ready":
                        _pid = msg["pid"]?.GetValue<int>() ?? 0;
                        break;
                    case "data":
                        Data?.Invoke(msg["chunk"]?.GetValue<string>() ?? "");
                        break;
                    case "exit":
                        Exit?.Invoke(msg["code"]?.GetValue<int>() ?? 0, msg["signal"] is { } s ? s.GetValue<int>() : null);
                        break;
                    case "error":
                        Debug.WriteLine("pty-host: " + msg["message"]?.GetValue<string>());
                        break;
                }
            }
            catch { /* ligne partielle : le host n'écrit que des lignes complètes */ }
        };
        var erreurs = new StringBuilder();
        _host.ErrorDataReceived += (_, e) => { if (e.Data is not null) erreurs.AppendLine(e.Data); };
        _host.BeginOutputReadLine();
        _host.BeginErrorReadLine();

        Envoyer(new JsonObject { ["type"] = "start", ["cwd"] = espace, ["cols"] = cols, ["rows"] = rows });
    }

    /// <summary>Démarre le micro-host et la session freebuff dans son ConPTY.</summary>
    public static NodePtyTransport Démarrer(string espace, int cols, int rows, string? nodeExecPath = null, string? hostPath = null)
    {
        if (hostPath is null)
        {
            // Cherche le bundle en remontant depuis l'exécutable (dev : racine du dépôt).
            hostPath = "";
            for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
            {
                var candidat = Path.Combine(dir.FullName, "dist-electron", "aven-pty-host.mjs");
                if (File.Exists(candidat)) { hostPath = candidat; break; }
            }
            if (string.IsNullOrEmpty(hostPath))
                throw new FileNotFoundException("aven-pty-host.mjs introuvable (bundle phase 1 manquant).");
        }
        var t = new NodePtyTransport(nodeExecPath ?? "node", hostPath, espace, cols, rows);
        return t;
    }

    private void Envoyer(JsonObject message)
    {
        try
        {
            _host.StandardInput.WriteLine(message.ToJsonString());
            _host.StandardInput.Flush();
        }
        catch { /* le host est mort : l'événement Exit prendra le relais */ }
    }

    public void Write(string data) =>
        Envoyer(new JsonObject { ["type"] = "write", ["data"] = data });

    public void Resize(int cols, int rows) =>
        Envoyer(new JsonObject { ["type"] = "resize", ["cols"] = cols, ["rows"] = rows });

    public void Kill() =>
        Envoyer(new JsonObject { ["type"] = "kill" });

    public void Dispose()
    {
        try { Kill(); } catch { /* déjà mort */ }
        try { if (!_host.HasExited) _host.Kill(entireProcessTree: true); } catch { /* déjà sorti */ }
        _host.Dispose();
    }
}

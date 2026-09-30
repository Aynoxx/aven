using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;

namespace Aven.Bridge;

/// <summary>Un événement push du moteur (engine.event), ex. message.part.updated.</summary>
public sealed record EngineEvent(string Type, JsonNode? Data);

/// <summary>
/// Client du host Aven.Engine (aven-engine-host.mjs) : spawn du process,
/// JSON-RPC 2.0 sur stdio, routage des réponses par id, notifications push.
/// Haut niveau par rapport à <see cref="JsonRpcConnection"/> : il possède le
/// process. Phase 1 du protocole MIGRATION-WINUI.md.
/// </summary>
public sealed class EngineClient : IAsyncDisposable
{
    private readonly string _hostPath;
    private readonly string? _nodeExecPath;
    private readonly string? _cwd;
    private Process? _process;
    private JsonRpcConnection? _connection;
    private readonly object _lock = new();

    /// <summary>Événements push du moteur (router.notice, message.part.updated…).</summary>
    public event Action<EngineEvent>? EventReceived;

    public EngineClient(string hostPath, string? nodeExecPath = null, string? cwd = null)
    {
        _hostPath = hostPath;
        _nodeExecPath = nodeExecPath;
        _cwd = cwd;
    }

    /// <summary>Le host tourne-t-il ?</summary>
    public bool IsRunning => _process is { HasExited: false };

    /// <summary>Démarre le host (idempotent) et renvoie la connexion JSON-RPC.</summary>
    public JsonRpcConnection Start()
    {
        lock (_lock)
        {
            if (_connection is { } existing) return existing;

            var psi = new ProcessStartInfo
            {
                FileName = _nodeExecPath ?? "node",
                Arguments = $"\"{_hostPath}\"",
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                WorkingDirectory = _cwd ?? AppContext.BaseDirectory,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            _process = Process.Start(psi) ?? throw new InvalidOperationException("Impossible de démarrer le host du moteur.");
            _connection = new JsonRpcConnection(_process.StandardOutput, _process.StandardInput);
            _connection.NotificationReceived += OnNotification;
            _connection.Start();
            _ = Task.Run(() =>
            {
                var err = _process.StandardError.ReadLine(); // ligne d'en-tête du host (log)
                if (err is not null) Debug.WriteLine(err);
            });
            return _connection;
        }
    }

    private void OnNotification(JsonNode? parameters)
    {
        var type = parameters?["type"]?.GetValue<string>();
        if (type is not null) EventReceived?.Invoke(new EngineEvent(type, parameters?["data"]));
    }

    /// <summary>Appel au host : "ping", "initialize", "session.list"… (proxy SDK).</summary>
    public Task<JsonNode?> CallAsync(string method, object? parameters = null, CancellationToken cancellationToken = default)
        => Start().CallAsync(method, parameters, cancellationToken);

    public async ValueTask DisposeAsync()
    {
        JsonRpcConnection? connection;
        Process? process;
        lock (_lock)
        {
            connection = _connection;
            process = _process;
            _connection = null;
            _process = null;
        }
        if (connection is not null)
        {
            try { await connection.NotifyAsync("shutdown").ConfigureAwait(false); } catch { /* le host meurt avec nous */ }
            await connection.DisposeAsync().ConfigureAwait(false);
        }
        if (process is { HasExited: false })
        {
            try { process.Kill(entireProcessTree: true); } catch { /* déjà sorti */ }
        }
        if (process is not null) process.Dispose();
    }
}

using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Aven.Bridge;

/// <summary>Le moteur a répondu par une erreur JSON-RPC (transport réussi, appel refusé).</summary>
public sealed class JsonRpcException : Exception
{
    /// <summary>Code d'erreur JSON-RPC (ex. -32601 méthode inconnue).</summary>
    public int Code { get; }

    public JsonRpcException(int code, string message) : base(message) => Code = code;
}

/// <summary>
/// Pont JSON-RPC 2.0 ligne-par-ligne (un message par ligne, stdio) vers le moteur
/// Aven.Engine — socle des phases 0-1 du protocole MIGRATION-WINUI.md.
/// Thread-safe : appels concurrents autorisés, chaque appel attend SA réponse
/// (routage par id, y compris quand les réponses arrivent dans le désordre).
/// </summary>
public sealed class JsonRpcConnection : IAsyncDisposable
{
    private readonly TextReader _reader;
    private readonly TextWriter _writer;
    private readonly object _writeLock = new();
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonNode?>> _pending = new();
    private readonly CancellationTokenSource _cts = new();
    private int _nextId;
    private Task? _readLoop;

    /// <summary>Notification push du moteur (params JSON), ex. opencode:event.</summary>
    public event Action<JsonNode?>? NotificationReceived;

    public JsonRpcConnection(TextReader reader, TextWriter writer)
    {
        _reader = reader;
        _writer = writer;
    }

    /// <summary>Démarre la lecture du flux entrant (idempotent ; appelé par CallAsync).</summary>
    public void Start()
    {
        if (_readLoop is not null) return;
        _readLoop = Task.Run(ReadLoopAsync);
    }

    /// <summary>Appel avec réponse : retourne le « result » JSON du moteur.</summary>
    /// <exception cref="JsonRpcException">Le moteur a répondu par une erreur.</exception>
    public async Task<JsonNode?> CallAsync(
        string method, object? @params = null, CancellationToken cancellationToken = default)
    {
        var id = Interlocked.Increment(ref _nextId).ToString(CultureInfo.InvariantCulture);
        var tcs = new TaskCompletionSource<JsonNode?>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[id] = tcs;
        try
        {
            Start();
            var request = new JsonObject
            {
                ["jsonrpc"] = "2.0",
                ["id"] = int.Parse(id, CultureInfo.InvariantCulture),
                ["method"] = method,
            };
            if (@params is not null) request["params"] = JsonSerializer.SerializeToNode(@params);
            await SendLineAsync(request.ToJsonString(), cancellationToken).ConfigureAwait(false);
            return await tcs.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _pending.TryRemove(id, out _);
        }
    }

    /// <summary>Notification sans réponse attendue (pas d'id — contrat JSON-RPC).</summary>
    public async Task NotifyAsync(string method, object? @params = null, CancellationToken cancellationToken = default)
    {
        Start();
        var notification = new JsonObject { ["jsonrpc"] = "2.0", ["method"] = method };
        if (@params is not null) notification["params"] = JsonSerializer.SerializeToNode(@params);
        await SendLineAsync(notification.ToJsonString(), cancellationToken).ConfigureAwait(false);
    }

    private async Task SendLineAsync(string line, CancellationToken cancellationToken)
    {
        lock (_writeLock)
        {
            _writer.WriteLine(line);
            _writer.Flush();
        }
        await Task.CompletedTask.ConfigureAwait(false);
    }

    private async Task ReadLoopAsync()
    {
        try
        {
            while (true)
            {
                var line = await _reader.ReadLineAsync(_cts.Token).ConfigureAwait(false);
                if (line is null) break;
                if (line.Length == 0) continue;
                JsonNode? node;
                try { node = JsonNode.Parse(line); }
                catch (JsonException) { continue; } // ligne corrompue : on saute, le flux continue
                if (node is not JsonObject message) continue;
                if (message["id"] is { } id) DispatchResponse(id, message);
                else if (message["method"] is not null) NotificationReceived?.Invoke(message["params"]);
            }
        }
        catch (OperationCanceledException) { return; }
        catch (Exception error)
        {
            FailAllPending(error);
            return;
        }
        FailAllPending(new IOException("Aven.Engine : flux d'entrée fermé."));
    }

    private void DispatchResponse(JsonNode id, JsonObject message)
    {
        // Les ids sont monotones : une réponse sans appel enregistré est obsolète,
        // on l'ignore (le flux continue).
        if (_pending.TryRemove(id.ToJsonString(), out var pending)) DeliverResponse(message, pending);
    }

    private static void DeliverResponse(JsonObject message, TaskCompletionSource<JsonNode?> pending)
    {
        if (message["error"] is JsonObject error)
        {
            var code = error["code"]?.GetValue<int>() ?? 0;
            var text = error["message"]?.GetValue<string>() ?? "Erreur JSON-RPC.";
            pending.TrySetException(new JsonRpcException(code, text));
        }
        else
        {
            pending.TrySetResult(message["result"]);
        }
    }

    private void FailAllPending(Exception error)
    {
        foreach (var key in _pending.Keys)
        {
            if (_pending.TryRemove(key, out var pending)) pending.TrySetException(error);
        }
    }

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel();
        if (_readLoop is { } loop)
        {
            try { await loop.ConfigureAwait(false); } catch { /* le lecteur meurt avec nous */ }
        }
        _cts.Dispose();
    }
}

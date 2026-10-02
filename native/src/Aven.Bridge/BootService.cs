using System.Text.Json.Nodes;

namespace Aven.Bridge;

/// <summary>Résultat d'un fichier synchronisé au seed (parité FileSyncResult de workspace-sync.ts).</summary>
public sealed record FileSyncResult(string File, string Status);

/// <summary>
/// État global de l'app — parité AppState de electron/main.ts (v10.0.0, jalon parité) :
/// ce que l'UI affiche (statut, clés enregistrées, espace actif, warnings) sans jamais
/// voir une clé en clair. <c>UpdatesConfigured</c> reste false côté natif (pas de
/// mise à jour auto — message identique à l'Electron « non configurée »).
/// </summary>
public sealed class AppModelState
{
    public string Status { get; init; } = "starting"; // starting | ready | error
    public string? Error { get; init; }
    /// <summary>Vrai tant qu'aucun espace n'a été choisi : écran de choix au lieu d'un moteur.</summary>
    public bool NeedsWorkspace { get; init; }
    public IReadOnlyDictionary<string, bool> Keys { get; init; } = new Dictionary<string, bool>();
    public IReadOnlyDictionary<string, string> KeyWarnings { get; init; } = new Dictionary<string, string>();
    public IReadOnlyList<WorkspaceEntry> Workspaces { get; init; } = [];
    public string? Workspace { get; init; }
    public string? Version { get; init; }
    /// <summary>Source du binaire OpenCode (parité cli : « embarqué » / « PATH »).</summary>
    public string? Cli { get; init; }
    public IReadOnlyList<FileSyncResult> Sync { get; init; } = [];
    public IReadOnlyList<string> NewModels { get; init; } = [];
    public IReadOnlyList<string> RemovedModels { get; init; } = [];
    public IReadOnlyList<string> AgentsBridge { get; init; } = [];
    /// <summary>agent → modèles par ordre de priorité (lecture seule, format host).</summary>
    public JsonNode? Assignments { get; init; }
    public string? Warning { get; init; }
    public string? VersionWarning { get; init; }
    public bool UpdatesConfigured { get; init; } // false : aucune mise à jour auto côté natif
}

/// <summary>
/// Boot du moteur — port de bootImpl/engineBoot de electron/main.ts (v10.0.0, jalon
/// parité) : le host Node (aven-engine-host.mjs) démarre au lancement, prépare
/// l'espace (méthode partagée « workspace.seed », MÊME code que l'Electron), bâtit
/// le pont d'agents, puis appelle « initialize » avec les clés (env), les priorités
/// et le binaire OpenCode résolu. Un seul host par boot (l'ancien est arrêté — parité
/// engineShutdown) ; l'UI ne consomme que l'état public et les clients exposés.
/// </summary>
public sealed class BootService : IAsyncDisposable
{
    private readonly string _dataDir;
    private readonly SemaphoreSlim _verrou = new(1, 1);
    private TaskCompletionSource _finBoot = Completer();

    public BootService(string? dataDir = null) => _dataDir = dataDir ?? AppData.Dir();

    public AppModelState State { get; private set; } = new() { Status = "starting", NeedsWorkspace = true };
    public event Action<AppModelState>? StateChanged;

    /// <summary>Host moteur vivant (null avant le premier boot) — événements, chat, voix.</summary>
    public EngineClient? Engine { get; private set; }
    public ConversationClient? Client { get; private set; }

    private static TaskCompletionSource Completer() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    private AppModelState Publier(AppModelState state)
    {
        State = state;
        if (state.Status != "starting") _finBoot.TrySetResult();
        StateChanged?.Invoke(state);
        return state;
    }

    public WorkspaceEntry? ActiveWorkspace() => WorkspacesService.Active(_dataDir);

    /// <summary>Registre (avec import initial du Classic) — appelé par l'UI au démarrage.</summary>
    public IReadOnlyList<WorkspaceEntry> ListerEspaces() =>
        WorkspacesService.ListWithElectronImport(_dataDir, AppData.ElectronDir());

    /// <summary>État « aucun espace choisi » — écran de choix, aucun moteur (parité v9.1.5).</summary>
    public AppModelState PublierBesoinEspace()
    {
        var registre = ListerEspaces();
        return Publier(new AppModelState
        {
            Status = "starting",
            NeedsWorkspace = ActiveWorkspace() is null,
            Keys = KeysService.Flags(_dataDir),
            Workspaces = registre,
        });
    }

    /// <summary>Attend la fin d'un boot en cours (starting → ready/error), borné en durée.</summary>
    public async Task<AppModelState> AttendreAsync(TimeSpan timeout, CancellationToken cancellation = default)
    {
        if (State.Status != "starting") return State;
        var attente = _finBoot.Task;
        await Task.WhenAny(attente, Task.Delay(timeout, cancellation)).ConfigureAwait(false);
        return State;
    }

    // ── Résolutions (dev : remonte jusqu'à la racine du dépôt ; packagé : layout racine) ──

    /// <summary>Chemin du bundle aven-engine-host.mjs (parité ChercherHost).</summary>
    public static string TrouverHost(string baseDir)
    {
        for (var dir = new DirectoryInfo(baseDir); dir is not null; dir = dir.Parent)
        {
            var candidat = Path.Combine(dir.FullName, "dist-electron", "aven-engine-host.mjs");
            if (File.Exists(candidat)) return candidat;
        }
        return Path.Combine(baseDir, "aven-engine-host.mjs");
    }

    /// <summary>Dossier-gabarit (opencode.jsonc, .opencode/, model-priorities.json) :
    /// racine du dépôt en dev, racine du layout portable une fois packagé.</summary>
    public static string TrouverTemplateDir(string baseDir)
    {
        for (var dir = new DirectoryInfo(baseDir); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "model-priorities.json"))) return dir.FullName;
        }
        return baseDir;
    }

    /// <summary>Binaire OpenCode — port de resolveOpenCodeBin (opencode-bridge.ts) :
    /// OPENCODE_BIN > opencode-bin/opencode.exe (packagé) > node_modules (dev) > PATH.</summary>
    public static (string Command, bool Shell, string Source) ResoudreBinOpenCode(string templateDir)
    {
        var env = Environment.GetEnvironmentVariable("OPENCODE_BIN");
        if (!string.IsNullOrWhiteSpace(env))
            return (env, OperatingSystem.IsWindows() && !env.EndsWith(".exe", StringComparison.OrdinalIgnoreCase), "OPENCODE_BIN");

        var embarque = Path.Combine(templateDir, "opencode-bin", "opencode.exe");
        if (File.Exists(embarque)) return (embarque, false, "embarqué");

        var dev = Path.Combine(templateDir, "node_modules", "@opencode", "cli", "bin", "opencode.exe");
        if (File.Exists(dev)) return (dev, false, "embarqué");

        return ("opencode", OperatingSystem.IsWindows(), "PATH");
    }

    // ── Boot ────────────────────────────────────────────────────────────────────

    /// <summary>(Re)démarre le host et initialise le moteur sur l'espace donné —
    /// sérialisé : deux boots concurrents ne se marchent pas dessus (parité bootQueue).</summary>
    public async Task<AppModelState> BootAsync(string workspace, CancellationToken cancellation = default)
    {
        await _verrou.WaitAsync(cancellation).ConfigureAwait(false);
        try
        {
            _finBoot = Completer();
            var entries = ListerEspaces();
            var keys = KeysService.Load(_dataDir);
            var flags = Providers.Liste.ToDictionary(p => p.Id, p => keys.ContainsKey(p.Id));
            var keyWarnings = new Dictionary<string, string>();

            // Sonde OpenRouter (parité bootImpl) : « invalid » coupe le fournisseur pour
            // ce boot (excludeProvider), « unknown » ne fait qu'avertir.
            var openRouterUsable = true;
            if (keys.TryGetValue("openrouter", out var cleOr) && cleOr is not null)
            {
                var (usable, warning) = await Providers.SondeOpenRouterAsync(cleOr, http: null, cancellation).ConfigureAwait(false);
                if (!usable)
                {
                    openRouterUsable = false;
                    keyWarnings["openrouter"] = $"Clé OpenRouter refusée : {warning} Remplace-la dans Paramètres.";
                }
                else if (warning is not null)
                {
                    keyWarnings["openrouter"] = warning;
                }
            }

            var env = new Dictionary<string, string>();
            foreach (var provider in Providers.Liste)
            {
                if (!keys.TryGetValue(provider.Id, out var valeur)) continue;
                if (provider.Id == "openrouter" && !openRouterUsable) continue;
                env[provider.Env] = valeur;
            }

            Publier(new AppModelState
            {
                Status = "starting",
                Keys = flags,
                Workspaces = entries,
                Workspace = workspace,
            });

            try
            {
                await RedemarrerHostAsync(cancellation).ConfigureAwait(false);
                var engine = Engine!;
                var templateDir = TrouverTemplateDir(AppContext.BaseDirectory);

                // 1. Seed de l'espace via le host (MÊME code TS que l'Electron) —
                //    un échec de seed est bloquant (parité : seedWorkspace lève).
                var seed = await engine.CallAsync("workspace.seed",
                    new { workspace, templateDir }, cancellation).ConfigureAwait(false);

                // 2. Pont d'agents (.agents/ + mcp.json) — best effort (parité main.ts :
                //    un échec n'empêche jamais le boot, le TUI reste utilisable).
                var agentsBridge = new List<string>();
                try
                {
                    var pont = await engine.CallAsync("agents.bridge",
                        new { workspace, templateDir }, cancellation).ConfigureAwait(false);
                    agentsBridge.AddRange((pont?["written"] as JsonArray ?? [])
                        .Select(n => Jsonx.S(n) ?? "").Where(s => s.Length > 0));
                }
                catch { /* pont best effort */ }

                // 3. initialize : le moteur démarre (serveur OpenCode, routeur, catalogue).
                var (binPath, binShell, binSource) = ResoudreBinOpenCode(templateDir);
                var initialisation = await engine.CallAsync("initialize", new
                {
                    workspace,
                    env,
                    prioritiesPath = Path.Combine(workspace, "model-priorities.json"),
                    templatePrioritiesPath = Path.Combine(templateDir, "model-priorities.json"),
                    excludeProvider = openRouterUsable ? null : "openrouter",
                    binPath,
                    binShell,
                }, cancellation).ConfigureAwait(false);

                // Clés enregistrées sans modèle actif détecté (parité engineBoot).
                var actifs = new HashSet<string>((initialisation?["activeProviders"] as JsonArray ?? [])
                    .Select(n => Jsonx.S(n) ?? ""));
                foreach (var provider in Providers.Liste)
                {
                    if (flags.TryGetValue(provider.Id, out var hasKey) && hasKey &&
                        !keyWarnings.ContainsKey(provider.Id) && !actifs.Contains(provider.Id))
                    {
                        keyWarnings[provider.Id] =
                            "Clé enregistrée, mais aucun modèle actif détecté pour ce fournisseur — vérifie qu'elle est valide.";
                    }
                }

                return Publier(new AppModelState
                {
                    Status = "ready",
                    Keys = flags,
                    KeyWarnings = keyWarnings,
                    Workspaces = entries,
                    Workspace = workspace,
                    Version = Jsonx.S(initialisation?["version"]),
                    Cli = Jsonx.S(initialisation?["binSource"]) ?? binSource,
                    Sync = LireSync(seed),
                    NewModels = LireStrings(seed?["newModels"]),
                    RemovedModels = LireStrings(seed?["removedModels"]),
                    AgentsBridge = agentsBridge,
                    Assignments = initialisation?["assignments"],
                    Warning = Jsonx.S(initialisation?["warning"]),
                    VersionWarning = Jsonx.S(initialisation?["versionWarning"]),
                });
            }
            catch (Exception erreur)
            {
                return Publier(new AppModelState
                {
                    Status = "error",
                    Error = erreur.Message,
                    Keys = flags,
                    KeyWarnings = keyWarnings,
                    Workspaces = entries,
                    Workspace = workspace,
                });
            }
        }
        finally
        {
            _verrou.Release();
        }
    }

    /// <summary>Stoppe l'ancien host (moteur compris) puis en démarre un neuf —
    /// parité engineShutdown + engine.start du boot Electron.</summary>
    private async Task RedemarrerHostAsync(CancellationToken cancellation)
    {
        if (Engine is { } ancien)
        {
            Engine = null;
            Client = null;
            try { await ancien.DisposeAsync().ConfigureAwait(false); }
            catch { /* le process peut déjà être mort */ }
        }
        var host = TrouverHost(AppContext.BaseDirectory);
        Engine = new EngineClient(host, NodePtyTransport.RésoudreNode());
        Client = new ConversationClient(Engine);
    }

    private static List<FileSyncResult> LireSync(JsonNode? seed) =>
        (seed?["sync"] as JsonArray ?? []).Select(n => new FileSyncResult(
            Jsonx.S(Jsonx.At(n, "file")) ?? "",
            Jsonx.S(Jsonx.At(n, "status")) ?? "")).ToList();

    private static List<string> LireStrings(JsonNode? node) =>
        (node as JsonArray ?? []).Select(n => Jsonx.S(n) ?? "").Where(s => s.Length > 0).ToList();

    public async ValueTask DisposeAsync()
    {
        if (Engine is { } engine)
        {
            Engine = null;
            Client = null;
            try { await engine.DisposeAsync().ConfigureAwait(false); } catch { /* déjà mort */ }
        }
        _verrou.Dispose();
    }
}

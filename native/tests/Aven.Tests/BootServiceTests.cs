using System.Text.Json.Nodes;
using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Port de bootImpl/engineBoot de electron/main.ts (v10.0.0, jalon parité) : les
/// résolutions du boot (bundle host, dossier-gabarit, binaire OpenCode) et le seed
/// d'espace via le VRAI host (méthode « workspace.seed » partagée — le même code TS
/// que l'Electron), plus le pont d'agents « agents.bridge ». Le boot complet
/// (initialize + serveur OpenCode) reste couvert par le smoke de bout en bout.
/// </summary>
public class BootServiceTests : IDisposable
{
    private readonly string _racine = Path.Combine(Path.GetTempPath(), "aven-boot-" + Guid.NewGuid().ToString("N"));
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "aven-boot-data-" + Guid.NewGuid().ToString("N"));

    public BootServiceTests() => Directory.CreateDirectory(_racine);

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("OPENCODE_BIN", null);
        try { Directory.Delete(_racine, recursive: true); } catch { }
        try { Directory.Delete(_dir, recursive: true); } catch { }
    }

    // ── Résolutions ────────────────────────────────────────────────────────────

    [Fact]
    public void TrouverHost_remonte_jusqu_au_bundle_dist_electron()
    {
        // Arborescence dev : <racine>/dist-electron/aven-engine-host.mjs, baseDir plus bas.
        var bundle = Path.Combine(_racine, "dist-electron", "aven-engine-host.mjs");
        Directory.CreateDirectory(Path.GetDirectoryName(bundle)!);
        File.WriteAllText(bundle, "// bundle factice");
        var baseDir = Path.Combine(_racine, "bin", "net8.0");
        Directory.CreateDirectory(baseDir);

        Assert.Equal(bundle, BootService.TrouverHost(baseDir));
    }

    [Fact]
    public void TrouverHost_sans_bundle_repli_au_niveau_de_baseDir()
    {
        // Hors de l'arborescence du dépôt : aucun dist-electron au-dessus.
        var vide = Path.Combine(Path.GetTempPath(), "aven-host-vide-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(vide);
        try { Assert.Equal(Path.Combine(vide, "aven-engine-host.mjs"), BootService.TrouverHost(vide)); }
        finally { try { Directory.Delete(vide, recursive: true); } catch { } }
    }

    [Fact]
    public void TrouverTemplateDir_remonte_jusqu_au_model_priorities()
    {
        // Gabarit = dossier qui porte model-priorities.json (racine du dépôt en dev).
        File.WriteAllText(Path.Combine(_racine, "model-priorities.json"), "{}");
        var baseDir = Path.Combine(_racine, "app", "x64", "Debug");
        Directory.CreateDirectory(baseDir);

        Assert.Equal(_racine, BootService.TrouverTemplateDir(baseDir));

        // Aucun gabarit au-dessus : baseDir lui-même (le seed ignore les fichiers absents).
        var orphelin = Path.Combine(Path.GetTempPath(), "aven-sans-gabarit-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(orphelin);
        try { Assert.Equal(orphelin, BootService.TrouverTemplateDir(orphelin)); }
        finally { try { Directory.Delete(orphelin, recursive: true); } catch { } }
    }

    [Fact]
    public void ResoudreBinOpenCode_privilégie_OPENCODE_BIN_puis_leembarqué_puis_PATH()
    {
        // 1. Variable d'environnement (repli documenté pour un binaire externe).
        Environment.SetEnvironmentVariable("OPENCODE_BIN", Path.Combine(_racine, "opencode.exe"));
        var (cmd1, _, source1) = BootService.ResoudreBinOpenCode(_racine);
        Assert.Equal(Path.Combine(_racine, "opencode.exe"), cmd1);
        Assert.Equal("OPENCODE_BIN", source1);
        Environment.SetEnvironmentVariable("OPENCODE_BIN", null);

        // 2. Embarqué packagé : <gabarit>/opencode-bin/opencode.exe.
        var g1 = Path.Combine(_racine, "gabarit-embarque");
        var embarqué = Path.Combine(g1, "opencode-bin", "opencode.exe");
        Directory.CreateDirectory(Path.GetDirectoryName(embarqué)!);
        File.WriteAllText(embarqué, "fake");
        var (cmd2, shell2, source2) = BootService.ResoudreBinOpenCode(g1);
        Assert.Equal(embarqué, cmd2);
        Assert.False(shell2);
        Assert.Equal("embarqué", source2);

        // 3. Dev : node_modules du dépôt (opencode-bin absent → priorité au node_modules).
        var g2 = Path.Combine(_racine, "gabarit-dev");
        var dev = Path.Combine(g2, "node_modules", "@opencode", "cli", "bin", "opencode.exe");
        Directory.CreateDirectory(Path.GetDirectoryName(dev)!);
        File.WriteAllText(dev, "fake");
        var (cmd3, shell3, source3) = BootService.ResoudreBinOpenCode(g2);
        Assert.Equal(dev, cmd3);
        Assert.False(shell3);
        Assert.Equal("embarqué", source3);

        // 4. Rien d'embarqué : la commande « opencode » du PATH (shell sous Windows).
        var vide = Path.Combine(_racine, "vide-bin");
        Directory.CreateDirectory(vide);
        var (cmd4, shell4, source4) = BootService.ResoudreBinOpenCode(vide);
        Assert.Equal("opencode", cmd4);
        Assert.Equal(OperatingSystem.IsWindows(), shell4);
        Assert.Equal("PATH", source4);
    }

    // ── État du boot (écran de choix, pas de moteur) ───────────────────────────

    [Fact]
    public async Task PublierBesoinEspace_annonce_l_écran_de_choice_sans_moteur()
    {
        // Registre natif VIDE pré-créé : l'import du Classic de la machine est neutralisé
        // (le test reste déterministe quel que soit l'état de %APPDATA%\aven).
        Directory.CreateDirectory(_dir);
        File.WriteAllText(WorkspacesService.Fichier(_dir), "{\"list\":[]}");

        await using var boot = new BootService(_dir);
        var état = boot.PublierBesoinEspace();

        Assert.Equal("starting", état.Status);
        Assert.True(état.NeedsWorkspace);              // v9.1.5 : aucun espace imposé
        Assert.Null(état.Workspace);
        Assert.All(Providers.Liste, p => Assert.Contains(p.Id, état.Keys)); // flags seulement, jamais la clé
        Assert.False(état.UpdatesConfigured);          // pas de mise à jour auto côté natif

        // AttendreAsync sur un boot jamais lancé : retourne l'état courant après le délai, sans blocage.
        var départ = Environment.TickCount64;
        var relu = await boot.AttendreAsync(TimeSpan.FromMilliseconds(120));
        Assert.Equal("starting", relu.Status);
        Assert.True(Environment.TickCount64 - départ < 5000);
        Assert.Null(boot.Client);
    }

    // ── Seed d'espace via le VRAI host (partage du code TS avec l'Electron) ────

    private static string? ChercherBundle()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidat = Path.Combine(dir.FullName, "dist-electron", "aven-engine-host.mjs");
            if (File.Exists(candidat)) return candidat;
        }
        return null;
    }

    [Fact]
    public async Task WorkspaceSeed_via_le_vrai_host_crée_les_fichiers_suivis_puis_est_idempotent()
    {
        var bundle = ChercherBundle();
        if (bundle is null)
        {
            // Même honnêteté que EngineHostProcessTests : échouer en CI (le bundle est
            // garanti par build:electron), skip silencieux en local neuf.
            if (Environment.GetEnvironmentVariable("CI") == "true")
                Assert.Fail("bundle aven-engine-host.mjs absent : lancez npm run build:electron avant les tests.");
            return;
        }

        var gabarit = BootService.TrouverTemplateDir(AppContext.BaseDirectory); // racine du dépôt en dev
        Assert.True(File.Exists(Path.Combine(gabarit, "model-priorities.json")),
            "le dossier-gabarit doit porter model-priorities.json");

        var espace = Path.Combine(_racine, "espace");
        await using var engine = new EngineClient(bundle, nodeExecPath: "node");
        using var annulé = new CancellationTokenSource(TimeSpan.FromSeconds(30));

        var seed = await engine.CallAsync("workspace.seed",
            new { workspace = espace, templateDir = gabarit }, annulé.Token);
        Assert.NotNull(seed);

        // Fichiers suivis copiés depuis le gabarit (TRACKED + agents découverts).
        Assert.True(File.Exists(Path.Combine(espace, "opencode.jsonc")));
        Assert.True(File.Exists(Path.Combine(espace, "model-priorities.json")));
        Assert.True(File.Exists(Path.Combine(espace, ".opencode", "plugins", "aven-tool-guard.js")));
        var agents = Directory.GetFiles(Path.Combine(espace, ".opencode", "agents"), "*.md");
        Assert.NotEmpty(agents);                        // ex. projet.md propagé au gabarit
        Assert.True(Directory.Exists(Path.Combine(espace, ".opencode-app", "baseline")));

        var sync = seed!["sync"] as JsonArray;
        Assert.NotNull(sync);
        Assert.Contains(sync!, e => JsonAide.Texte(e, "file") == "opencode.jsonc" &&
                                    JsonAide.Texte(e, "status") == "created");

        // Idempotent : un second seed ne réécrit plus rien de suivi et jamais un fichier
        // personnalisé (ici opencode.jsonc touché par l'utilisateur → « custom »).
        File.AppendAllText(Path.Combine(espace, "opencode.jsonc"), "\n// ma personnalisation\n");
        var second = await engine.CallAsync("workspace.seed",
            new { workspace = espace, templateDir = gabarit }, annulé.Token);
        var sync2 = (second!["sync"] as JsonArray)!;
        Assert.Contains(sync2, e => JsonAide.Texte(e, "file") == "opencode.jsonc" &&
                                    JsonAide.Texte(e, "status") == "custom");
        Assert.Contains("ma personnalisation", File.ReadAllText(Path.Combine(espace, "opencode.jsonc")));
    }

    [Fact]
    public async Task AgentsBridge_via_le_vrai_host_écrit_le_pont_d_agents()
    {
        var bundle = ChercherBundle();
        if (bundle is null)
        {
            if (Environment.GetEnvironmentVariable("CI") == "true")
                Assert.Fail("bundle aven-engine-host.mjs absent : lancez npm run build:electron avant les tests.");
            return;
        }

        var gabarit = BootService.TrouverTemplateDir(AppContext.BaseDirectory);
        var espace = Path.Combine(_racine, "espace-pont");
        await using var engine = new EngineClient(bundle, nodeExecPath: "node");
        using var annulé = new CancellationTokenSource(TimeSpan.FromSeconds(30));

        var pont = await engine.CallAsync("agents.bridge",
            new { workspace = espace, templateDir = gabarit }, annulé.Token);
        var written = (pont!["written"] as JsonArray)!.Select(n => n?.GetValue<string>() ?? "").ToList();

        Assert.Contains(".agents/mcp.json", written);          // notes Aven exposées à Freebuff
        Assert.Contains(".agents/README.md", written);
        Assert.Contains(".agents/types/agent-definition.ts", written);
        Assert.Contains(written, w => w.StartsWith(".agents/") && w.EndsWith(".ts") && w != ".agents/tools.ts");
        Assert.True(File.Exists(Path.Combine(espace, ".agents", "mcp.json")));

        // Idempotent : le second pont ne réécrit que si le contenu change.
        var second = await engine.CallAsync("agents.bridge",
            new { workspace = espace, templateDir = gabarit }, annulé.Token);
        Assert.Empty((second!["written"] as JsonArray)!);
    }
}

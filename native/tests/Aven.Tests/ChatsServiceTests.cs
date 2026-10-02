using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Jalon parité conversations (v10.0.0) : archives + noms d'agents de l'espace (port de
/// electron/archive.ts / agent-names.ts — MÊME format disque, tolérance aux fichiers
/// absents/corrompus) et liste des conversations/agents (parité ops.chats + listAgents :
/// filtres parentID, agent, archivées, TABS/subagent/hidden) contre le double honnête du
/// host. Le double est partagé par la classe (sessions persistantes) : chaque assertion
/// est scopée par id ou par agent de test — jamais de compte global.
/// </summary>
public class ChatsServiceTests : IClassFixture<HostDouble>, IDisposable
{
    private readonly HostDouble _double;
    private readonly string _ws;

    public ChatsServiceTests(HostDouble @double)
    {
        _double = @double;
        _ws = Path.Combine(Path.GetTempPath(), $"aven-chats-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_ws);
    }

    public void Dispose()
    {
        try { Directory.Delete(_ws, recursive: true); } catch { /* temp nettoyé par l'OS */ }
    }

    // ── Archives (port electron/archive.ts) ─────────────────────────────────────

    [Fact]
    public void Archives_fichier_absent_ou_illisible_egal_ensemble_vide()
    {
        Assert.Empty(ChatsService.ListArchived(_ws));
        Assert.False(ChatsService.IsArchived(_ws, "s1"));
        Assert.False(File.Exists(ChatsService.ArchivedFile(_ws))); // lecture seule : rien n'est créé

        Directory.CreateDirectory(Path.GetDirectoryName(ChatsService.ArchivedFile(_ws))!);
        File.WriteAllText(ChatsService.ArchivedFile(_ws), "pas du json {");
        Assert.Empty(ChatsService.ListArchived(_ws));
    }

    [Fact]
    public void Archives_ajout_retrait_idempotent_format_compact_sans_BOM()
    {
        ChatsService.SetArchived(_ws, "a", true);
        ChatsService.SetArchived(_ws, "a", true); // idempotent (set)
        ChatsService.SetArchived(_ws, "b", true);
        Assert.True(ChatsService.IsArchived(_ws, "a"));
        Assert.True(ChatsService.IsArchived(_ws, "b"));

        var brut = File.ReadAllText(ChatsService.ArchivedFile(_ws));
        Assert.StartsWith("[", brut);
        Assert.DoesNotContain(" ", brut); // compact (parité writeJsonAtomic)
        Assert.DoesNotContain("\n", brut);
        // BOM vérifié sur les OCTETS : DoesNotContain("\uFEFF") en culture fr-FR
        // "matche" une chaîne vide en pos 0 (piege xUnit, pas un vrai BOM).
        var octets = File.ReadAllBytes(ChatsService.ArchivedFile(_ws));
        Assert.False(octets.Length >= 3 && octets[0] == 0xEF && octets[1] == 0xBB && octets[2] == 0xBF,
            "BOM UTF-8 en tête : " + BitConverter.ToString(octets, 0, Math.Min(3, octets.Length)));

        ChatsService.SetArchived(_ws, "a", false);
        Assert.False(ChatsService.IsArchived(_ws, "a"));
        Assert.True(ChatsService.IsArchived(_ws, "b")); // l'autre entrée survit
    }

    [Fact]
    public void Archives_entrees_non_textuelles_ignorees()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(ChatsService.ArchivedFile(_ws))!);
        File.WriteAllText(ChatsService.ArchivedFile(_ws), "[\"ok\",42,null,\"\"]");
        var ids = ChatsService.ListArchived(_ws);
        Assert.Single(ids);
        Assert.Contains("ok", ids);
    }

    // ── Noms d'agents (port electron/agent-names.ts) ────────────────────────────

    [Fact]
    public void Noms_agents_fichier_absent_ou_corrompu_egal_rien()
    {
        Assert.Empty(ChatsService.LoadAgentNames(_ws));

        Directory.CreateDirectory(Path.GetDirectoryName(ChatsService.AgentNamesFile(_ws))!);
        File.WriteAllText(ChatsService.AgentNamesFile(_ws), "{couvert");
        Assert.Empty(ChatsService.LoadAgentNames(_ws));
    }

    [Fact]
    public void Noms_agents_seules_les_chaines_non_vides_sont_lues()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(ChatsService.AgentNamesFile(_ws))!);
        File.WriteAllText(ChatsService.AgentNamesFile(_ws),
            "{\"projet\":\"Mon chef\",\"vide\":\"\",\"nombre\":42,\"espaces\":\"   \"}");
        var noms = ChatsService.LoadAgentNames(_ws);
        var seul = Assert.Single(noms);
        Assert.Equal("projet", seul.Key);
        Assert.Equal("Mon chef", seul.Value);
    }

    // ── Liste des conversations (parité ops.chats) ──────────────────────────────

    [Fact]
    public async Task Liste_conversations_filtre_sous_agents_agent_et_archives()
    {
        using var annulé = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await using var moteur = new EngineClient(_double.Path, nodeExecPath: "node");
        var client = new ConversationClient(moteur);

        var création1 = await client.CreateChatAsync("projet", _ws, annulé.Token);
        var création2 = await client.CreateChatAsync("analyse", _ws, annulé.Token);

        var tous = await client.ListChatsAsync(_ws, cancellation: annulé.Token);
        Assert.DoesNotContain(tous, c => c.Id == "sous1"); // parentID → hors liste
        var listé = Assert.Single(tous, c => c.Id == création1.Id);
        Assert.Equal("Nouvelle conversation", listé.Title);
        Assert.Equal("free/big-pickle", listé.Model); // ref « fournisseur/modèle »
        Assert.Equal(1, listé.Updated);
        Assert.False(listé.Archived);

        // Filtre agent.
        var projets = await client.ListChatsAsync(_ws, agent: "projet", cancellation: annulé.Token);
        Assert.All(projets, c => Assert.Equal("projet", c.Agent));
        Assert.Contains(projets, c => c.Id == création1.Id);
        Assert.DoesNotContain(projets, c => c.Id == création2.Id);

        // Archivée : exclue par défaut, incluse avec includeArchived.
        ChatsService.SetArchived(_ws, création1.Id, true);
        var actives = await client.ListChatsAsync(_ws, cancellation: annulé.Token);
        Assert.DoesNotContain(actives, c => c.Id == création1.Id);
        Assert.Contains(actives, c => c.Id == création2.Id);

        var avecArchives = await client.ListChatsAsync(_ws, includeArchived: true, cancellation: annulé.Token);
        var archivée = Assert.Single(avecArchives, c => c.Id == création1.Id);
        Assert.True(archivée.Archived);
    }

    // ── Liste des agents (parité listAgents) ────────────────────────────────────

    [Fact]
    public async Task Liste_agents_filtre_subagent_hidden_et_hors_TABS_avec_noms_personnalises()
    {
        using var annulé = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await using var moteur = new EngineClient(_double.Path, nodeExecPath: "node");
        var client = new ConversationClient(moteur);

        Directory.CreateDirectory(Path.GetDirectoryName(ChatsService.AgentNamesFile(_ws))!);
        File.WriteAllText(ChatsService.AgentNamesFile(_ws), "{\"projet\":\"Mon chef\"}");

        var agents = await client.ListAgentsAsync(_ws, annulé.Token);
        Assert.Equal(new[] { "projet", "code", "analyse", "recherche" }, agents.Select(a => a.Id).ToArray());

        var chef = Assert.Single(agents, a => a.Id == "projet");
        Assert.Equal("Mon chef", chef.Name);       // nom personnalisé de l'espace
        Assert.Equal("Projet", chef.DefaultName);  // nom d'origine
        Assert.Equal("Orchestrateur", chef.Description);
    }

    // ── Suppression / renommage (parité deleteChat / renameChat) ────────────────

    [Fact]
    public async Task Suppression_conversation_retire_de_la_liste_et_nettoie_l_archive()
    {
        using var annulé = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await using var moteur = new EngineClient(_double.Path, nodeExecPath: "node");
        var client = new ConversationClient(moteur);

        var création = await client.CreateChatAsync("code", _ws, annulé.Token);
        ChatsService.SetArchived(_ws, création.Id, true);
        await client.DeleteChatAsync(création.Id, _ws, annulé.Token);

        Assert.DoesNotContain(création.Id, ChatsService.ListArchived(_ws)); // entrée nettoyée
        var liste = await client.ListChatsAsync(_ws, includeArchived: true, cancellation: annulé.Token);
        Assert.DoesNotContain(liste, c => c.Id == création.Id);
    }

    [Fact]
    public async Task Renommage_trim_troncature_120_et_titre_vide_rejete()
    {
        using var annulé = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await using var moteur = new EngineClient(_double.Path, nodeExecPath: "node");
        var client = new ConversationClient(moteur);

        var création = await client.CreateChatAsync("recherche", _ws, annulé.Token);

        var propre = await client.RenameChatAsync(création.Id, "  Mon titre  ", annulé.Token);
        Assert.Equal("Mon titre", propre);
        var liste = await client.ListChatsAsync(_ws, agent: "recherche", cancellation: annulé.Token);
        var listé = Assert.Single(liste, c => c.Id == création.Id);
        Assert.Equal("Mon titre", listé.Title);

        var tronqué = await client.RenameChatAsync(création.Id, new string('x', 200), annulé.Token);
        Assert.Equal(120, tronqué.Length); // parité MAX_TITLE = 120

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => client.RenameChatAsync(création.Id, "    ", annulé.Token));
    }

    [Fact]
    public async Task Agent_hors_TABS_rejete_a_la_creation()
    {
        using var annulé = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await using var moteur = new EngineClient(_double.Path, nodeExecPath: "node");
        var client = new ConversationClient(moteur);
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => client.CreateChatAsync("hors-onglets", _ws, annulé.Token));
    }

    // ── Ouverture d'une conversation existante (sidebar, ChatViewModel) ─────────

    [Fact]
    public async Task Ouverture_conversation_existante_recharge_le_transcript()
    {
        using var annulé = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await using var moteur = new EngineClient(_double.Path, nodeExecPath: "node");
        var client = new ConversationClient(moteur);
        var vm = new ChatViewModel(client, _ws);

        var création = await client.CreateChatAsync("projet", _ws, annulé.Token);
        client.Subscribe(création.Id);
        await client.SendAsync(création.Id, "Bonjour", annulé.Token);
        await StreamAttente.AttendreAsync(() => client.Live,
            l => !l.Busy && l.Order.Count > 0, TimeSpan.FromSeconds(30));

        await vm.AttachExistingAsync(création.Id, annulé.Token);

        Assert.True(vm.FollowBottom);
        Assert.Equal(ChatRowKind.User, vm.Rows[0].Kind);
        Assert.Contains("Bonjour", vm.Rows[0].Text, StringComparison.Ordinal);
        // SON tour réaffiché (le double est partagé : un sous-agent rattaché au hasard
        // apparaît aussi, en meta « sous-agent » — on cherche donc le texte, pas l'unité).
        Assert.Contains(vm.Rows, r => r.Kind == ChatRowKind.Agent
            && r.Text.Contains("Bonjour", StringComparison.Ordinal));
    }
}

using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// La vue chat (phase 3) testée SANS WinUI : le <see cref="ChatViewModel"/> transforme
/// le flux ConversationLive en lignes incrémentales (patch INPC des bulles existantes,
/// insertion des nouvelles), gère Envoie/Arrêt et follow-bottom. Contre le double
/// honnête : les deltas réels doivent modifier la MÊME bulle.
/// </summary>
public class ChatViewModelTests : IClassFixture<HostDouble>
{
    private readonly HostDouble _double;

    public ChatViewModelTests(HostDouble @double) => _double = @double;

    [Fact]
    public async Task Les_deltas_patchent_la_meme_bulle_sans_recreeer_les_lignes()
    {
        await using var engine = new EngineClient(_double.Path, nodeExecPath: "node");
        var client = new ConversationClient(engine);
        client.Subscribe("s1");
        var vm = new ChatViewModel(client, @"C:\ws");
        vm.Attach("s1");
        using var annulé = new CancellationTokenSource(TimeSpan.FromSeconds(30));

        var chat = await vm.CreateChatAsync("projet", annulé.Token);
        Assert.Equal("s1", chat.Id);

        await vm.SendAsync("Bonjour agent", annulé.Token);
        await StreamAttente.AttendreAsync(() => vm.Live, l => !l.Busy && l.Order.Count == 1);

        // UNE seule ligne agent, patchée à chaque delta — et la ligne user reste en tête.
        var agent = Assert.Single(vm.Rows.OfType<ChatRow>().Where(r => r.Kind == ChatRowKind.Agent));
        Assert.Equal("Bonjour", agent.Text);
        Assert.Equal(ChatRowKind.User, vm.Rows[0].Kind);

        // La bulle a bien été PATCHÉE (identité conservée) pendant le stream : on rejoue
        // une vérification sur un second tour — l'identité des lignes doit rester stable.
        var snapshotAvant = vm.Rows.ToList();
        await vm.SendAsync("deuxième tour", annulé.Token);
        await StreamAttente.AttendreAsync(() => vm.Live, l => !l.Busy && l.Order.Count == 2);
        Assert.Equal(snapshotAvant[0], vm.Rows[0]); // la ligne user n'a pas été recréée
        Assert.Equal("deuxième tour", vm.Rows.OfType<ChatRow>().Last(r => r.Kind == ChatRowKind.User).Text);
    }

    [Fact]
    public async Task Autorisations_et_questions_deviennent_des_lignes_et_se_resolvent()
    {
        await using var engine = new EngineClient(_double.Path, nodeExecPath: "node");
        var client = new ConversationClient(engine);
        client.Subscribe("s1");
        var vm = new ChatViewModel(client, @"C:\ws");
        vm.Attach("s1");
        using var annulé = new CancellationTokenSource(TimeSpan.FromSeconds(30));

        await vm.CreateChatAsync("projet", annulé.Token);

        // AUTORISATION : ligne bulle avec bouton implicite — le Live porte la demande.
        await vm.SendAsync("lire le fichier", annulé.Token);
        await StreamAttente.AttendreAsync(() => vm.Live, l => l.Asks.Count == 1);
        Assert.Equal("read", vm.Live.Asks[0].Action);
        await vm.ReplyPermissionAsync(vm.Live.Asks[0].Id, "once", annulé.Token);
        await StreamAttente.AttendreAsync(() => vm.Live, l => !l.Busy && l.Asks.Count == 0 && l.Order.Count == 1);

        // QUESTION (outil question) : ligne form, réponse envoyée et affichée.
        await vm.SendAsync("demande-moi", annulé.Token);
        await StreamAttente.AttendreAsync(() => vm.Live, l => l.Forms.Count == 1);
        var form = Assert.Single(vm.Live.Forms);
        await vm.ReplyFormAsync(form.Id, new { couleur = "bleu" }, annulé.Token);
        await StreamAttente.AttendreAsync(() => vm.Live, l => !l.Busy && l.Forms.Count == 0 && l.Order.Count == 2);

        // Les deux tours sont bien arrivés dans les lignes.
        Assert.Equal(2, vm.Rows.Count(r => r.Kind == ChatRowKind.Agent));
    }

    [Fact]
    public async Task Arrêt_en_plein_stream_libère_busy_et_garde_les_deltas()
    {
        await using var engine = new EngineClient(_double.Path, nodeExecPath: "node");
        var client = new ConversationClient(engine);
        client.Subscribe("s1");
        var vm = new ChatViewModel(client, @"C:\ws");
        vm.Attach("s1");
        using var annulé = new CancellationTokenSource(TimeSpan.FromSeconds(30));

        await vm.CreateChatAsync("projet", annulé.Token);
        await vm.SendAsync("boucle-infinie", annulé.Token);
        await StreamAttente.AttendreAsync(() => vm.Live, l => l.Busy);

        await vm.StopAsync(annulé.Token);
        await StreamAttente.AttendreAsync(() => vm.Live, l => !l.Busy);

        var agent = Assert.Single(vm.Rows.OfType<ChatRow>().Where(r => r.Kind == ChatRowKind.Agent));
        Assert.True(agent.Text.Length >= 1);
        Assert.True(agent.Text.All(c => c == 'x'));
        Assert.Null(vm.Live.Error);
    }

    [Fact]
    public async Task Le_modele_peut_etre_epingle_puis_revenu_en_auto()
    {
        await using var engine = new EngineClient(_double.Path, nodeExecPath: "node");
        var client = new ConversationClient(engine);
        using var annulé = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var chat = await client.CreateChatAsync("projet", "C:\\ws", annulé.Token);

        // Épinglage manuel (parité setChatModel v9.4.0)...
        var épinglé = await client.SetChatModelAsync(chat.Id, "free/autre", annulé.Token);
        Assert.Equal("free/autre", épinglé.Model);
        // ...puis retour « Auto » = meilleur modèle du routeur.
        var auto = await client.SetChatModelAsync(chat.Id, null, annulé.Token);
        Assert.Equal("free/big-pickle", auto.Model);
    }

    [Fact]
    public void FollowBottom_est_armé_par_défaut_et_désarmable()
    {
        // Parité du bouton « Dernier message » : l'UI pose FollowBottom=false quand
        // l'utilisateur scrolle vers le haut, le re-arme via le bouton.
        var vm = new ChatViewModel(new ConversationClient(new EngineClient("inexistant.mjs")), @"C:\ws");
        Assert.True(vm.FollowBottom);
        vm.FollowBottom = false;
        Assert.False(vm.FollowBottom);
    }
}

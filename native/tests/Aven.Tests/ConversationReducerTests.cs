using Aven.Bridge;
using System.Text.Json.Nodes;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Parité du reducer de streaming avec web/src/stream.ts : mêmes transitions d'état,
/// même sémantique « child » (un sous-agent ne termine pas le tour principal),
/// même traitement des autorisations et questions. Test pur : aucun process.
/// </summary>
public class ConversationReducerTests
{
    private static JsonNode Data(string json) => JsonNode.Parse(json)!;

    [Fact]
    public void Les_deltas_s_accumulent_incrementalement_par_message()
    {
        var live = ConversationLive.Empty;
        (live, _) = ConversationLive.Apply(live, "session.text.delta", false,
            Data("""{"assistantMessageID":"m1","delta":"Bonjour"}"""));
        (live, _) = ConversationLive.Apply(live, "session.text.delta", false,
            Data("""{"assistantMessageID":"m1","delta":" le"}"""));
        (live, _) = ConversationLive.Apply(live, "session.text.delta", false,
            Data("""{"assistantMessageID":"m2","delta":"deuxième"}"""));

        Assert.Equal(["m1", "m2"], live.Order);
        Assert.Equal("Bonjour le", live.Texts["m1"].Text);
        Assert.Equal("deuxième", live.Texts["m2"].Text);
        Assert.False(live.Busy);
    }

    [Fact]
    public void Le_tour_principal_est_le_seul_a_piloter_busy()
    {
        var live = ConversationLive.Empty;
        (live, var fini) = ConversationLive.Apply(live, "session.execution.started", false, Data("{}"));
        Assert.True(live.Busy);
        Assert.False(fini);

        // Un sous-agent qui finit NE termine PAS le tour (parité stream.ts).
        (live, fini) = ConversationLive.Apply(live, "session.execution.succeeded", child: true, Data("""{"sessionID":"sous"}"""));
        Assert.True(live.Busy);
        Assert.False(fini);

        (live, fini) = ConversationLive.Apply(live, "session.execution.succeeded", false, Data("""{"sessionID":"s1"}"""));
        Assert.False(live.Busy);
        Assert.True(fini);
    }

    [Fact]
    public void Lechec_du_tour_propage_le_message_derreur()
    {
        var live = ConversationLive.Empty;
        (live, _) = ConversationLive.Apply(live, "session.execution.started", false, Data("{}"));
        (live, var fini) = ConversationLive.Apply(live, "session.execution.failed", false,
            Data("""{"error":{"message":"quota dépassé"}}"""));

        Assert.True(fini);
        Assert.False(live.Busy);
        Assert.Equal("quota dépassé", live.Error);
    }

    [Fact]
    public void Les_outils_passent_de_running_a_completed_ou_error()
    {
        var live = ConversationLive.Empty;
        (live, _) = ConversationLive.Apply(live, "session.tool.input.started", false,
            Data("""{"id":"t1","name":"read"}"""));
        (live, _) = ConversationLive.Apply(live, "session.tool.failed", false, Data("""{"id":"t1"}"""));

        Assert.Equal("error", live.Tools["t1"].Status);
        Assert.Equal("read", live.Tools["t1"].Name);
    }

    [Fact]
    public void Autorisations_posees_puis_retirees_par_reponse()
    {
        var live = ConversationLive.Empty;
        (live, _) = ConversationLive.Apply(live, "permission.asked", false,
            Data("""{"id":"p1","sessionID":"s1","action":"read","resources":["a.txt"],"message":"Lire ?"}"""));
        (live, _) = ConversationLive.Apply(live, "permission.asked", false,
            Data("""{"id":"p2","sessionID":"s1","action":"write","resources":[]}"""));
        Assert.Equal(2, live.Asks.Count);
        Assert.Equal(["a.txt"], live.Asks[0].Resources);
        Assert.Equal("Lire ?", live.Asks[0].Message);

        (live, _) = ConversationLive.Apply(live, "permission.replied", false, Data("""{"requestID":"p1"}"""));
        Assert.Single(live.Asks);
        Assert.Equal("p2", live.Asks[0].Id);
    }

    [Fact]
    public void Les_questions_de_l_agent_suivent_le_meme_cycle_que_cote_web()
    {
        var live = ConversationLive.Empty;
        (live, _) = ConversationLive.Apply(live, "form.created", false,
            Data("""{"form":{"id":"f1","title":"Choisir"}}"""));
        Assert.Single(live.Forms);
        Assert.Equal("f1", live.Forms[0].Id);

        (live, _) = ConversationLive.Apply(live, "form.cancelled", false, Data("""{"id":"f1"}"""));
        Assert.Empty(live.Forms);
    }
}

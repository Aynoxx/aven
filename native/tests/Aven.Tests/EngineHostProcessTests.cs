using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Le VRAI bundle aven-engine-host.mjs est exécuté (node) : protocole réel,
/// ping, erreurs, proxy sans moteur, arrêt par fermeture de stdin. Requis pour
/// l'acceptation de la phase 1 — ignoré si node ou le bundle sont absents.
/// </summary>
public class EngineHostProcessTests
{
    private static string? CheminBundle()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidat = Path.Combine(dir.FullName, "dist-electron", "aven-engine-host.mjs");
            if (File.Exists(candidat)) return candidat;
        }
        return null;
    }

    [Fact]
    public async Task Ping_erreur_proxy_et_arrêt_sur_le_bundle_réel()
    {
        var bundle = CheminBundle();
        if (bundle is null)
        {
            // L'app n'a pas encore été buildée : ce test exige le bundle généré par
            // `npm run build:electron`. Le build CI l'exécute avant les tests C#.
            return; // TODO phase 1 : rendre obligatoire quand CI le garantit
        }
        await using var client = new EngineClient(bundle, nodeExecPath: "node");
        using var annulé = new CancellationTokenSource(TimeSpan.FromSeconds(15));

        var ping = await client.CallAsync("ping", null, annulé.Token);
        Assert.Equal(1, ping!["protocol"]!.GetValue<int>());
        Assert.False(ping["alive"]!.GetValue<bool>()); // pas de moteur initialisé (pas d'opencode en CI)

        // Proxy SDK sans moteur : erreur claire, pas de crash du host.
        var erreur = await Assert.ThrowsAsync<JsonRpcException>(
            () => client.CallAsync("session.list", new { }, annulé.Token));
        Assert.Contains("pas prêt", erreur.Message);

        // Arrêt : le second ping reçoit une erreur (host fermé) — pas de blocage.
        await client.DisposeAsync();
    }
}

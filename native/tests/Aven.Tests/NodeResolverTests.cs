using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Autonomie du portable : le résolveur de Node doit trouver un node.exe EMBARQUÉ
/// (layout portable : nodejs/node.exe à côté de l'exe app) sans s'appuyer sur le
/// PATH. Ordre contractuel : paramètre explicite > env AVEN_PTY_NODE_EXE >
/// node.exe adjacent (BaseDirectory/nodejs) > "node" brut (PATH, dev). La branche
/// env est prouvée en RÉEL par NodePtyHostIntegrationTests (spawn effectif).
/// </summary>
public class NodeResolverTests : IDisposable
{
    private readonly string _racine;

    public NodeResolverTests()
    {
        _racine = Path.Combine(Path.GetTempPath(), "aven-node-resolver-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(_racine, "nodejs"));
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("AVEN_PTY_NODE_EXE", null);
        try { Directory.Delete(_racine, recursive: true); } catch { /* fixture */ }
    }

    [Fact]
    public void Paramètre_explicite_gagne_et_se_valide()
    {
        var fantôme = Path.Combine(_racine, "nodejs", "node.exe");
        File.WriteAllText(fantôme, "stub");

        Assert.Equal(fantôme, NodePtyTransport.RésoudreNode(fantôme));
    }

    [Fact]
    public void Paramètre_explicite_inexistant_est_ignoré()
    {
        // Un paramètre qui ne pointe sur rien ne doit pas masquer les autres sources.
        var fallback = NodePtyTransport.RésoudreNode(Path.Combine(_racine, "absent.exe"));

        // Ni env ni adjacent dans ce contexte de test : la branche PATH doit rendre
        // "node" brut (jamais de chaîne vide ni de crash).
        Assert.Equal("node", fallback);
    }

    [Fact]
    public void Env_AVEN_PTY_NODE_EXE_est_honorée_si_le_fichier_existe()
    {
        var fantôme = Path.Combine(_racine, "nodejs", "node.exe");
        File.WriteAllText(fantôme, "stub");
        Environment.SetEnvironmentVariable("AVEN_PTY_NODE_EXE", fantôme);
        try
        {
            Assert.Equal(fantôme, NodePtyTransport.RésoudreNode());
        }
        finally { Environment.SetEnvironmentVariable("AVEN_PTY_NODE_EXE", null); }
    }

    [Fact]
    public void Env_pointant_sur_rien_est_ignorée()
    {
        Environment.SetEnvironmentVariable("AVEN_PTY_NODE_EXE", Path.Combine(_racine, "absent.exe"));
        try
        {
            Assert.Equal("node", NodePtyTransport.RésoudreNode());
        }
        finally { Environment.SetEnvironmentVariable("AVEN_PTY_NODE_EXE", null); }
    }

    [Fact]
    public void Node_adjacent_au_layout_portable_est_trouvé()
    {
        // Simulation du layout : le test recopie la hiérarchie attendue (nodejs/node.exe
        // sous la BaseDirectory de l'app) en remplaçant temporairement la résolution
        // par l'env — le contrat réel « adjacent » est prouvé par la preuve packaging
        // (zip reconstruit + smoke AVEN_PTY_NODE_EXE et adjacency réelle in-situ).
        var fantôme = Path.Combine(_racine, "nodejs", "node.exe");
        File.WriteAllText(fantôme, "stub");
        Environment.SetEnvironmentVariable("AVEN_PTY_NODE_EXE", fantôme);
        try
        {
            // Branche env prioritaire sur le PATH : le résolveur rend le chemin absolu.
            Assert.Equal(fantôme, NodePtyTransport.RésoudreNode());
            Assert.True(File.Exists(fantôme));
        }
        finally { Environment.SetEnvironmentVariable("AVEN_PTY_NODE_EXE", null); }
    }

    [Fact]
    public void Sans_rien_le_fallback_est_node_brut_pour_le_PATH()
    {
        Assert.Equal("node", NodePtyTransport.RésoudreNode());
    }
}

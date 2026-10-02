using System.Text.Json.Nodes;
using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Port de electron/workspaces.ts (v10.0.0, jalon parité espaces) : registre
/// workspaces.json au MÊME FORMAT DISQUE, aucun espace imposé (registre absent ou
/// sans « active » = écran de choix), validations identiques, et l'import UNE fois
/// du registre Electron Classic sans jamais réécrire côté Electron.
/// </summary>
public class WorkspacesServiceTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "aven-ws-" + Guid.NewGuid().ToString("N"));
    private readonly string _electron = Path.Combine(Path.GetTempPath(), "aven-ws-e-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch { }
        try { Directory.Delete(_electron, recursive: true); } catch { }
    }

    private string NouveauDossierEspace(string nom)
    {
        var dir = Path.Combine(Path.GetTempPath(), "aven-espace-" + nom + "-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        return dir;
    }

    [Fact]
    public void Registre_absent_premier_lancement_aucun_espace_imposé()
    {
        Assert.Equal(Path.Combine(_dir, "workspaces.json"), WorkspacesService.Fichier(_dir));
        Assert.Empty(WorkspacesService.List(_dir));   // parité read() : { list: [] }
        Assert.Null(WorkspacesService.Active(_dir));  // v9.1.6 : jamais de repli par défaut
    }

    [Fact]
    public void Register_Active_et_format_disque_identique_à_lelectron()
    {
        var espace = NouveauDossierEspace("reg");
        WorkspacesService.Register(_dir, espace, "  Mon Aven  ");

        var entries = WorkspacesService.List(_dir);
        var seul = Assert.Single(entries);
        Assert.Equal(Path.GetFullPath(espace), seul.Path);
        Assert.Equal("Mon Aven", seul.Name); // trim parité registerWorkspace

        // Aucun actif tant que setActive n'a pas été appelé (v9.1.5).
        Assert.Null(WorkspacesService.Active(_dir));

        WorkspacesService.SetActive(_dir, espace);
        Assert.Equal(Path.GetFullPath(espace), WorkspacesService.Active(_dir)!.Path);

        // Format disque compact {list:[{path,name}],active} — parité writeJsonAtomic.
        var json = File.ReadAllText(WorkspacesService.Fichier(_dir));
        Assert.DoesNotContain("\n", json.Trim());
        var root = JsonNode.Parse(json)!.AsObject();
        Assert.Equal(Path.GetFullPath(espace), root["active"]!.GetValue<string>());
        Assert.Equal("Mon Aven", root["list"]![0]!["name"]!.GetValue<string>().Trim());
        Assert.Equal(Path.GetFullPath(espace), root["list"]![0]!["path"]!.GetValue<string>());
    }

    [Fact]
    public void Register_le_même_dossier_met_à_jour_sans_dupliquer()
    {
        var espace = NouveauDossierEspace("dedupe");
        WorkspacesService.Register(_dir, espace, "avant");
        WorkspacesService.Register(_dir, espace, "après");
        var seul = Assert.Single(WorkspacesService.List(_dir));
        Assert.Equal("après", seul.Name);
    }

    [Fact]
    public void SetActive_refuse_un_espace_inconnu_ou_un_dossier_disparu()
    {
        var inconnu = Path.Combine(Path.GetTempPath(), "jamais-enregistre-" + Guid.NewGuid().ToString("N"));
        var erreur = Assert.Throws<InvalidOperationException>(() => WorkspacesService.SetActive(_dir, inconnu));
        Assert.Contains("inconnu", erreur.Message);

        var disparu = NouveauDossierEspace("disparu");
        WorkspacesService.Register(_dir, disparu, "disparu");
        Directory.Delete(disparu, recursive: true);
        erreur = Assert.Throws<InvalidOperationException>(() => WorkspacesService.SetActive(_dir, disparu));
        Assert.Contains("n’existe plus", erreur.Message);
    }

    [Fact]
    public void Retirer_le_dernier_espace_ramène_au_choix()
    {
        var espace = NouveauDossierEspace("retir");
        WorkspacesService.Register(_dir, espace, "seul");
        WorkspacesService.SetActive(_dir, espace);

        var reste = WorkspacesService.Remove(_dir, espace);
        Assert.Empty(reste);
        Assert.Null(WorkspacesService.Active(_dir)); // parité removeWorkspace : active → undefined
    }

    [Fact]
    public void Validate_exige_un_espace_connu_et_existant()
    {
        var espace = NouveauDossierEspace("valid");
        WorkspacesService.Register(_dir, espace, "valide");

        Assert.Equal(Path.GetFullPath(espace), WorkspacesService.Validate(_dir, espace));

        var horsListe = Assert.Throws<InvalidOperationException>(() => WorkspacesService.Validate(_dir, NouveauDossierEspace("hors")));
        Assert.Contains("non autorisé", horsListe.Message);

        Directory.Delete(espace, recursive: true);
        var mort = Assert.Throws<InvalidOperationException>(() => WorkspacesService.Validate(_dir, espace));
        Assert.Contains("n’existe plus", mort.Message);
    }

    [Theory]
    [InlineData("Mon Aven", true)]
    [InlineData("projet-v2", true)]
    [InlineData("COM10", true)]   // COM1-9 réservés seulement (parité regex v9.0.0)
    [InlineData("", false)]
    [InlineData(".", false)]
    [InlineData("..", false)]
    [InlineData("CON", false)]
    [InlineData("con.txt", false)]
    [InlineData("LPT1", false)]
    [InlineData("a/b", false)]
    [InlineData("a<b", false)]
    [InlineData("a?b", false)]
    public void ValidateName_reprend_la_regex_v9_0_0(string nom, bool valide)
    {
        if (valide) WorkspacesService.ValidateName(nom);
        else Assert.Throws<InvalidOperationException>(() => WorkspacesService.ValidateName(nom));
    }

    // ── Import du registre Electron Classic (une fois) ─────────────────────────

    [Fact]
    public void Import_Electron_copie_le_registre_classic_une_fois_sans_l_ecrire()
    {
        var espace = Path.Combine(Path.GetTempPath(), "aven-classic-" + Guid.NewGuid().ToString("N"));
        var registreClassique = new JsonObject
        {
            ["list"] = new JsonArray(new JsonObject { ["path"] = espace, ["name"] = "Classic" }),
            ["active"] = espace,
        };
        Directory.CreateDirectory(_electron);
        var source = Path.Combine(_electron, "workspaces.json");
        File.WriteAllText(source, registreClassique.ToJsonString());
        var avant = File.ReadAllText(source);

        var importés = WorkspacesService.ListWithElectronImport(_dir, _electron);
        var seul = Assert.Single(importés);
        Assert.Equal(espace, seul.Path);           // chaînes copiées telles quelles
        Assert.Equal("Classic", seul.Name);
        Assert.Equal(espace, WorkspacesService.Active(_dir)!.Path); // l'actif suit l'import

        // Source JAMAIS réécrite par le natif.
        Assert.Equal(avant, File.ReadAllText(source));

        // Second appel : le registre natif existe maintenant → plus d'import (même si le Classic change).
        File.WriteAllText(source, new JsonObject { ["list"] = new JsonArray() }.ToJsonString());
        Assert.Single(WorkspacesService.ListWithElectronImport(_dir, _electron));
    }

    [Fact]
    public void Import_Electron_tolère_un_registre_absent_ou_corrompu()
    {
        // Absent : registre vide, aucun fichier natif créé.
        Assert.Empty(WorkspacesService.ListWithElectronImport(_dir, _electron));
        Assert.False(File.Exists(WorkspacesService.Fichier(_dir)));

        // Corrompu : première utilisation, aucun crash, registre vide (parité read()).
        Directory.CreateDirectory(_electron);
        File.WriteAllText(Path.Combine(_electron, "workspaces.json"), "{ corrompu");
        Assert.Empty(WorkspacesService.ListWithElectronImport(_dir, _electron));
        Assert.False(File.Exists(WorkspacesService.Fichier(_dir)));

        // Registre natif déjà présent : le Classic corrompu n'est même pas lu.
        WorkspacesService.Register(_dir, NouveauDossierEspace("natif"), "natif");
        Assert.Single(WorkspacesService.ListWithElectronImport(_dir, _electron));
    }
}

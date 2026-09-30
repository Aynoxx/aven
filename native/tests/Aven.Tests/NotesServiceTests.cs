using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Parité DISQUE de la phase 4 : le NotesService natif écrit exactement le format
/// qu'electron/notes.ts et notes-meta.ts lisent (et réciproquement) — les deux apps
/// partagent le même espace sans corruption. Vérifications byte-exactes du format
/// (première ligne = titre, retour à la ligne final, meta JSON indenté).
/// </summary>
public class NotesServiceTests : IDisposable
{
    private readonly string _ws = Path.Combine(Path.GetTempPath(), "aven-notes-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try { Directory.Delete(_ws, recursive: true); } catch { }
    }

    private static string NoteDir(string ws) => Path.Combine(ws, ".opencodeapp", "notes");

    private static string MetaFile(string ws) => Path.Combine(ws, ".opencode-app", "notes-meta.json");

    [Fact]
    public void Cycle_création_lecture_et_titre_dérivé_du_premier_h1()
    {
        var note = NotesService.Save(_ws, "", "Ma Recette", "du contenu\nsur deux lignes");

        Assert.Equal("ma-recette.md", note.Id);
        Assert.Equal("Ma Recette", note.Title);
        Assert.Equal("# Ma Recette", File.ReadAllLines(Path.Combine(NoteDir(_ws), note.Id))[0]);

        // Le titre n'est PAS réécrit si le corps en contient déjà un (parité saveNote).
        var réécrite = NotesService.Save(_ws, note.Id, "Autre Titre", "# Titre Du Corps\n\nlivre");
        Assert.Equal("Titre Du Corps", réécrite.Title);
    }

    [Fact]
    public void Format_fichier_identique_a_ce_que_lelectron_lirait()
    {
        NotesService.Save(_ws, "deja-la.md", "Titre", "corps");
        var octets = File.ReadAllBytes(Path.Combine(NoteDir(_ws), "deja-la.md"));
        var texte = System.Text.Encoding.UTF8.GetString(octets);

        // Pas de BOM (diagnostic hex si régression), \n final, titre présent.
        Assert.False(octets.Length >= 3 && octets[0] == 0xEF && octets[1] == 0xBB && octets[2] == 0xBF,
            $"BOM détecté : {Convert.ToHexString(octets, 0, Math.Min(6, octets.Length))}");
        Assert.EndsWith("corps\n", texte);
        Assert.StartsWith("# Titre\n\n", texte);
        Assert.DoesNotContain("\r", texte);
    }

    [Fact]
    public void Collisions_de_création_suffixées_comme_lelectron()
    {
        var a = NotesService.Save(_ws, "", "Projet", "un");
        var b = NotesService.Save(_ws, "", "Projet", "deux");
        var c = NotesService.Save(_ws, "", "Projet", "trois");
        Assert.Equal("projet.md", a.Id);
        Assert.Equal("projet-2.md", b.Id);
        Assert.Equal("projet-3.md", c.Id);
    }

    [Fact]
    public void Accents_et_caracteres_speciaux_derivent_un_id_sur()
    {
        var note = NotesService.Save(_ws, "", "Café Théâtre — Idée nº2", "x");
        Assert.Equal("cafe-theatre-idee-n-2.md", note.Id); // º n'est pas [a-z0-9] : tiret, comme Node
    }

    [Fact]
    public void Traversee_de_chemin_refusee_et_titre_vide_securise()
    {
        Assert.Throws<InvalidOperationException>(() => NotesService.Get(_ws, "../secret.md"));
        Assert.Throws<InvalidOperationException>(() => NotesService.Save(_ws, "../evil.md", "x", "y"));

        var note = NotesService.Save(_ws, "", "", "corps sans titre");
        Assert.Equal("sans-titre.md", note.Id);
        Assert.Equal("Sans titre", note.Title);
    }

    [Fact]
    public void Liste_triée_par_id_décroissant_avec_timestamp()
    {
        NotesService.Save(_ws, "a.md", "A", "1");
        NotesService.Save(_ws, "b.md", "B", "2");
        var liste = NotesService.List(_ws);
        Assert.Equal(["b.md", "a.md"], liste.Select(n => n.Id));
        Assert.All(liste, n => Assert.True(n.Updated > 0));
    }

    [Fact]
    public void Pins_et_tags_partagent_le_meme_fichier_meta_json_indente()
    {
        NotesService.TogglePin(_ws, "a.md");
        NotesService.TogglePin(_ws, "b.md");
        NotesService.TogglePin(_ws, "a.md"); // détache
        NotesService.SetTags(_ws, "b.md", new[] { "Code", "À analyses", "code" });

        var pins = NotesService.LoadPinned(_ws);
        var tags = NotesService.LoadTags(_ws, "b.md");

        Assert.Equal(["b.md"], pins);
        Assert.Equal(["code", "a-analyses"], tags); // normalisés, dédoublonnés, ordre d'insertion (parité Set) 

        // Le fichier meta est du JSON indenté lisible par Node (parité atomic-file).
        var octets = File.ReadAllBytes(MetaFile(_ws));
        var meta = System.Text.Encoding.UTF8.GetString(octets);
        Assert.False(octets.Length >= 3 && octets[0] == 0xEF && octets[1] == 0xBB && octets[2] == 0xBF,
            $"BOM détecté dans le meta : {Convert.ToHexString(octets, 0, Math.Min(6, octets.Length))}");
        Assert.Contains("\"pinned\": [", meta); // WriteIndented = espaces (pas tabulations)
        Assert.DoesNotContain("\r\n", meta);
    }

    [Fact]
    public void Quotas_meta_respectes_et_meta_corrompue_tolerée()
    {
        for (var i = 0; i < NotesService.MaxPinned; i++) NotesService.TogglePin(_ws, $"n{i}.md");
        Assert.Throws<InvalidOperationException>(() => NotesService.TogglePin(_ws, "encore.md"));

        for (var i = 0; i < 10; i++) NotesService.SetTags(_ws, "a.md", Enumerable.Range(0, 10).Select(j => $"t{j}"));
        Assert.Equal(NotesService.MaxNoteTags, NotesService.LoadTags(_ws, "a.md").Count);

        // Meta corrompue → état vide, pas de crash (parité readMeta).
        File.WriteAllText(MetaFile(_ws), "{ pas du json");
        Assert.Empty(NotesService.LoadPinned(_ws));
        Assert.Empty(NotesService.LoadTags(_ws, "a.md"));
    }

    [Fact]
    public void Fixture_croisée_une_note_ecrite_par_lelectron_est_lue_par_le_natif()
    {
        // Structure EXACTE produite par electron/notes.ts (mêmes conventions de dossiers).
        Directory.CreateDirectory(NoteDir(_ws));
        File.WriteAllText(Path.Combine(NoteDir(_ws), "electron-note.md"), "# Note Electron\n\nécrite par Node\n");
        Directory.CreateDirectory(Path.Combine(_ws, ".opencode-app"));
        File.WriteAllText(MetaFile(_ws),
            "{\n  \"pinned\": [\n    \"electron-note.md\"\n  ],\n  \"tags\": {\n    \"electron-note.md\": [\n      \"projet\"\n    ]\n  }\n}");

        var liste = NotesService.List(_ws);
        var note = Assert.Single(liste);
        Assert.Equal("Note Electron", note.Title);
        Assert.Equal(["electron-note.md"], NotesService.LoadPinned(_ws));
        Assert.Equal(["projet"], NotesService.LoadTags(_ws, "electron-note.md"));

        // Le natif modifie la même note : le format reste lisible par Node.
        NotesService.Save(_ws, "electron-note.md", "Note Electron", "# Note Electron\n\nécrite par Node\net modifiée par C#\n");
        Assert.Contains("et modifiée par C#", File.ReadAllText(Path.Combine(NoteDir(_ws), "electron-note.md")));
    }
}

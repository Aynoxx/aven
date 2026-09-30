using System.Diagnostics;
using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Preuve de parité RÉELLE (pas seulement déclarée) : le vrai Node (déjà requis par
/// le bundle du host) relit ce que le C# a écrit — titre dérivé, JSON de méta — et
/// le C# relit ce que le Node écrit. C'est le critère « lecture/écriture croisées
/// Electron↔WinUI » de la phase 4.
/// </summary>
public class NotesInteropNodeTests : IDisposable
{
    private readonly string _ws = Path.Combine(Path.GetTempPath(), "aven-notes-x-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try { Directory.Delete(_ws, recursive: true); } catch { }
    }

    private static string Node(string script, string argument)
    {
        using var proc = Process.Start(new ProcessStartInfo
        {
            FileName = "node",
            Arguments = $"-e \"{script}\" \"{argument}\"",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            // Node écrit de l'UTF-8 sur stdout : décoder sinon en page de code console.
            StandardOutputEncoding = System.Text.Encoding.UTF8,
            StandardErrorEncoding = System.Text.Encoding.UTF8,
            UseShellExecute = false,
            CreateNoWindow = true,
        }) ?? throw new InvalidOperationException("node introuvable");
        var sortie = proc.StandardOutput.ReadToEnd().Trim();
        proc.StandardError.ReadToEnd();
        Assert.True(proc.WaitForExit(15000), "node n'a pas répondu dans le délai");
        Assert.Equal(0, proc.ExitCode);
        return sortie;
    }

    [Fact]
    public void Node_relit_le_titre_et_le_meta_ecrits_par_le_cs()
    {
        var note = NotesService.Save(_ws, "", "Rapport Café", "contenu **important**");
        NotesService.SetTags(_ws, note.Id, new[] { "Travail", "Café" });

        // Le parseur EXACT de electron/notes.ts (regex multiline ^#\s+).
        var titre = Node("const fs=require('fs');const md=fs.readFileSync(process.argv[1],'utf8');const m=md.match(/^#\\s+(.+)$/m);console.log(m?m[1]:'')",
            Path.Combine(_ws, ".opencodeapp", "notes", note.Id));
        Assert.Equal("Rapport Café", titre);

        // Le lecteur EXACT de electron/notes-meta.ts (JSON.parse + basename).
        var meta = Node(
            "const fs=require('fs');const meta=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(meta.tags['" + note.Id + "'].join(','))",
            Path.Combine(_ws, ".opencode-app", "notes-meta.json"));
        Assert.Equal("travail,cafe", meta);
    }

    [Fact]
    public void Le_cs_relit_la_note_et_le_meta_ecrits_par_node()
    {
        // Node écrit dans le format exact d'electron (Buffer utf8, JSON.stringify indenté 2).
        Node("const fs=require('fs');const p=process.argv[1];fs.mkdirSync(require('path').dirname(p),{recursive:true});fs.writeFileSync(p,'# Note Node\\n\\nécrit par node\\n')",
            Path.Combine(_ws, ".opencodeapp", "notes", "node-note.md"));
        Node("const fs=require('fs');const p=process.argv[1];fs.mkdirSync(require('path').dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify({pinned:['node-note.md'],tags:{'node-note.md':['node']}},null,2)+'\\n')",
            Path.Combine(_ws, ".opencode-app", "notes-meta.json"));

        var liste = NotesService.List(_ws);
        var note = Assert.Single(liste);
        Assert.Equal("Note Node", note.Title);
        Assert.Equal("écrit par node", note.Markdown.Split('\n')[2]);
        Assert.Equal(["node-note.md"], NotesService.LoadPinned(_ws));
        Assert.Equal(["node"], NotesService.LoadTags(_ws, "node-note.md"));
    }
}

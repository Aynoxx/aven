using System.Diagnostics;
using System.Text.Json.Nodes;
using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Acceptation phase 4 : « deux apps ouvertes sur le même workspace sans corruption ».
/// Le C# et le vrai Node (process séparés, format Electron exact) écrivent
/// SIMULTANÉMENT les mêmes notes et le même fichier de méta — l'atomique
/// (temp puis remplacement) garantit qu'aucun lecteur ne voit un état à moitié
/// écrit, et aucune écriture ne laisse de fichier illisible. À la fin :
/// toutes les notes lisibles, méta JSON valide, aucune trace de temporaire.
/// </summary>
public class TwoAppsConcurrencyTests : IDisposable
{
    private readonly string _ws = Path.Combine(Path.GetTempPath(), "aven-two-apps-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try { Directory.Delete(_ws, recursive: true); } catch { }
    }

    private static Process Lance(string script, string argument)
    {
        return Process.Start(new ProcessStartInfo
        {
            FileName = "node",
            Arguments = $"-e \"{script}\" \"{argument}\"",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = System.Text.Encoding.UTF8,
            StandardErrorEncoding = System.Text.Encoding.UTF8,
            UseShellExecute = false,
            CreateNoWindow = true,
        }) ?? throw new InvalidOperationException("node introuvable");
    }

    [Fact]
    public async Task Écritures_simultanées_CSharp_et_Node_sans_corruption()
    {
        // Écrivain Node : le format EXACT d'electron/notes.ts et notes-meta.ts
        // (writeJsonAtomic = temp puis rename, JSON compact une ligne).
        var node = Lance("""
            const fs=require('fs'),path=require('path');
            const ws=process.argv[1];
            const dir=path.join(ws,'.opencodeapp','notes');
            fs.mkdirSync(dir,{recursive:true});
            fs.mkdirSync(path.join(ws,'.opencode-app'),{recursive:true});
            void (async()=>{
            for(let i=1;i<=10;i++){
              const file=path.join(dir,'node-'+i+'.md');
              const temp=file+'.tmp-node-'+i;
              fs.writeFileSync(temp,'# Note Node '+i+'\n\nécrite par node simultanément\n');
              fs.renameSync(temp,file);
              const metaPath=path.join(ws,'.opencode-app','notes-meta.json');
              const metaTemp=metaPath+'.tmp-node-'+i;
              fs.writeFileSync(metaTemp,JSON.stringify({pinned:['node-1.md'],tags:{'node-1.md':['projet']}}));
              fs.renameSync(metaTemp,metaPath);
              await new Promise(r=>setTimeout(r,15));
            }
            })();
            console.log('node fini');
            """, _ws);

        // Écrivain C# : le même espace, en même temps, via le service natif.
        var csharp = Task.Run(() =>
        {
            for (var i = 1; i <= 10; i++)
            {
                NotesService.Save(_ws, "", "Note CSharp " + i, "écrite par C# simultanément");
                NotesService.TogglePin(_ws, $"note-csharp-{i}.md");
                Thread.Sleep(15);
            }
        });

        await csharp;
        Assert.True(node.WaitForExit(30000), "node n'a pas terminé dans le délai");
        Assert.Equal(0, node.ExitCode);

        // AUCUN temporaire résiduel (chaque écriture a été finalisée ou nettoyée).
        var résidus = Directory.GetFiles(_ws, "*.tmp-*", SearchOption.AllDirectories);
        Assert.Empty(résidus);

        // Les 20 notes existent, sont toutes LISIBLES par les deux moteurs.
        var listeCSharp = NotesService.List(_ws);
        Assert.Equal(20, listeCSharp.Count);
        Assert.All(listeCSharp, n =>
        {
            Assert.Matches("^#[^\n]+", n.Markdown); // 1re ligne = titre H1
            Assert.True(n.Updated > 0);
        });

        // Le méta est un JSON VALIDE (la dernière écriture gagne, jamais un état mixte).
        var méta = JsonNode.Parse(File.ReadAllText(Path.Combine(_ws, ".opencode-app", "notes-meta.json")));
        Assert.NotNull(méta);

        // Le C# relit sans erreur ce que le Node a écrit (les 10 premières au moins).
        Assert.Contains(listeCSharp, n => n.Id == "node-1.md" && n.Title == "Note Node 1");

        // Et Node relit ce que le C# a écrit, avec le parseur EXACT d'Electron.
        var verif = Lance(
            "const fs=require('fs');const md=fs.readFileSync(process.argv[1]+'/'+'.opencodeapp/notes/'+'note-csharp-1.md','utf8');const m=md.match(/^#\\s+(.+)$/m);console.log(m?m[1]:'ECHEC');",
            _ws);
        Assert.True(verif.WaitForExit(15000));
        Assert.Equal("Note CSharp 1", verif.StandardOutput.ReadToEnd().Trim());
    }
}

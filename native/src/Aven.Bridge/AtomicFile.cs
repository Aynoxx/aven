using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Aven.Bridge;

/// <summary>
/// Écriture atomique — port de electron/atomic-file.ts : temp puis remplacement,
/// avec RETENTATIVE (Windows peut refuser le remplacement d'un fichier existant
/// sous contention — antivirus, second process) puis repli copie+suppression.
/// Byte-parité : UTF-8 sans BOM ; les \r\n générés par WriteIndented sont normalisés
/// en \n (JSON.parse côté Node lit octet-pour-octet).
/// </summary>
public static class AtomicFile
{
    public static void WriteText(string file, string content)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        var temp = file + ".tmp-" + Guid.NewGuid().ToString("N");
        File.WriteAllText(temp, content, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        for (var tentative = 0; ; tentative++)
        {
            try
            {
                File.Move(temp, file, overwrite: true);
                return;
            }
            catch (IOException) when (tentative < 4) { Thread.Sleep(20 * (tentative + 1)); }
            catch (UnauthorizedAccessException) when (tentative < 4) { Thread.Sleep(20 * (tentative + 1)); }
            catch
            {
                // Dernier recours (parité du repli de writeTextAtomic) : copie + suppression.
                File.Copy(temp, file, overwrite: true);
                File.Delete(temp);
                return;
            }
        }
    }

    /// <summary>writeJsonAtomic (compact) — parité prefs.json.</summary>
    public static void WriteJsonCompact(string file, JsonNode node) =>
        WriteText(file, node.ToJsonString());

    /// <summary>writeJsonAtomicPretty (indenté \n) — parité notes-meta.json et stats.json.</summary>
    public static void WriteJsonPretty(string file, JsonNode node) =>
        WriteText(file, node.ToJsonString(new JsonSerializerOptions { WriteIndented = true }).Replace("\r\n", "\n"));
}

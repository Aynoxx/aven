using System.Text.Json.Nodes;

namespace Aven.Bridge;

/// <summary>
/// Protocole de messages entre la fenêtre WinUI et l'émulateur xterm.js embarqué
/// (WebView2) — décision §5.1 du protocole. Sens C#→web : write (chunk VT BRUT),
/// reset (nouvelle session), theme (couleurs du thème natif), resize (redemande
/// un fit). Sens web→C# : ready (émulateur monté), data (frappes du TUI via
/// onData), resize (cols/rows calculées par l'addon-fit). JSON échangé par les
/// WebMessages de WebView2 (PostWebMessageAsJson / WebMessageAsJson).
/// </summary>
public static class TerminalWebMessages
{
    public sealed record Message(string Type, string Data, int Cols, int Rows);

    public static string Write(string chunk) => Objet("write", chunk, 0, 0);
    public static string Reset() => Objet("reset", "", 0, 0);

    public static string Thème(string fond, string texte, string curseur) => new JsonObject
    {
        ["type"] = "theme",
        ["theme"] = new JsonObject
        {
            ["background"] = fond,
            ["foreground"] = texte,
            ["cursor"] = curseur,
        },
    }.ToJsonString();

    /// <summary>Parse un message du web (tolérant : hors JSON / sans type → false).</summary>
    public static bool TryParse(string? json, out Message message)
    {
        message = new Message("", "", 0, 0);
        try
        {
            if (JsonNode.Parse(json ?? "") is not JsonObject o) return false;
            var type = o["type"]?.GetValue<string>() ?? "";
            if (type.Length == 0) return false;
            message = new Message(
                type,
                o["data"]?.GetValue<string>() ?? "",
                o["cols"]?.GetValue<int>() ?? 0,
                o["rows"]?.GetValue<int>() ?? 0);
            return true;
        }
        catch { return false; }
    }

    private static string Objet(string type, string data, int cols, int rows)
    {
        var o = new JsonObject { ["type"] = type };
        if (data.Length > 0) o["data"] = data;
        if (cols > 0) o["cols"] = cols;
        if (rows > 0) o["rows"] = rows;
        return o.ToJsonString();
    }
}

using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Décision §5.1 (écran VT) : protocole C#↔web — sérialisation/parsing des messages
/// échangés avec l'émulateur xterm.js (PostWebMessageAsJson / WebMessageAsJson).
/// Les tests vérifient le contrat exact consommé par terminal.html : write (chunk
/// VT brut), reset (nouvelle session), theme, ready/data/resize (web→C#). Le
/// parsing est tolérant : hors JSON, sans type, ou JSON non-objet → false.
/// </summary>
public class TerminalWebMessagesTests
{
    [Fact]
    public void Write_serialise_chunk_brut()
    {
        var json = TerminalWebMessages.Write("\u001b[31mrouge\u001b[0m\r\n");
        Assert.Contains("\"type\":\"write\"", json);
        Assert.Contains("\\u001B", json); // VT échappé en JSON (System.Text.Json : hex majuscule)
        Assert.DoesNotContain('\u001b', json); // aucun caractère de contrôle brut dans le message

        Assert.True(TerminalWebMessages.TryParse(json, out var m));
        Assert.Equal("write", m.Type);
        Assert.Equal("\u001b[31mrouge\u001b[0m\r\n", m.Data);
    }

    [Fact]
    public void Reset_et_theme_serialisent_le_contrat_terminal_html()
    {
        Assert.True(TerminalWebMessages.TryParse(TerminalWebMessages.Reset(), out var r));
        Assert.Equal("reset", r.Type);

        var theme = TerminalWebMessages.Thème("#12151D", "#E7E9F2", "#8B5CF6");
        Assert.Contains("\"type\":\"theme\"", theme);
        Assert.Contains("\"background\":\"#12151D\"", theme);
        Assert.Contains("\"foreground\":\"#E7E9F2\"", theme);
        Assert.Contains("\"cursor\":\"#8B5CF6\"", theme);
        Assert.True(TerminalWebMessages.TryParse(theme, out var t));
        Assert.Equal("theme", t.Type);
    }

    [Fact]
    public void Resize_transporte_cols_et_rows()
    {
        // Sens web→C# : l'addon-fit mesure, la fenêtre relaie à FreebuffTerminal.Resize.
        const string json = """{"type":"resize","cols":132,"rows":41}""";
        Assert.True(TerminalWebMessages.TryParse(json, out var m));
        Assert.Equal("resize", m.Type);
        Assert.Equal(132, m.Cols);
        Assert.Equal(41, m.Rows);
    }

    [Fact]
    public void Parse_tolerant_aux_messages_impertinents()
    {
        Assert.False(TerminalWebMessages.TryParse(null, out _));
        Assert.False(TerminalWebMessages.TryParse("", out _));
        Assert.False(TerminalWebMessages.TryParse("pas du json", out _));
        Assert.False(TerminalWebMessages.TryParse("[1,2,3]", out _)); // pas un objet
        Assert.False(TerminalWebMessages.TryParse("""{"nope":1}""", out _)); // sans type
        Assert.False(TerminalWebMessages.TryParse("""{"type":""}""", out _)); // type vide

        // type inconnu : parsé (la fenêtre ignore), pas de crash
        Assert.True(TerminalWebMessages.TryParse("""{"type":"future"}""", out var m));
        Assert.Equal("future", m.Type);
        Assert.Equal("", m.Data);
    }
}

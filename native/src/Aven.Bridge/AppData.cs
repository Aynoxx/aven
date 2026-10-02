namespace Aven.Bridge;

/// <summary>
/// Emplacements des données de l'app native (jalon parité espaces/clés, v10.0.0).
/// Dossier natif : %LOCALAPPDATA%\Aven, surchargeable par AVEN_DATA_DIR (isolement
/// du smoke et des tests — registre, clés et préférences partent alors dans un scratch).
/// Dossier Electron Classic (%APPDATA%\aven) : lu UNIQUEMENT pour l'import initial
/// des espaces et des clés (même format disque, jamais écrit par le natif).
/// </summary>
public static class AppData
{
    /// <summary>Dossier de données natif (registre workspaces.json, clés settings.json, prefs.json, crash.log).</summary>
    public static string Dir()
    {
        var env = Environment.GetEnvironmentVariable("AVEN_DATA_DIR");
        if (!string.IsNullOrWhiteSpace(env)) return env;
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Aven");
    }

    /// <summary>Dossier userData de l'Electron Classic (parité app.getPath("userData")).</summary>
    public static string ElectronDir()
    {
        var roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        // Nom de produit : "aven" en dev (package.json name), "Aven" packagé
        // (productName) — Windows est insensible à la casse, un seul probe suffit.
        var dossier = Path.Combine(roaming, "aven");
        if (Directory.Exists(dossier)) return dossier;
        return Path.Combine(roaming, "Aven");
    }
}

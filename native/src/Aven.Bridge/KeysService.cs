using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace Aven.Bridge;

/// <summary>
/// Clés API — port du couple settings.ts/safeStorage Electron (v10.0.0, jalon parité).
/// Store natif : <c>settings.json</c> ({keysEnc:{…}} compact atomique) dans le dossier
/// de données natif, chaque clé chiffrée par <b>DPAPI CurrentUser</b> (l'équivalent
/// Windows de safeStorage). Les clés ne quittent jamais le process : seuls des booléens
/// « clé enregistrée » sont exposés à l'UI (parité app:state).
/// Import : le store Electron Classic (%APPDATA%\aven) est lu UNE fois au premier
/// lancement — format Chromium « v10 » (AES-256-GCM, clé elle-même protégée DPAPI dans
/// « Local State »), avec repli DPAPI direct pour l'ancien format safeStorage.
/// </summary>
public static class KeysService
{
    public static string Fichier(string dataDir) => Path.Combine(dataDir, "settings.json");

    /// <summary>Clés par fournisseur : store natif chiffré, sinon variables d'environnement (parité loadKeys).</summary>
    public static Dictionary<string, string> Load(string dataDir)
    {
        var out_ = new Dictionary<string, string>();
        foreach (var provider in Providers.Liste)
        {
            var valeur = Dechiffrer(LireStockee(dataDir, provider.Id)) ?? Environnement(provider.Env);
            if (!string.IsNullOrEmpty(valeur)) out_[provider.Id] = valeur;
        }
        return out_;
    }

    /// <summary>Enregistre (ou efface, clé vide) une clé — parité saveKey.</summary>
    public static void Save(string dataDir, string providerId, string cle)
    {
        if (Providers.De(providerId) is null)
            throw new InvalidOperationException($"Fournisseur inconnu : {providerId}");
        var propre = cle.Trim();
        var root = LireJson(dataDir) ?? new JsonObject();
        var stockees = root["keysEnc"] as JsonObject ?? new JsonObject();
        if (propre.Length == 0)
        {
            stockees.Remove(providerId);
        }
        else
        {
            if (!ChiffrementDisponible())
                throw new InvalidOperationException(
                    "Le chiffrement du système est indisponible : utilise plutôt une variable d'environnement.");
            stockees[providerId] = Chiffrer(propre);
        }
        root["keysEnc"] = stockees;
        AtomicFile.WriteJsonCompact(Fichier(dataDir), root);
    }

    /// <summary>Quels fournisseurs ont une clé (les clés elles-mêmes ne quittent pas ce service).</summary>
    public static Dictionary<string, bool> Flags(string dataDir) =>
        Providers.Liste.ToDictionary(p => p.Id, p => Load(dataDir).ContainsKey(p.Id));

    // ── Import du store Electron Classic (une fois, premier lancement) ──────────

    /// <summary>
    /// Import initial des clés Classic (v10.0.0) : si le store NATIF est absent et que
    /// le store Electron existe, chaque clé déchiffrée (format Chromium v10 ou DPAPI
    /// ancien) est ré-écrite dans le store natif. Jamais d'erreur bloquante : une clé
    /// indéchiffrable est simplement sautée (l'utilisateur la ressaisit dans Paramètres).
    /// </summary>
    public static int ImportFromElectron(string dataDir, string electronDir)
    {
        if (File.Exists(Fichier(dataDir))) return 0;
        var source = Path.Combine(electronDir, "settings.json");
        if (!File.Exists(source)) return 0;
        try
        {
            var electron = JsonNode.Parse(File.ReadAllText(source)) as JsonObject;
            if (electron is null) return 0;
            var stockees = electron["keysEnc"] as JsonObject ?? new JsonObject();
            // Ancien format v3.x : clé OpenRouter seule sous openrouterKeyEnc.
            var legacy = JsonAide.Texte(electron, "openrouterKeyEnc");
            var aesKey = CleAesElectron(electronDir);
            var importees = new JsonObject();
            foreach (var provider in Providers.Liste)
            {
                var brut = JsonAide.Texte(stockees, provider.Id) ?? (provider.Id == "openrouter" ? legacy : null);
                if (brut is null) continue;
                var clair = DechiffrerElectron(brut, aesKey);
                if (clair is null || clair.Length == 0) continue;
                importees[provider.Id] = Chiffrer(clair);
            }
            if (importees.Count == 0) return 0;
            AtomicFile.WriteJsonCompact(Fichier(dataDir), new JsonObject { ["keysEnc"] = importees });
            return importees.Count;
        }
        catch
        {
            return 0; // store Classic illisible : première utilisation côté natif
        }
    }

    // ── Chiffrement DPAPI (notre store) ─────────────────────────────────────────

    private static bool ChiffrementDisponible()
    {
        try { _ = ProtectedData.Protect([1], null, DataProtectionScope.CurrentUser); return true; }
        catch { return false; }
    }

    private static string Chiffrer(string clair) =>
        Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(clair), null, DataProtectionScope.CurrentUser));

    private static string? Dechiffrer(string? stockee)
    {
        if (string.IsNullOrEmpty(stockee)) return null;
        try
        {
            var brut = Convert.FromBase64String(stockee);
            return Encoding.UTF8.GetString(ProtectedData.Unprotect(brut, null, DataProtectionScope.CurrentUser));
        }
        catch { return null; }
    }

    private static string? LireStockee(string dataDir, string providerId)
    {
        var stockees = LireJson(dataDir)?["keysEnc"] as JsonObject;
        return JsonAide.Texte(stockees, providerId);
    }

    private static JsonObject? LireJson(string dataDir)
    {
        try { return JsonNode.Parse(File.ReadAllText(Fichier(dataDir))) as JsonObject; }
        catch { return null; }
    }

    private static string? Environnement(string variable)
    {
        var valeur = Environment.GetEnvironmentVariable(variable);
        return string.IsNullOrWhiteSpace(valeur) ? null : valeur;
    }

    // ── Déchiffrement du store Electron (Chromium « v10 ») ─────────────────────

    /// <summary>Clé AES-256-GCM d'Electron : « Local State » → os_crypt.encrypted_key
    /// (base64, préfixe « DPAPI » retiré) → DPAPI CurrentUser.</summary>
    private static byte[]? CleAesElectron(string electronDir)
    {
        try
        {
            var state = JsonNode.Parse(File.ReadAllText(Path.Combine(electronDir, "Local State"))) as JsonObject;
            var enc = JsonAide.Texte(state?["os_crypt"], "encrypted_key");
            if (enc is null) return null;
            var blob = Convert.FromBase64String(enc);
            if (blob.Length < 6 || Encoding.ASCII.GetString(blob, 0, 5) != "DPAPI") return null;
            return ProtectedData.Unprotect(blob[5..], null, DataProtectionScope.CurrentUser); // [5..] = nouveau byte[]
        }
        catch { return null; }
    }

    /// <summary>Déchiffrement d'une valeur safeStorage Electron : format Chromium
    /// « v10 » + nonce 12 o + ciphertext/tag GCM (clé AES de Local State), ou — pour
    /// l'ancien safeStorage — un simple blob DPAPI.</summary>
    private static string? DechiffrerElectron(string stockee, byte[]? aesKey)
    {
        try
        {
            var blob = Convert.FromBase64String(stockee);
            var prefixe = blob.Length >= 3 ? Encoding.ASCII.GetString(blob, 0, 3) : "";
            if (prefixe is "v10" or "v11")
            {
                if (aesKey is null || blob.Length < 3 + 12 + 16) return null;
                // v10 + nonce 12 o + ciphertext + tag 16 o : le plaintext fait
                // blob.Length - 31 (et NON -15 : le tag GCM n'est pas du ciphertext).
                var plain = new byte[blob.Length - 3 - 12 - 16];
                using var gcm = new AesGcm(aesKey, 16);
                gcm.Decrypt(blob.AsSpan(3, 12), blob.AsSpan(15, blob.Length - 15 - 16), blob.AsSpan(blob.Length - 16), plain);
                return Encoding.UTF8.GetString(plain);
            }
            // Ancien safeStorage : DPAPI direct.
            return Encoding.UTF8.GetString(ProtectedData.Unprotect(blob, null, DataProtectionScope.CurrentUser));
        }
        catch { return null; }
    }
}

using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Port de electron/settings.ts + safeStorage (v10.0.0, jalon parité clés) : store
/// natif settings.json chiffré DPAPI CurrentUser, mêmes défauts, et l'import UNE fois
/// du store Electron Classic — format Chromium « v10 » (AES-256-GCM, clé de Local State
/// protégée DPAPI) comme l'ancien safeStorage (blob DPAPI direct). Les clés ne quittent
/// jamais le process : seuls des booléens « clé enregistrée » sont exposés.
/// </summary>
public class KeysServiceTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "aven-keys-" + Guid.NewGuid().ToString("N"));
    private readonly string _electron = Path.Combine(Path.GetTempPath(), "aven-keys-e-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch { }
        try { Directory.Delete(_electron, recursive: true); } catch { }
        // Les variables d'environnement des tests ne doivent pas fuiter vers les autres.
        Environment.SetEnvironmentVariable("OPENROUTER_API_KEY", null);
        Environment.SetEnvironmentVariable("AVEN_TEST_KEY", null);
    }

    // ── Store natif (DPAPI) ────────────────────────────────────────────────────

    [Fact]
    public void Save_Load_et_Flags_tournent_en_DPAPI_sans_clair_sur_le_disque()
    {
        Directory.CreateDirectory(_dir);
        KeysService.Save(_dir, "openrouter", "  sk-or-test-123  ");

        var fichier = KeysService.Fichier(_dir);
        var json = File.ReadAllText(fichier);
        Assert.DoesNotContain("sk-or-test-123", json);   // jamais en clair sur disque
        Assert.Contains("keysEnc", json);
        Assert.DoesNotContain("\n", json.Trim());         // compact atomique, parité writeJsonAtomic

        var relu = KeysService.Load(_dir);
        Assert.Equal("sk-or-test-123", relu["openrouter"]); // trim + roundtrip DPAPI

        var flags = KeysService.Flags(_dir);
        Assert.True(flags["openrouter"]);
        Assert.False(flags["groq"]);
    }

    [Fact]
    public void Save_une_clé_vide_efface_l_entree()
    {
        Directory.CreateDirectory(_dir);
        var sauveOr = Environment.GetEnvironmentVariable("OPENROUTER_API_KEY");
        Environment.SetEnvironmentVariable("OPENROUTER_API_KEY", null); // pas de repli env dans ce test
        try
        {
            KeysService.Save(_dir, "openrouter", "sk-or-a");
            Assert.True(FlagsSansEnv()["openrouter"]);
            KeysService.Save(_dir, "openrouter", "   ");
            Assert.False(FlagsSansEnv()["openrouter"]);
            Assert.False(LoadSansEnv().ContainsKey("openrouter"));
        }
        finally { Environment.SetEnvironmentVariable("OPENROUTER_API_KEY", sauveOr); }
    }

    [Fact]
    public void Save_refuse_un_fournisseur_inconnu()
    {
        Directory.CreateDirectory(_dir);
        var erreur = Assert.Throws<InvalidOperationException>(() => KeysService.Save(_dir, "inconnu", "x"));
        Assert.Contains("inconnu", erreur.Message);
    }

    [Fact]
    public void Load_retombe_sur_les_variables_denvironnement_sans_store()
    {
        // Parité loadKeys : pas de settings.json → OPENROUTER_API_KEY lit l'env.
        Environment.SetEnvironmentVariable("AVEN_TEST_KEY", null);
        Directory.CreateDirectory(_dir);
        Environment.SetEnvironmentVariable("OPENROUTER_API_KEY", "sk-or-env-1");
        try
        {
            var relu = KeysService.Load(_dir);
            Assert.Equal("sk-or-env-1", relu["openrouter"]);
            Assert.False(FlagsSansEnv()["groq"]); // pas de clé Groq stockée ni env dans ce test
        }
        finally { Environment.SetEnvironmentVariable("OPENROUTER_API_KEY", null); }
    }

    [Fact]
    public void Load_le_store_natif_prévaut_sur_lenvironnement()
    {
        Directory.CreateDirectory(_dir);
        KeysService.Save(_dir, "openrouter", "sk-or-store");
        Environment.SetEnvironmentVariable("OPENROUTER_API_KEY", "sk-or-env");
        try
        {
            Assert.Equal("sk-or-store", KeysService.Load(_dir)["openrouter"]);
        }
        finally { Environment.SetEnvironmentVariable("OPENROUTER_API_KEY", null); }
    }

    // ── Import du store Electron Classic (une fois) ────────────────────────────

    /// <summary>Clé AES factice + « Local State » au format Chromium (encrypted_key base64 préfixe DPAPI).</summary>
    private (byte[] Key, string EncryptedKey) CreerLocalStateElectron()
    {
        var aesKey = RandomNumberGenerator.GetBytes(32);
        var protegee = ProtectedData.Protect(aesKey, null, DataProtectionScope.CurrentUser);
        var brut = Encoding.ASCII.GetBytes("DPAPI").Concat(protegee).ToArray();
        Directory.CreateDirectory(_electron);
        File.WriteAllText(Path.Combine(_electron, "Local State"),
            new JsonObject
            {
                ["os_crypt"] = new JsonObject { ["encrypted_key"] = Convert.ToBase64String(brut) },
            }.ToJsonString());
        return (aesKey, Convert.ToBase64String(brut));
    }

    /// <summary>Blob Chromium « v10 » : préfixe v10 + nonce 12 o + ciphertext/tag GCM.</summary>
    private static string ChiffrerV10(byte[] aesKey, string clair)
    {
        var nonce = RandomNumberGenerator.GetBytes(12);
        var donnees = Encoding.UTF8.GetBytes(clair);
        var ciphertext = new byte[donnees.Length];
        var tag = new byte[16];
        using var gcm = new AesGcm(aesKey, 16);
        gcm.Encrypt(nonce, donnees, ciphertext, tag);
        return Convert.ToBase64String(Encoding.ASCII.GetBytes("v10").Concat(nonce).Concat(ciphertext).Concat(tag).ToArray());
    }

    [Fact]
    public void Import_Electron_déchiffre_le_format_Chromium_v10_et_réécrit_en_DPAPI()
    {
        var (aesKey, _) = CreerLocalStateElectron();
        var electronKeys = new JsonObject
        {
            ["openrouter"] = ChiffrerV10(aesKey, "sk-or-v10-42"),
            ["groq"] = ChiffrerV10(aesKey, "gsk_v10-42"),
        };
        Directory.CreateDirectory(_electron);
        File.WriteAllText(Path.Combine(_electron, "settings.json"),
            new JsonObject { ["keysEnc"] = electronKeys }.ToJsonString());

        var importées = KeysService.ImportFromElectron(_dir, _electron);
        Assert.Equal(2, importées);

        var relu = KeysService.Load(_dir);
        Assert.Equal("sk-or-v10-42", relu["openrouter"]);
        Assert.Equal("gsk_v10-42", relu["groq"]);

        // Le store natif est DPAPI (pas un simple recopie du blob Chromium).
        var json = File.ReadAllText(KeysService.Fichier(_dir));
        Assert.DoesNotContain("sk-or-v10-42", json);
        Assert.DoesNotContain("v10", json);

        // Deuxième appel : le store natif existe → 0 (import UNE fois).
        Assert.Equal(0, KeysService.ImportFromElectron(_dir, _electron));
    }

    [Fact]
    public void Import_Electron_déchiffre_l_ancien_safeStorage_blob_DPAPI()
    {
        CreerLocalStateElectron(); // présent mais inutile pour l'ancien format
        var legacy = Convert.ToBase64String(
            ProtectedData.Protect(Encoding.UTF8.GetBytes("sk-or-legacy-7"), null, DataProtectionScope.CurrentUser));
        Directory.CreateDirectory(_electron);
        File.WriteAllText(Path.Combine(_electron, "settings.json"),
            new JsonObject { ["keysEnc"] = new JsonObject { ["openrouter"] = legacy } }.ToJsonString());

        Assert.Equal(1, KeysService.ImportFromElectron(_dir, _electron));
        Assert.Equal("sk-or-legacy-7", KeysService.Load(_dir)["openrouter"]);
    }

    [Fact]
    public void Import_Electron_sait_lire_l_ancienne_clé_openrouterKeyEnc()
    {
        CreerLocalStateElectron();
        var legacy = Convert.ToBase64String(
            ProtectedData.Protect(Encoding.UTF8.GetBytes("sk-or-v3-1"), null, DataProtectionScope.CurrentUser));
        Directory.CreateDirectory(_electron);
        File.WriteAllText(Path.Combine(_electron, "settings.json"),
            new JsonObject { ["openrouterKeyEnc"] = legacy }.ToJsonString());

        Assert.Equal(1, KeysService.ImportFromElectron(_dir, _electron));
        Assert.Equal("sk-or-v3-1", KeysService.Load(_dir)["openrouter"]);
    }

    [Fact]
    public void Import_Electron_ne_bloque_jamais_sur_un_store_illisible_ou_vides()
    {
        // Store Electron absent : rien à importer, aucun fichier natif créé.
        Assert.Equal(0, KeysService.ImportFromElectron(_dir, _electron));
        Assert.False(File.Exists(KeysService.Fichier(_dir)));

        // Store corrompu : 0, pas d'erreur (parité : première utilisation côté natif).
        Directory.CreateDirectory(_electron);
        File.WriteAllText(Path.Combine(_electron, "settings.json"), "{ corrompu");
        Assert.Equal(0, KeysService.ImportFromElectron(_dir, _electron));
        Assert.False(File.Exists(KeysService.Fichier(_dir)));

        // Clé indéchiffrable (Local State absent) : simplement sautée, ni bloquée ni visible.
        File.WriteAllText(Path.Combine(_electron, "settings.json"),
            new JsonObject { ["keysEnc"] = new JsonObject { ["openrouter"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64)) } }.ToJsonString());
        Assert.Equal(0, KeysService.ImportFromElectron(_dir, _electron));
        Assert.False(File.Exists(KeysService.Fichier(_dir)));
        Assert.False(FlagsSansEnv()["openrouter"]);
    }

    /// <summary>Flags en neutralisant les variables d'environnement de la machine (test reproductible).</summary>
    private Dictionary<string, bool> FlagsSansEnv()
    {
        var (or, groq) = NeutraliserEnv();
        try { return KeysService.Flags(_dir); }
        finally { RestaurerEnv(or, groq); }
    }

    /// <summary>Load sans repli sur les variables d'environnement de la machine.</summary>
    private Dictionary<string, string> LoadSansEnv()
    {
        var (or, groq) = NeutraliserEnv();
        try { return KeysService.Load(_dir); }
        finally { RestaurerEnv(or, groq); }
    }

    private static (string? Or, string? Groq) NeutraliserEnv()
    {
        var or = Environment.GetEnvironmentVariable("OPENROUTER_API_KEY");
        var groq = Environment.GetEnvironmentVariable("GROQ_API_KEY");
        Environment.SetEnvironmentVariable("OPENROUTER_API_KEY", null);
        Environment.SetEnvironmentVariable("GROQ_API_KEY", null);
        return (or, groq);
    }

    private static void RestaurerEnv(string? or, string? groq)
    {
        Environment.SetEnvironmentVariable("OPENROUTER_API_KEY", or);
        Environment.SetEnvironmentVariable("GROQ_API_KEY", groq);
    }

    [Fact]
    public void Import_Electron_ne_touche_pas_au_store_natif_existant()
    {
        KeysService.Save(_dir, "openrouter", "sk-or-natif");
        Directory.CreateDirectory(_electron);
        File.WriteAllText(Path.Combine(_electron, "settings.json"),
            new JsonObject { ["keysEnc"] = new JsonObject { ["openrouter"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64)) } }.ToJsonString());

        Assert.Equal(0, KeysService.ImportFromElectron(_dir, _electron));
        Assert.Equal("sk-or-natif", KeysService.Load(_dir)["openrouter"]);
    }
}

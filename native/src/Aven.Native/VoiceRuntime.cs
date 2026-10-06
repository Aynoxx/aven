using System.Collections.Generic;
using Windows.Media;
using Windows.Media.Capture;
using Windows.Media.MediaProperties;
using Windows.Storage.Streams;

namespace Aven.Native;

/// <summary>
/// Dictée push-to-talk (phase 6) : capture micro WinRT (MediaCapture, catégorie
/// Speech) en WAV dans un flux mémoire ; à l'arrêt, les octets partent dans le
/// pipeline Groq déjà testé (Aven.Bridge.VoicePipeline). La dictée n'est JAMAIS
/// bloquante : tout échec est silencieux (parité voice.ts).
/// v9.7.5 : TOUT le cycle matériel vit hors du thread UI — l'initialisation et
/// le démarrage de la capture (0,3–1,5 s) comme l'arrêt + flush (StopRecordAsync)
/// passent dans Task.Run ; le thread appelant ne fait qu'attendre un Task de
/// fond, l'UI (hub, chat, terminal) reste fluide pendant la dictée (parité
/// MediaRecorder du web, qui ne gèle jamais le rendu). Les callbacks résultat /
/// transcriptionDémarrée restent marshalés par l'appelant (DispatcherQueue).
/// La synthèse vocale (annonceur) passe par PowerShell SAPI côté fenêtre — même
/// politique que main.ts (voix Windows gratuite, hors ligne, déjà installée).
/// </summary>
public sealed class VoiceRuntime : IDisposable
{
    private readonly Aven.Bridge.VoicePipeline _pipeline;
    private MediaCapture? _capture;
    private InMemoryRandomAccessStream? _enregistrement;
    private readonly SemaphoreSlim _verrou = new(1, 1);
    private volatile bool _demandée;

    public VoiceRuntime(Aven.Bridge.VoicePipeline pipeline) => _pipeline = pipeline;

    /// <summary>v9.7.5 : état « demandé » — true dès le clic (label « J'écoute… »
    /// immédiat, parité setState("recording") synchrone du web) AVANT
    /// l'initialisation matérielle ; retombe au renoncement (échec d'init) et à
    /// l'arrêt (la transcription prend le relais).</summary>
    public bool Demandée => _demandée;

    /// <summary>Demande la dictée (label immédiat) — à appeler avant le await de
    /// BasculerDictée pour que le bouton bascule sans attendre l'init matérielle.</summary>
    public void Demander() => _demandée = true;

    /// <summary>Renonce (échec d'initialisation) : le bouton revient à « Dicter ».</summary>
    public void Renoncer() => _demandée = false;

    /// <summary>Clé Groq de la dictée : d'abord le store natif settings.json
    /// (provider "groq", service de clés chiffrées DPAPI), ensuite la variable
    /// d'environnement du fournisseur (parité de l'import). "" si aucune.
    /// v9.7.5 : factorisée — le bouton central du hub l'interroge AVANT de lancer
    /// la capture (parité pointerDown du web : avis immédiat si keys.groq manque).</summary>
    public static string RésoudreCléGroq()
    {
        try
        {
            var clés = Aven.Bridge.KeysService.Load(Aven.Bridge.AppData.Dir());
            if (clés.TryGetValue("groq", out var valClé) && !string.IsNullOrEmpty(valClé)) return valClé;
        }
        catch { /* best effort : la variable d'environnement peut suffire */ }
        return Aven.Bridge.Providers.De("groq") is { } fournisseur
            ? System.Environment.GetEnvironmentVariable(fournisseur.Env) ?? ""
            : "";
    }

    /// <summary>Enregistre ou arrête la dictée ; à l'arrêt le résultat est poussé au callback.
    /// v9.6.1 : <paramref name="transcriptionDémarrée"/> signale l'entrée en transcription
    /// (3e état du bouton vocal, parité « Transcription… » de voice-dictation.ts). Tiré
    /// UNIQUEMENT quand le pipeline s'engage (pas de clé = pas de faux état) : le
    /// désarmement appartient à l'appelant — résultat, échec, ou filet de sécurité.
    /// v9.7.5 : branches démarrage ET arrêt intégralement en Task.Run (fin des gels UI).</summary>
    public async Task BasculerDictée(Action<Aven.Bridge.DictationResult> résultat,
        Action? transcriptionDémarrée = null)
    {
        await _verrou.WaitAsync().ConfigureAwait(true);
        try
        {
            if (_capture is { } capture)
            {
                // Arrêt : l'état logique bascule TOUT DE SUITE (EnCours tombe, le
                // label quitte « J'écoute… »), puis stop + flush, lecture du WAV,
                // clé et appel Groq vivent en fond — plus aucun gel du thread UI.
                var flux = _enregistrement!;
                _capture = null;
                _enregistrement = null;
                _demandée = false;
                _ = Task.Run(async () =>
                {
                    try
                    {
                        await capture.StopRecordAsync().AsTask().ConfigureAwait(false);
                        capture.Dispose();
                        var taille = (uint)flux.Size;
                        using var lecteur = new DataReader(flux.GetInputStreamAt(0));
                        await lecteur.LoadAsync(taille);
                        var octets = new byte[taille];
                        lecteur.ReadBytes(octets);
                        var clé = RésoudreCléGroq();
                        if (clé.Length == 0) return; // pas de clé : la dictée se tait (comme le web)
                        // v9.6.1 : début de transcription (parité setState("transcribing")
                        // de voice-dictation.ts) — le badge « Transcription… » s'allume
                        // pendant l'appel Groq ; l'appelant désarme au résultat, en cas
                        // d'échec, ou via son filet de sécurité.
                        transcriptionDémarrée?.Invoke();
                        var dictée = await _pipeline.TranscribeSpeechAsync(octets, "audio/wav", clé).ConfigureAwait(false);
                        résultat(dictée);
                    }
                    catch { /* jamais bloquante (parité voice.ts) */ }
                });
            }
            else
            {
                // Démarrage : MediaCapture (init 0,3–1,5 s + démarrage) intégralement
                // en fond — le thread UI ne bloque jamais (v9.7.5, fin des gels).
                try
                {
                    var (média, flux) = await Task.Run(async () =>
                    {
                        var m = new MediaCapture();
                        await m.InitializeAsync(new MediaCaptureInitializationSettings
                        {
                            StreamingCaptureMode = StreamingCaptureMode.Audio,
                            MediaCategory = MediaCategory.Speech,
                        }).AsTask().ConfigureAwait(false);
                        var f = new InMemoryRandomAccessStream();
                        await m.StartRecordToStreamAsync(
                            MediaEncodingProfile.CreateWav(AudioEncodingQuality.Medium), f).AsTask().ConfigureAwait(false);
                        return (m, f);
                    }).ConfigureAwait(true);
                    _capture = média;
                    _enregistrement = flux;
                }
                catch
                {
                    _demandée = false; // v9.7.5 : jamais de « J'écoute… » orphelin
                    throw;
                }
            }
        }
        finally { _verrou.Release(); }
    }

    /// <summary>En train d'enregistrer ? (badge UI du push-to-talk)</summary>
    public bool EnCours => _capture is not null;

    public void Dispose()
    {
        try { _capture?.Dispose(); } catch { }
    }
}

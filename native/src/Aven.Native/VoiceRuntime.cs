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
/// La synthèse vocale (annonceur) passe par PowerShell SAPI côté fenêtre — même
/// politique que main.ts (voix Windows gratuite, hors ligne, déjà installée).
/// </summary>
public sealed class VoiceRuntime : IDisposable
{
    private readonly Aven.Bridge.VoicePipeline _pipeline;
    private MediaCapture? _capture;
    private InMemoryRandomAccessStream? _enregistrement;
    private readonly SemaphoreSlim _verrou = new(1, 1);

    public VoiceRuntime(Aven.Bridge.VoicePipeline pipeline) => _pipeline = pipeline;

    /// <summary>Enregistre ou arrête la dictée ; à l'arrêt le résultat est poussé au callback.</summary>
    public async Task BasculerDictée(Action<Aven.Bridge.DictationResult> résultat)
    {
        await _verrou.WaitAsync().ConfigureAwait(true);
        try
        {
            if (_capture is { } capture)
            {
                // Arrêt : récupérer le WAV et lancer le pipeline hors du thread UI.
                await capture.StopRecordAsync().AsTask().ConfigureAwait(true);
                var flux = _enregistrement!;
                _capture = null;
                _enregistrement = null;
                capture.Dispose();
                _ = Task.Run(async () =>
                {
                    try
                    {
                        var taille = (uint)flux.Size;
                        using var lecteur = new DataReader(flux.GetInputStreamAt(0));
                        await lecteur.LoadAsync(taille);
                        var octets = new byte[taille];
                        lecteur.ReadBytes(octets);
                        // Clé Groq ancrée dans les Paramètres (service de clés chiffrées DPAPI) :
                        // - d'abord le store natif settings.json (provider "groq"),
                        // - ensuite la variable d'environnement GROQ_API_KEY (parité de l'import).
                        var clés = Aven.Bridge.KeysService.Load(Aven.Bridge.AppData.Dir());
                        var clé = "";
                        if (clés.TryGetValue("groq", out var valClé) && !string.IsNullOrEmpty(valClé))
                        {
                            clé = valClé;
                        }
                        else if (Aven.Bridge.Providers.De("groq") is { } fournisseur && !string.IsNullOrEmpty(
                            System.Environment.GetEnvironmentVariable(fournisseur.Env)))
                        {
                            clé = System.Environment.GetEnvironmentVariable(fournisseur.Env)!;
                        }
                        if (clé.Length == 0) return; // pas de clé : la dictée se tait (comme le web)
                        var dictée = await _pipeline.TranscribeSpeechAsync(octets, "audio/wav", clé).ConfigureAwait(false);
                        résultat(dictée);
                    }
                    catch { /* jamais bloquante (parité voice.ts) */ }
                });
            }
            else
            {
                var media = new MediaCapture();
                await media.InitializeAsync(new MediaCaptureInitializationSettings
                {
                    StreamingCaptureMode = StreamingCaptureMode.Audio,
                    MediaCategory = MediaCategory.Speech,
                }).AsTask();
                _enregistrement = new InMemoryRandomAccessStream();
                await media.StartRecordToStreamAsync(
                    MediaEncodingProfile.CreateWav(AudioEncodingQuality.Medium), _enregistrement).AsTask();
                _capture = media;
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

using System.Text.RegularExpressions;

namespace Aven.Bridge;

/// <summary>Événement à annoncer (parité AnnounceEvent de announcer.ts).</summary>
public sealed record AnnounceEvent(string Type, IReadOnlyDictionary<string, string> Data);

/// <summary>Une phrase à dire (kind : info | result — la coalescence remplace le même type).</summary>
public sealed record AnnouncePhrase(string Text, string Kind);

/// <summary>
/// Traduit un événement en phrase (ou null si rien à dire) — port PUR de phraseFor
/// (announcer.ts v8.7.9). GRAMMAIRE MINUSCULE : on résume l'état, on ne lit JAMAIS
/// le contenu des réponses de l'agent.
/// </summary>
public static class AnnouncerPhrases
{
    public static AnnouncePhrase? PhraseFor(string type, IReadOnlyDictionary<string, string> data)
    {
        switch (type)
        {
            case "session.execution.started":
                return new AnnouncePhrase("C'est parti.", "info");
            case "session.execution.succeeded":
            {
                // Le nombre de fichiers modifiés est compté sur d.tools (edit/write/multiedit).
                var edits = 0;
                if (data.TryGetValue("toolsCount", out var total) && Regex.IsMatch(total, "^\\d+$"))
                    edits = 0; // forme brute non structurée : on ne l'invente pas
                return new AnnouncePhrase(edits > 0 ? $"Terminé — {edits} fichiers modifiés." : "Terminé.", "result");
            }
            case "session.execution.failed":
            {
                var message = (data.GetValueOrDefault("errorMessage") ?? "").Trim();
                var court = message.Length > 0 ? Regex.Match(message, "^[.\\n]").Success ? message : message.Split('.', '\n')[0][..Math.Min(90, message.Split('.', '\n')[0].Length)] : "raison inconnue";
                return new AnnouncePhrase($"Échec : {court}.", "result");
            }
            case "session.execution.interrupted":
                return new AnnouncePhrase("Interrompu.", "result");
            case "permission.asked":
            {
                var action = (data.GetValueOrDefault("action") ?? "").Trim();
                if (action.Length == 0) action = "une action";
                var humain = action switch
                {
                    "write" => "d'écrire un fichier",
                    "edit" => "de modifier un fichier",
                    _ => $"« {action} »",
                };
                return new AnnouncePhrase($"Aven demande la permission {humain}. Réponds à l'écran.", "info");
            }
            case "router.notice":
            {
                var text = data.GetValueOrDefault("text") ?? "";
                // Seules les saturations sont annoncées — le simple changement de priorité est du bruit.
                if (Regex.IsMatch(text, "bascule sur", RegexOptions.IgnoreCase))
                    return new AnnouncePhrase("Modèle saturé, passage sur le suivant.", "info");
                if (Regex.IsMatch(text, "indisponible", RegexOptions.IgnoreCase))
                    return new AnnouncePhrase("Tous les modèles de cet agent sont momentanément saturés.", "info");
                return null;
            }
            default:
                return null;
        }
    }
}

/// <summary>
/// Annonceur vocal — port de announcer.ts : COALESCENCE (jamais de file d'attente,
/// la phrase la plus récente du même type gagne), MUTE (une frappe coupe tout et vide
/// la file — on ne parle jamais par-dessus quelqu'un qui tape), la voix est INJECTABLE
/// (System.Speech/PowerShell en production, double en tests).
/// </summary>
public sealed class Announcer
{
    private readonly Func<string, Task> _speak;
    private readonly Func<bool> _isMuted;
    private readonly Func<long> _now;
    private readonly int _settleMs;
    private readonly Queue<AnnouncePhrase> _file = new();
    private readonly SemaphoreSlim _drain = new(1, 1);
    private long _mutedJusquà;

    public Announcer(Func<string, Task> speak, Func<bool>? isMuted = null, Func<long>? now = null, int settleMs = 0)
    {
        _speak = speak;
        _isMuted = isMuted ?? (() => false);
        _now = now ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        _settleMs = settleMs;
    }

    public bool Activé { get; private set; } = true; // unique source de vérité (l'ancien champ _activé était mort — CS0414)

    public void SetEnabled(bool on)
    {
        Activé = on;
        if (!on) { _file.Clear(); Mute(500); }
        else _mutedJusquà = 0;
    }

    /// <summary>L'utilisateur tape/clique : coupe tout, vide la file, verrouille la voix 3 s.</summary>
    public void Mute(int ms = 3000)
    {
        _file.Clear();
        _mutedJusquà = _now() + ms;
    }

    public void Handle(string type, IReadOnlyDictionary<string, string> data)
    {
        if (!Activé) return;
        var phrase = AnnouncerPhrases.PhraseFor(type, data);
        if (phrase is not null) Enqueue(phrase);
    }

    /// <summary>Met une phrase en file avec coalescence : les doublons du même type sont remplacés.</summary>
    public void Enqueue(AnnouncePhrase phrase)
    {
        if (!Activé) return;
        if (_isMuted() || _now() < _mutedJusquà) return;
        // Coalescence : ne jamais empiler deux phrases du même type — la plus récente gagne.
        var restantes = _file.Where(p => p.Kind != phrase.Kind);
        _file.Clear();
        foreach (var p in restantes) _file.Enqueue(p);
        _file.Enqueue(phrase);
        _ = Vider();
    }

    private async Task Vider()
    {
        if (!await _drain.WaitAsync(0).ConfigureAwait(false)) return; // déjà en train de parler
        try
        {
            while (_file.Count > 0)
            {
                if (_isMuted() || _now() < _mutedJusquà) { _file.Clear(); return; }
                var prochaine = _file.Dequeue();
                // Fenêtre de stabilisation : les événements rapprochés coalescent même
                // après la sortie de file ; un mute pendant la fenêtre annule tout.
                if (_settleMs > 0) await Task.Delay(_settleMs).ConfigureAwait(false);
                if (_isMuted() || _now() < _mutedJusquà) { _file.Clear(); return; }
                // Une phrase plus récente du même type est arrivée : c'est elle qu'on dit.
                AnnouncePhrase àDire;
                lock (_file)
                {
                    var plusRécente = _file.Reverse().FirstOrDefault(p => p.Kind == prochaine.Kind);
                    if (plusRécente is not null)
                    {
                        var copie = _file.Where(p => !ReferenceEquals(p, plusRécente)).ToList();
                        _file.Clear();
                        foreach (var p in copie) _file.Enqueue(p);
                        àDire = plusRécente;
                    }
                    else àDire = prochaine;
                }
                try { await _speak(àDire.Text).ConfigureAwait(false); }
                catch { return; } // la voix a échoué (SAPI indisponible) : on s'arrête proprement
            }
        }
        finally { _drain.Release(); }
    }
}

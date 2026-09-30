namespace Aven.Bridge;

/// <summary>Résultat de dictée (parité DictationResult de web/src/types.ts).</summary>
public sealed class DictationResult
{
    /// <summary>Transcription Whisper telle quelle.</summary>
    public string Raw { get; set; } = "";
    /// <summary>Texte après reformage (absent si la passe a échoué ou n'a rien changé).</summary>
    public string? Cleaned { get; set; }
    /// <summary>Nom du modèle de reformage.</summary>
    public string? CleanedBy { get; set; }
    /// <summary>Raison pour laquelle le reformage n'a pas eu lieu.</summary>
    public string? Warning { get; set; }
    /// <summary>Routage décidé par la passe d'intention (absent si elle a échoué sans filet).</summary>
    public DictationIntent? Intent { get; set; }
}

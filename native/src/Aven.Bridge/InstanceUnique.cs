namespace Aven.Bridge;

/// <summary>
/// Verrou mono-instance (Lot 6, parité app.requestSingleInstanceLock de
/// electron/main.ts) : évite de lancer deux processus OpenCode sur le même espace
/// de travail. La deuxième instance meurt aussitôt (parité app.quit()) après avoir
/// réveillé la première (parité « second-instance » → showWindow).
/// Mutex « Local\ » : portée session utilisateur (comme le lock d'Electron). Le
/// mutex disparaît avec son dernier handle : un crash de la première instance
/// n'empêche jamais le lancement suivant — aucune branche « mutex abandonné ».
/// </summary>
public static class InstanceUnique
{
    public const string NomMutex = @"Local\Aven-winui-mono-instance";
    public const string NomÉvénement = @"Local\Aven-winui-montrer-fenêtre";

    private static Mutex? _mutex;
    private static EventWaitHandle? _événement;

    /// <summary>Premier arrivé = true (propriétaire). La deuxième instance reçoit false.</summary>
    public static bool Acquérir()
    {
        _mutex = new Mutex(initiallyOwned: true, NomMutex, out var créé);
        return créé;
    }

    /// <summary>Deuxième instance : réveille la première (fenêtre au premier plan).
    /// false si la première n'a pas (encore) préparé son événement — best effort.</summary>
    public static bool RéveillerPremière()
    {
        try
        {
            using var événement = EventWaitHandle.OpenExisting(NomÉvénement);
            return événement.Set();
        }
        catch { return false; }
    }

    /// <summary>Première instance : prépare l'événement de réveil (déclaré UNE fois).</summary>
    public static EventWaitHandle PréparerÉvénement() =>
        _événement = new EventWaitHandle(false, EventResetMode.AutoReset, NomÉvénement);

    /// <summary>Handle de l'événement de réveil (null si non préparé) : la première
    /// instance l'attend sur un thread d'arrière-plan sans monopoliser la pompe UI.</summary>
    public static EventWaitHandle? ÉvénementRéveil => _événement;

    /// <summary>Fermeture de la fenêtre propriétaire : libère tout (le mutex disparaît).</summary>
    public static void Libérer()
    {
        try { _événement?.Dispose(); } catch { /* déjà libéré */ }
        _événement = null;
        try
        {
            if (_mutex is { } mutex)
            {
                if (mutex.WaitOne(0)) mutex.ReleaseMutex(); // on ne relâche que si on le tenait
            }
        }
        catch { /* abandonné ou non possédé : le Dispose suffit */ }
        try { _mutex?.Dispose(); } catch { /* déjà libéré */ }
        _mutex = null;
    }
}

/// <summary>
/// Navigation clavier des listes du hub (Lot 6, parité arrow-navigation.ts v9.1.6) :
/// flèches Haut/Bas pour se déplacer parmi les récents, Entrée laisse le bouton agir.
/// Logique décisionnelle PURE (règle RULES.md §8) : l'arbre XAML reste dans la
/// fenêtre, ici on ne fait que calculer l'index suivant — testé sans UI.
/// </summary>
public static class FlèchesHub
{
    /// <summary>Calcule l'index à activer après une touche de navigation (parité
    /// nextArrowIndex) : ArrowDown/ArrowUp avec bouclage, Home/End, null = inchangé.
    /// L'index -1 (rien de sélectionné) + ArrowDown démarre sur le premier item.</summary>
    public static int? Suivant(string touche, int courant, int total)
    {
        if (total <= 0) return null;
        return touche switch
        {
            "ArrowDown" => courant < 0 || courant >= total - 1 ? 0 : courant + 1,
            "ArrowUp" => courant < 0 || courant <= 0 ? total - 1 : courant - 1,
            "Home" => 0,
            "End" => total - 1,
            _ => null,
        };
    }
}

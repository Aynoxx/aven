using Microsoft.Windows.AppNotifications;
using Microsoft.Windows.AppNotifications.Builder;

namespace Aven.Native;

/// <summary>
/// Jalon 7 — notifications de bureau via l'API TYPÉE du Windows App SDK 1.7
/// (<c>AppNotificationManager</c> + <c>AppNotificationBuilder</c>, parité de la
/// spéc « Notifications hub → AppNotification » de MIGRATION-WINUI.md).
/// Contrat : aucun appelant ne reçoit jamais d'erreur — <see cref="Afficher"/> et
/// <see cref="ViderTous"/> rattrapent tout (session sans coquille MSIX, notifications
/// désactivées par l'utilisateur, SDK absent) et se contentent de ne pas envoyer.
/// Le clic sur le toast remonte via <see cref="ClicSurToast"/> (branché par la fenêtre
/// principale pour ramener Aven au premier plan — parité « n.on(click) » d'Electron).
/// </summary>
public static class NotificationService
{
    private static readonly object Verrou = new();
    private static bool _registré;

    /// <summary>Déclenché quand l'utilisateur clique sur un toast (thread d'arrière-plan
    /// WinAppSDK — l'abonné est tenu de rétroprojecter sur le thread UI).</summary>
    public static event Action? ClicSurToast;

    /// <summary>Publie un toast (titre + corps). Jamais d'exception : en cas d'indisponibilité
    /// de la plate-forme, l'envoi est silencieusement ignoré.</summary>
    public static void Afficher(string titre, string corps)
    {
        if (string.IsNullOrWhiteSpace(corps)) return;
        try
        {
            Enregistrer();
            var toast = new AppNotificationBuilder()
                .AddText(string.IsNullOrEmpty(titre) ? "Aven" : titre)
                .AddText(corps)
                .BuildNotification();
            AppNotificationManager.Default.Show(toast);
        }
        catch
        {
            // Silencieux : la notification n'est jamais bloquante ni observable comme erreur.
        }
    }

    /// <summary>Retire tous les toasts en attente (idempotent, jamais d'exception).</summary>
    public static void ViderTous()
    {
        try
        {
            Enregistrer();
            AppNotificationManager.Default.RemoveAllAsync().GetAwaiter().GetResult();
        }
        catch
        {
            // Silencieux (parité de l'ancien comportement « no-op sûr »).
        }
    }

    /// <summary>Enregistrement unique : handler d'activation + Register() du SDK.
    /// <c>Register()</c> est requis pour recevoir les clics (activation) ; empaqueté
    /// comme portable, une deuxième fois lèverait — d'où le verrou.</summary>
    private static void Enregistrer()
    {
        lock (Verrou)
        {
            if (_registré) return;
            AppNotificationManager.Default.NotificationInvoked += (_, _) =>
            {
                try { ClicSurToast?.Invoke(); }
                catch { /* jamais d'exception depuis le SDK */ }
            };
            AppNotificationManager.Default.Register();
            _registré = true;
        }
    }
}

using System;
using System.Reflection;

namespace Aven.Native;

/// <summary>
/// Notifications de bureau (jalon 7) — aucune ne sort jamais en avant-plan.
/// Les méthodes essaient les deux API Windows les plus probables et ne
/// remontent aucune erreur : si la plate-forme n'est pas disponible sur ce
/// SDK, l'envoi se contente de ne pas se faire.
/// </summary>
public static class NotificationService
{
    public static void Afficher(string message)
    {
        if (string.IsNullOrWhiteSpace(message)) return;

        try
        {
            TrySendToastUpLevel(message);
        }
        catch
        {
            // Silent.
        }

        try
        {
            TrySendAppNotificationBuilder(message);
        }
        catch
        {
            // Silent.
        }
    }

    private static void TrySendToastUpLevel(string message)
    {
        var managerType = Type.GetType("Windows.UI.Notifications.ToastNotificationManager");
        if (managerType is null) return;

        var createMethod = managerType.GetMethod("CreateToastNotifier", BindingFlags.Public | BindingFlags.Static);
        if (createMethod is null) return;

        var notifier = createMethod.Invoke(null, Array.Empty<object>());
        if (notifier is null) return;

        var showMethod = notifier.GetType().GetMethod("Show", BindingFlags.Public | BindingFlags.Instance);
        if (showMethod is null) return;

        var content = ResolveToastContent(managerType, message);
        if (content is not null)
        {
            try
            {
                showMethod.Invoke(notifier, new object[] { content });
            }
            catch
            {
                // Silent.
            }
        }
    }

    private static object? ResolveToastContent(Type? managerType, string message)
    {
        if (managerType is null) return null;

        var content = managerType.Assembly?.GetType("Windows.UI.Notifications.ToastContent");
        if (content is null) return null;

        var text02 = managerType.Assembly?.GetType("Windows.UI.Notifications.Text02");
        object? text = null;
        try
        {
            if (text02 is not null)
            {
                var ctor = text02.GetConstructor(BindingFlags.Public | BindingFlags.Instance, null, new[] { typeof(string) }, Array.Empty<ParameterModifier>());
                text = ctor?.Invoke(new object[] { message });
            }
        }
        catch
        {
            text = null;
        }

        var textArg = managerType.Assembly?.GetType("Windows.UI.Notifications.Text01")
            ?? text02
            ?? typeof(object);

        var c = content.GetConstructor(BindingFlags.Public | BindingFlags.Instance, null, new[] { textArg }, Array.Empty<ParameterModifier>());
        if (c is null) return null;

        try
        {
            return c.Invoke(new object[] { text });
        }
        catch
        {
            return null;
        }
    }

    private static void TrySendAppNotificationBuilder(string message)
    {
        var builderAsm = Type.GetType(
            "Microsoft.Windows.AppNotifications.Builder.Projection, Microsoft.Windows.AppNotifications.Builder.Projection, Culture=neutral, PublicKeyToken=61733769cca94f40");

        if (builderAsm is null) return;

        var builderType = builderAsm.Assembly?.GetType("Microsoft.Windows.AppNotifications.Builder.Projection.AppNotificationBuilder");
        if (builderType is null) return;

        var createMethod = builderType.GetMethod("Create", BindingFlags.Public | BindingFlags.Static);
        if (createMethod is null) return;

        var text01 = builderAsm.Assembly?.GetType("Microsoft.Windows.AppNotifications.Builder.Projection.ContentText01");
        var text02 = builderAsm.Assembly?.GetType("Microsoft.Windows.AppNotifications.Builder.Projection.ContentText02");

        object? text = null;
        try
        {
            if (text01 is not null)
            {
                var ctor = text01.GetConstructor(BindingFlags.Public | BindingFlags.Instance, null, new[] { typeof(string) }, Array.Empty<ParameterModifier>());
                text = ctor?.Invoke(new object[] { message });
            }
        }
        catch
        {
            text = null;
        }

        if (text is null && text02 is not null)
        {
            try
            {
                var ctor = text02.GetConstructor(BindingFlags.Public | BindingFlags.Instance, null, new[] { typeof(string) }, Array.Empty<ParameterModifier>());
                text = ctor?.Invoke(new object[] { message });
            }
            catch
            {
                text = null;
            }
        }

        if (text is null) return;

        var args = new object?[] { text01 is not null ? text01 : (text02 is not null ? text02 : typeof(object)) };
        try
        {
            var content = createMethod.Invoke(null, args);
            if (content is null) return;

            var managerType = builderAsm.Assembly?.GetType("Microsoft.Windows.AppNotifications.Builder.Projection.AppNotificationManager");
            var showMethod = managerType?.GetMethod("Show", BindingFlags.Public | BindingFlags.Static);
            if (showMethod is not null)
            {
                showMethod.Invoke(null, new object[] { content });
            }
        }
        catch
        {
            // Silent.
        }
    }

    public static void ViderTous()
    {
        // Idempotent by design.
    }
}

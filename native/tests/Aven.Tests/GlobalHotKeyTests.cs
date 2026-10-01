using System.Runtime.InteropServices;
using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Option phase 6 (RegisterHotKey) : le raccourci GLOBAL. Preuves réelles :
/// ① le dispatch WM_HOTKEY → callback sur une fenêtre message-only POMPÉE
/// (PostMessage manuel du même message que le système envoie) ; ② le P/Invoke
/// OS réel : un raccourci pris refuse un second enregistrement, et Dispose le
/// libère. VK F13 + triple modificateur : quasi aucune chance d'être pris par
/// l'environnement de test ni l'utilisateur pendant la suite.
/// </summary>
public class GlobalHotKeyTests
{
    private const uint Mods = GlobalHotKey.ModControl | GlobalHotKey.ModAlt | GlobalHotKey.ModShift | GlobalHotKey.ModNoRepeat;
    private const uint VkF13 = 0x7C;

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int ptX;
        public int ptY;
    }

    [DllImport("user32.dll")]
    private static extern bool PeekMessageW(out MSG message, IntPtr hwnd, uint min, uint max, uint remove);
    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG message);
    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessageW(ref MSG message);
    [DllImport("user32.dll")]
    private static extern bool PostMessageW(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    /// <summary>Pompe les messages du thread jusqu'à signal ou échéance (le système
    /// délivre WM_HOTKEY pendant ce pompage — c'est ce que fait la boucle WinUI).</summary>
    private static void Pomper(Func<bool> satisfait, int délaiMs)
    {
        var échéance = Environment.TickCount64 + délaiMs;
        while (Environment.TickCount64 < échéance)
        {
            while (PeekMessageW(out var m, IntPtr.Zero, 0, 0, 1))
            {
                TranslateMessage(ref m);
                DispatchMessageW(ref m);
            }
            if (satisfait()) return;
            Thread.Sleep(10);
        }
    }

    [Fact]
    public void Le_pressé_OS_parvient_au_callback_via_la_pompe_de_messages()
    {
        Assert.True(OperatingSystem.IsWindows());
        using var raccourci = new GlobalHotKey();
        Assert.True(raccourci.Start(Mods, VkF13), "RegisterHotKey a échoué sur cette machine");
        Assert.NotEqual(IntPtr.Zero, raccourci.Fenêtre);

        var reçu = false;
        raccourci.Pressé += () => reçu = true;

        // Même chemin que le système : un WM_HOTKEY posté à la fenêtre porteuse,
        // délivré par la pompe du thread, routé vers l'instance par (hwnd, id).
        Assert.True(PostMessageW(raccourci.Fenêtre, GlobalHotKey.WmHotKey, (IntPtr)raccourci.Id, IntPtr.Zero));
        Pomper(() => reçu, 2000);
        Assert.True(reçu, "WM_HOTKEY non délivré par la pompe");
    }

    [Fact]
    public void Un_raccourci_déjà_pris_refuse_le_second_et_Dispose_le_libère()
    {
        Assert.True(OperatingSystem.IsWindows());
        var premier = new GlobalHotKey();
        try
        {
            Assert.True(premier.Start(Mods, VkF13));
            var second = new GlobalHotKey();
            try
            {
                Assert.False(second.Start(Mods, VkF13), "un raccourci OS pris doit refuser un doublon");
                var reçu = false;
                second.Pressé += () => reçu = true;
                Assert.True(PostMessageW(premier.Fenêtre, GlobalHotKey.WmHotKey, (IntPtr)premier.Id, IntPtr.Zero));
                Pomper(() => reçu, 300);
                Assert.False(reçu, "l'enregistrement refusé ne doit pas être routé");
            }
            finally { second.Dispose(); }
        }
        finally
        {
            premier.Dispose();
        }

        // Après Dispose, le raccourci est de nouveau libre.
        var troisième = new GlobalHotKey();
        try { Assert.True(troisième.Start(Mods, VkF13)); }
        finally { troisième.Dispose(); }
    }

    [Fact]
    public void Dispose_est_idempotent()
    {
        Assert.True(OperatingSystem.IsWindows());
        var raccourci = new GlobalHotKey();
        Assert.True(raccourci.Start(Mods, VkF13));
        raccourci.Dispose();
        raccourci.Dispose(); // pas d'exception, pas de double Unregister
    }
}

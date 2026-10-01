using System.Collections.Concurrent;
using System.Runtime.InteropServices;

namespace Aven.Bridge;

/// <summary>
/// Raccourci clavier OS GLOBAL — l'option « RegisterHotKey » laissée ouverte en
/// phase 6 du protocole : la dictée push-to-talk Ctrl+Maj+V marche désormais même
/// quand la fenêtre Aven n'a PAS le focus. L'accélérateur XAML local reste en
/// repli si le raccourci est déjà pris par un autre process (Start retourne false).
/// Porteur : une MESSAGE-ONLY window créée sur le thread appelant (qui doit pomper
/// les messages — le thread UI WinUI le fait déjà) : AUCUN sous-classement de la
/// fenêtre principale, donc aucun risque pour la boucle XAML. Le système poste
/// WM_HOTKEY à cette fenêtre, la WndProc statique route vers l'instance via
/// (hwnd, id). MOD_NOREPEAT : garder la touche enfoncée ne re-déclenche pas.
/// </summary>
public sealed class GlobalHotKey : IDisposable
{
    public const int WmHotKey = 0x0312;
    public const uint ModAlt = 0x0001;
    public const uint ModControl = 0x0002;
    public const uint ModShift = 0x0004;
    public const uint ModWin = 0x0008;
    public const uint ModNoRepeat = 0x4000;

    private static readonly ConcurrentDictionary<(IntPtr Hwnd, int Id), GlobalHotKey> Actifs = new();
    private static readonly object VerrouClasse = new();
    private static bool _classeEnregistrée;
    private static int _prochainId;

    private delegate IntPtr WndProcDélégué(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
    private static readonly WndProcDélégué _proc = BoucleMessages; // racine GC : le delegate doit survivre

    private IntPtr _hwnd;
    private int _id;
    private bool _enregistré;
    private bool _fenêtreCréée;

    /// <summary>Déclenché à chaque appui du raccourci (fenêtre Aven active ou non).</summary>
    public event Action? Pressé;

    /// <summary>Fenêtre message-only porteuse (pour les tests : PostMessage WM_HOTKEY).</summary>
    public IntPtr Fenêtre => _hwnd;

    /// <summary>Identifiant OS du raccourci (wParam du WM_HOTKEY).</summary>
    public int Id => _id;

    /// <summary>
    /// Crée la fenêtre porteuse et tente l'enregistrement OS. Retourne false si le
    /// raccourci est déjà pris (l'appelant garde son repli local). À appeler sur le
    /// thread UI (celui qui pompe les messages).
    /// </summary>
    public bool Start(uint modifiers, uint virtualKey)
    {
        if (!OperatingSystem.IsWindows()) return false;
        CréerFenêtre();
        _id = Interlocked.Increment(ref _prochainId);
        _enregistré = RegisterHotKey(_hwnd, _id, modifiers, virtualKey);
        if (_enregistré) Actifs[(_hwnd, _id)] = this;
        return _enregistré;
    }

    private static IntPtr BoucleMessages(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        if (msg == WmHotKey && Actifs.TryGetValue((hwnd, (int)wParam), out var raccourci))
            raccourci.Pressé?.Invoke();
        return DefWindowProcW(hwnd, msg, wParam, lParam);
    }

    private void CréerFenêtre()
    {
        if (_fenêtreCréée) return;
        lock (VerrouClasse)
        {
            if (!_classeEnregistrée)
            {
                var wc = new WNDCLASSW
                {
                    lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_proc),
                    hInstance = GetModuleHandleW(null),
                    lpszClassName = "AvenHotKeyMsgWindow",
                };
                RegisterClassW(ref wc); // 1410 (classe déjà existante) : un autre GlobalHotKey l'a posée — OK
                _classeEnregistrée = true;
            }
        }
        _hwnd = CreateWindowExW(0, "AvenHotKeyMsgWindow", "", 0, 0, 0, 0, 0,
            new IntPtr(-3) /* HWND_MESSAGE */, IntPtr.Zero, GetModuleHandleW(null), IntPtr.Zero);
        if (_hwnd == IntPtr.Zero)
            throw new InvalidOperationException("Fenêtre message-only impossible (CreateWindowExW).");
        _fenêtreCréée = true;
    }

    public void Dispose()
    {
        if (_enregistré)
        {
            UnregisterHotKey(_hwnd, _id);
            Actifs.TryRemove((_hwnd, _id), out _);
            _enregistré = false;
        }
        if (_fenêtreCréée)
        {
            DestroyWindow(_hwnd);
            _hwnd = IntPtr.Zero;
            _fenêtreCréée = false;
        }
        GC.SuppressFinalize(this);
    }

    ~GlobalHotKey() => Dispose();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    [DllImport("user32.dll")]
    private static extern IntPtr DefWindowProcW(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern ushort RegisterClassW(ref WNDCLASSW lpWndClass);
    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateWindowExW(uint exStyle, string className, string windowName, uint style,
        int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyWindow(IntPtr hWnd);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandleW(string? moduleName);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WNDCLASSW
    {
        public uint style;
        public IntPtr lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;
        public string? lpszMenuName;
        public string lpszClassName;
    }
}

using System.Runtime.InteropServices;

namespace Aven.Native;

/// <summary>
/// J7 (04/10/2026) — icône de tray système (parité <c>createTray()</c> d'Electron) :
/// losange violet d'Aven dans la zone de notification, tooltip « Afficher »/« Quitter »
/// cliquables, clic GAUCHE = afficher la fenêtre (parité <c>tray.on("click")</c>).
/// Portée par une fenêtre top-level CACHÉE du thread UI créée ici (aucun sous-classement
/// de la fenêtre principale, comme GlobalHotKey) : Shell_NotifyIconW y poste
/// WM_LBUTTONUP/WM_RBUTTONUP. Tout est no-op silencieux — un tray indisponible ne
/// casse jamais l'app (parité du try/catch de createTray).
/// </summary>
public sealed class TrayIcon : IDisposable
{
    private const int WmLButtonUp = 0x0202;
    private const int WmRButtonUp = 0x0205;
    private const int WmContextMenu = 0x007B;
    private const int WmDestroy = 0x0002;

    private const uint NimAdd = 0x00000000;
    private const uint NimDelete = 0x00000002;
    private const uint NifMessage = 0x00000001;
    private const uint NifIcon = 0x00000002;
    private const uint NifTip = 0x00000004;

    private const uint MfString = 0x00000000;
    private const uint MfSeparator = 0x00000800;
    private const uint TpmRightButton = 0x00000002;
    private const uint TpmReturnCmd = 0x0100;

    private const uint LrLoadFromFile = 0x00000010;
    private const uint LrDefaultSize = 0x00000040;
    private const uint ImageIcon = 0x00000001;

    private const int IdAfficher = 1001;
    private const int IdQuitter = 1002;

    private static readonly WndProcDélégué _proc = BoucleMessages; // racine GC : le delegate doit survivre

    private static bool _classeEnregistrée;
    private static readonly object VerrouClasse = new();
    private static readonly Dictionary<IntPtr, TrayIcon> Fenêtres = new();

    private delegate IntPtr WndProcDélégué(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    private IntPtr _hwnd;
    private IntPtr _icône;
    private bool _ajoutée;

    /// <summary>Clic gauche sur l'icône / « Afficher » du menu (thread UI).</summary>
    public event Action? AfficherDemandé;

    /// <summary>« Quitter » du menu (thread UI) — l'appelant ferme vraiment l'app.</summary>
    public event Action? QuitterDemandé;

    /// <summary>
    /// Crée la fenêtre porteuse et ajoute l'icône. Toujours silencieux : retourne
    /// false si la plateforme refuse (l'app tourne sans tray, parité Electron).
    /// À appeler sur le thread UI (celui qui pompe les messages).
    /// </summary>
    public bool Start()
    {
        if (!OperatingSystem.IsWindows()) return false;
        try
        {
            CréerFenêtre();
            _icône = ChargerIcône();
            var données = new NOTIFYICONDATAW
            {
                cbSize = (uint)Marshal.SizeOf<NOTIFYICONDATAW>(),
                hWnd = _hwnd,
                uID = 1,
                uFlags = NifMessage | NifIcon | NifTip,
                uCallbackMessage = WmLButtonUp, // seuls wParam/lParam portent le vrai msg : voir WndProc
                hIcon = _icône,
                szTip = "Aven", // parité setToolTip("Aven")
            };
            _ajoutée = Shell_NotifyIconW(NimAdd, ref données);
            return _ajoutée;
        }
        catch
        {
            return false; // jamais bloquant (parité catch de createTray)
        }
    }

    /// <summary>Retire l'icône puis détruit la fenêtre (idempotent, silencieux).</summary>
    public void Dispose()
    {
        try
        {
            if (_ajoutée && _hwnd != IntPtr.Zero)
            {
                var données = new NOTIFYICONDATAW
                {
                    cbSize = (uint)Marshal.SizeOf<NOTIFYICONDATAW>(),
                    hWnd = _hwnd,
                    uID = 1,
                };
                Shell_NotifyIconW(NimDelete, ref données);
                _ajoutée = false;
            }
            if (_hwnd != IntPtr.Zero)
            {
                lock (Fenêtres) Fenêtres.Remove(_hwnd);
                DestroyWindow(_hwnd);
                _hwnd = IntPtr.Zero;
            }
            if (_icône != IntPtr.Zero)
            {
                DestroyIcon(_icône);
                _icône = IntPtr.Zero;
            }
        }
        catch
        {
            // Silencieux : la sortie ne dépend jamais du tray.
        }
        GC.SuppressFinalize(this);
    }

    ~TrayIcon() => Dispose();

    /// <summary>Icône du manifeste (Assets/tray.ico à côté de l'exécutable — le csproj
    /// publie Assets\** en Content) ; repli sur l'icône de l'exécutable, puis standard.</summary>
    private static IntPtr ChargerIcône()
    {
        try
        {
            var chemin = Path.Combine(AppContext.BaseDirectory, "Assets", "tray.ico");
            if (File.Exists(chemin))
            {
                var chargée = LoadImageW(IntPtr.Zero, chemin, ImageIcon, 0, 0, LrLoadFromFile | LrDefaultSize);
                if (chargée != IntPtr.Zero) return chargée;
            }
            var exe = Environment.ProcessPath;
            if (exe is not null && ExtractIconExW(exe, 0, out var gros, IntPtr.Zero) > 0 && gros != IntPtr.Zero)
                return gros;
        }
        catch
        {
            // Repli ci-dessous.
        }
        return LoadIconW(IntPtr.Zero, new IntPtr(32512)); // IDI_APPLICATION
    }

    private void CréerFenêtre()
    {
        if (_hwnd != IntPtr.Zero) return;
        lock (VerrouClasse)
        {
            if (!_classeEnregistrée)
            {
                var wc = new WNDCLASSW
                {
                    lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_proc),
                    hInstance = GetModuleHandleW(null),
                    lpszClassName = "AvenTrayWindow",
                };
                RegisterClassW(ref wc); // classe déjà existante : un autre portage l'a posée — OK
                _classeEnregistrée = true;
            }
        }
        _hwnd = CreateWindowExW(0, "AvenTrayWindow", "AvenTray", 0,
            0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, GetModuleHandleW(null), IntPtr.Zero);
        if (_hwnd == IntPtr.Zero)
            throw new InvalidOperationException("Fenêtre de tray impossible (CreateWindowExW).");
        lock (Fenêtres) Fenêtres[_hwnd] = this;
    }

    private static IntPtr BoucleMessages(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        if (msg == WmDestroy)
        {
            lock (Fenêtres) Fenêtres.Remove(hwnd);
            return DefWindowProcW(hwnd, msg, wParam, lParam);
        }
        if (!Fenêtres.TryGetValue(hwnd, out var tray)) return DefWindowProcW(hwnd, msg, wParam, lParam);

        // Hors version 4 du NOTIFYICON, lParam EST le message souris (wParam = uID).
        if (msg == WmLButtonUp)
        {
            try { tray.AfficherDemandé?.Invoke(); } catch { /* jamais d'exception depuis le WndProc */ }
        }
        else if (msg == WmRButtonUp || msg == WmContextMenu)
        {
            tray.OuvrirMenu();
        }
        return DefWindowProcW(hwnd, msg, wParam, lParam);
    }

    /// <summary>Menu contextuel Afficher / — / Quitter au curseur (parité du template
    /// Menu.buildFromTemplate de createTray).</summary>
    private void OuvrirMenu()
    {
        try
        {
            var menu = CreatePopupMenu();
            if (menu == IntPtr.Zero) return;
            AppendMenuW(menu, MfString, new UIntPtr(IdAfficher), "Afficher");
            AppendMenuW(menu, MfSeparator, UIntPtr.Zero, null);
            AppendMenuW(menu, MfString, new UIntPtr(IdQuitter), "Quitter");
            GetCursorPos(out var point);
            // Astuce documentée : sans ce message, le menu reste ouvert après un clic ailleurs.
            SetForegroundWindow(_hwnd);
            var commande = TrackPopupMenuEx(menu, TpmRightButton | TpmReturnCmd,
                point.X, point.Y, _hwnd, IntPtr.Zero);
            PostMessageW(_hwnd, 0x0000, UIntPtr.Zero, IntPtr.Zero); // WM_NULL : fermeture fiable
            DestroyMenu(menu);
            if (commande == IdAfficher) AfficherDemandé?.Invoke();
            else if (commande == IdQuitter) QuitterDemandé?.Invoke();
        }
        catch
        {
            // Le tray n'est jamais bloquant.
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NOTIFYICONDATAW
    {
        public uint cbSize;
        public IntPtr hWnd;
        public uint uID;
        public uint uFlags;
        public uint uCallbackMessage;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szTip;
        public uint dwState;
        public uint dwStateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string szInfo;
        public uint uVersionOrTimeout;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string szInfoTitle;
        public uint dwInfoFlags;
        public Guid guidItem;
        public IntPtr hBalloonIcon;
    }

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

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern bool Shell_NotifyIconW(uint dwMessage, ref NOTIFYICONDATAW lpData);
    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern ushort RegisterClassW(ref WNDCLASSW lpWndClass);
    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateWindowExW(uint exStyle, string className, string windowName, uint style,
        int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern IntPtr DefWindowProcW(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreatePopupMenu();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AppendMenuW(IntPtr hMenu, uint uFlags, UIntPtr uIDNewItem, string? lpNewItem);
    [DllImport("user32.dll")]
    private static extern int TrackPopupMenuEx(IntPtr hMenu, uint uFlags, int x, int y, IntPtr hWnd, IntPtr lptpm);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyMenu(IntPtr hMenu);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out POINT lpPoint);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostMessageW(IntPtr hWnd, uint msg, UIntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr LoadImageW(IntPtr hInst, string name, uint type, int cx, int cy, uint fuLoad);
    [DllImport("user32.dll")]
    private static extern IntPtr LoadIconW(IntPtr hInstance, IntPtr lpIconName);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern uint ExtractIconExW(string lpszFile, int nIconIndex, out IntPtr phiconLarge, IntPtr phiconSmall);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyIcon(IntPtr hIcon);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandleW(string? moduleName);
}

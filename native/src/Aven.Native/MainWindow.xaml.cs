using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using Aven.Bridge;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Windows.Graphics;

namespace Aven.Native;

/// <summary>
/// Fenêtre principale (phase 2) : Mica + title bar étendu + hub 4 cartes → pages
/// cibles avec Connected Animation (parité du shared element v9.7.0 : la carte
/// DEVENT la page), cascade d'entrée (BeginTime échelonnés à 45 ms).
/// ShellView est fusionné ici : une seule page x:Class par assemblage, le seul
/// montage sûr pour le XamlCompiler net472 du WASDK 1.6 en local.
/// </summary>
public sealed partial class MainWindow : Window
{
    /// <summary>Version affichée (cohérence manifeste 10.0.0.0 — test en xUnit, décision §5.4).</summary>
    public const string AppVersion = "10.0.0.0";

    // Positions polaires du hub (parité .hub-card-project/agents/files/notes : 0°/90°/180°/270°).
    private const double Rayon = 250;
    private static readonly (double AngleDeg, string Titre, string Hint)[] Cibles =
    {
        (0, "Projet — Agent Freebuff", "Le terminal Freebuff embarqué arrive en phase 5 (ConPTY natif)."),
        (90, "Tâches — Spécialistes", "Les spécialistes tournent dans Aven Classic pour l'instant."),
        (180, "Fichiers", "L'explorateur intégré de l'espace arrive en phase 4 (FilesService)."),
        (270, "Notes", "Les notes Markdown par agent arrivent en phase 4 (NotesService)."),
    };

    public MainWindow()
    {
        InitializeComponent();

        // Jalon 3 : apparence persistée (appearance.json) appliquée DÈS le démarrage,
        // puis événements des contrôles Paramètres (délégés typés branchés en C#).
        _apparence = Aven.Bridge.AppearanceService.Load(Aven.Bridge.AppData.Dir());
        BrancherRéglages();
        ApplerApparence();

        Title = "Aven";
        // Taille par défaut 1200×800 CLAMPÉE à la zone de travail : sur ce poste
        // (1366×768, taskbar → 720 utiles) la fenêtre débordait sous l'écran et
        // coupait la carte Fichiers du hub — les 4 cartes doivent rester
        // entièrement visibles et cliquables.
        var zone = Microsoft.UI.Windowing.DisplayArea.GetFromWindowId(AppWindow.Id, Microsoft.UI.Windowing.DisplayAreaFallback.Nearest).WorkArea;
        var largeur = zone.Width > 0 ? Math.Min(1200, zone.Width) : 1200;
        var hauteur = zone.Height > 0 ? Math.Min(800, zone.Height) : 800;
        AppWindow.Resize(new SizeInt32(largeur, hauteur));
        if (zone.Width > 0 && zone.Height > 0)
        {
            var pos = AppWindow.Position;
            AppWindow.Move(new PointInt32(
                Math.Min(Math.Max(pos.X, zone.X), zone.X + zone.Width - largeur),
                Math.Min(Math.Max(pos.Y, zone.Y), zone.Y + zone.Height - hauteur)));
        }

        if (Microsoft.UI.Composition.SystemBackdrops.MicaController.IsSupported())
        {
            SystemBackdrop = new Microsoft.UI.Xaml.Media.MicaBackdrop();
        }

        ExtendsContentIntoTitleBar = true;
        SetTitleBar(null);

        PositionHubCards();
        CascaderEntreeDuHub();

        // Push-to-talk de la fenêtre : Ctrl+Maj+V (parité v8.8.0). Le hotkey OS
        // GLOBAL (option phase 6 actée) est enregistré juste dessous ; l'accélérateur
        // local reste en repli si le raccourci est déjà pris par un autre process.
        var ptt = new KeyboardAccelerator { Modifiers = Windows.System.VirtualKeyModifiers.Control | Windows.System.VirtualKeyModifiers.Shift, Key = Windows.System.VirtualKey.V };
        ptt.Invoked += (_, args) => { SurPushToTalk(); args.Handled = true; };
        TitleBar.KeyboardAccelerators.Add(ptt);

        // Raccourci OS GLOBAL : la dictée marche fenêtre Aven inactive. La fenêtre
        // porteuse est une message-only window du thread UI (pompe WinUI) — aucun
        // sous-classement de cette fenêtre. MOD_NOREPEAT : un appui maintenu ne
        // re-déclenche pas (comportement toggle push-to-talk).
        _hotkey = new Aven.Bridge.GlobalHotKey();
        _hotkey.Pressé += () => DispatcherQueue.TryEnqueue(SurPushToTalk);
        if (!_hotkey.Start(Aven.Bridge.GlobalHotKey.ModControl | Aven.Bridge.GlobalHotKey.ModShift
                           | Aven.Bridge.GlobalHotKey.ModNoRepeat, (uint)'V'))
            System.Diagnostics.Debug.WriteLine("Ctrl+Maj+V global déjà pris : l'accélérateur local reste actif.");
        Closed += (_, _) => _hotkey.Dispose();

        // ── Jalon 7 : notifications de bureau + tray + raccourci d'affichage ──
        // Focus suivi EN DIRECT (parité win.isFocused() d'Electron) : la politique
        // NotifyPolicy.ne toaste jamais quand l'utilisateur regarde déjà l'écran.
        _fenêtreActive = true;
        Activated += (_, args) =>
            _fenêtreActive = args.WindowActivationState != WindowActivationState.Deactivated;

        // Clic sur un toast → fenêtre au premier plan (parité n.on("click") → showWindow).
        // Le SDK notifie depuis un thread d'arrière-plan : rétroprojection obligatoire.
        Aven.Native.NotificationService.ClicSurToast += () => DispatcherQueue.TryEnqueue(MontrerFenêtre);

        // Fermeture = masquage vers le tray (parité window-all-closed : l'app reste en
        // arrière-plan, seul Quitter sort vraiment).
        AppWindow.Closing += (_, args) =>
        {
            if (_quitExplicite) return;
            args.Cancel = true;
            try { AppWindow.Hide(); } catch { /* jamais bloquant */ }
        };

        // Raccourci global Ctrl+Maj+O (parité CommandOrControl+Shift+O de main.ts).
        _hotkeyAfficher = new Aven.Bridge.GlobalHotKey();
        _hotkeyAfficher.Pressé += () => DispatcherQueue.TryEnqueue(MontrerFenêtre);
        if (!_hotkeyAfficher.Start(Aven.Bridge.GlobalHotKey.ModControl | Aven.Bridge.GlobalHotKey.ModShift
                                   | Aven.Bridge.GlobalHotKey.ModNoRepeat, (uint)'O'))
            System.Diagnostics.Debug.WriteLine("Ctrl+Maj+O global déjà pris : le tray reste la voie d'accès.");
        Closed += (_, _) => _hotkeyAfficher.Dispose();

        // Icône système (parité createTray) : Afficher / Quitter, clic gauche = afficher.
        _tray = new TrayIcon();
        _tray.AfficherDemandé += () => DispatcherQueue.TryEnqueue(MontrerFenêtre);
        _tray.QuitterDemandé += () => DispatcherQueue.TryEnqueue(Quitter);
        if (!_tray.Start())
            System.Diagnostics.Debug.WriteLine("tray indisponible : l'app fonctionne sans icône système.");
        Closed += (_, _) => _tray.Dispose();

        // Socle parité v10.0.0 : registre d'espaces (import du Classic à la 1re
        // exécution) puis boot du moteur au lancement — l'Electron fait pareil : le
        // chat est prêt dès le hub, l'état poll app:state est reflété en direct.
        _boot.StateChanged += état => DispatcherQueue.TryEnqueue(() => MajÉtat(état));
        Closed += (_, _) => { _ = _boot.DisposeAsync(); };
        _ = DémarrerApplicationAsync();
    }

    // ── Chat (phase 3) : VM locale ; le moteur/client appartiennent au BootService ──
    private Aven.Bridge.ChatViewModel? _chat;
    private bool _chatOuvert;   // une conversation est ouverte (jamais de 2e création auto)
    private bool _chatEnCours;  // création en vol (anti double-clic)
    private bool _chatBranche;  // abonnements UI posés UNE seule fois
    private string? _chatId;             // conversation ouverte (sidebar / récents)
    private string _chatAgent = "projet"; // agent de la conversation ouverte
    private bool _sidebarArchivées;      // bascule « voir les archivées » de la sidebar
    private string _sidebarFiltre = "";  // recherche courante dans la sidebar
    private string? _renommageId;        // conversation en cours de renommage inline
    private List<Aven.Bridge.ChatInfo> _sidebarChats = [];
    private List<Aven.Bridge.AgentInfo> _agentsTaches = [];
    private Aven.Bridge.ChatViewModel? _chatRendu; // VM à l'origine des bulles affichées
    private bool _filesOuvert, _notesOuvert;
    private string _filesRelative = "";
    private string? _filesApercuChemin;           // fichier en aperçu (cible « analyser »)
    private Aven.Bridge.Note? _noteOuverte;
    private List<string>? _noteNouvelleTags;      // étiquettes de la note EN CRÉATION (parité editingTags)
    private string? _notesTagFiltre;              // filtre par agent de la liste Notes (parité tagFilter)
    private bool _dialogOuvert;

    // ── Jalon 3 (parité SettingsDialog) : apparence persistée + garde anti-boucle ──
    private Aven.Bridge.AppearanceConfig _apparence = Aven.Bridge.AppearanceService.Defaut;
    private bool _majApparence; // Peupler* remplit les contrôles sans redéclencher les handlers
    private readonly Dictionary<string, PasswordBox> _boitesCles = new();

    // ── Terminal Freebuff (phase 5) : machine à états testée + ConPTY réel ────
    private Aven.Bridge.FreebuffTerminal? _terminal;
    private readonly StringBuilder _tamponBrut = new();
    private readonly List<string> _lignesBrutes = [];

    // ── Écran VT (décision §5.1) : WebView2 + xterm.js (même rendu que le web) ─
    private TerminalWebView? _écran; // créé paresseusement, réutilisé entre sessions
    private bool _écranActif = true; // défaut : TUI complet (parité vue terminal web)
    private (int Cols, int Rows) _dims = (Aven.Bridge.FreebuffTerminal.DefaultCols, Aven.Bridge.FreebuffTerminal.DefaultRows);

    // ── Socle parité v10.0.0 : registre d'espaces + clés + boot moteur ──────────
    private readonly Aven.Bridge.BootService _boot = new();
    private string? _espace;                       // espace actif (registre)
    private Aven.Bridge.EngineClient? _engineAnnoncé;

    // ── Voix (phase 6) : pipeline testé + capture micro + annonceur ──────────
    private Aven.Bridge.GlobalHotKey? _hotkey; // raccourci OS global Ctrl+Maj+V (décision phase 6)
    private Aven.Bridge.GlobalHotKey? _hotkeyAfficher; // raccourci OS global Ctrl+Maj+O (J7, parité Electron)
    private TrayIcon? _tray;                    // icône de tray système (J7)
    private bool _fenêtreActive;                // focus suivi via Window.Activated (J7)
    private bool _quitExplicite;                // Quitter() a ordonné la sortie (sinon fermeture = tray)
    private Aven.Bridge.EngineClient? _moteurNotifié; // garde anti double-abonnement notifications (J7)
    private readonly Dictionary<string, long> _départsTours = new(); // sessionID → TickCount64 (J7)
    private readonly object _verrouTours = new();
    private Aven.Bridge.VoicePipeline? _voixPipeline;
    private VoiceRuntime? _voix;
    private Aven.Bridge.Announcer? _annonceur;
    private string _modelLabel = "Auto";
    private readonly Queue<int> _fpsHistorique = new();
    private int _fpsCompteur;
    private DateTimeOffset _fpsFenêtre;

    private void PositionHubCards()
    {
        // Le hub entier est centré dans sa cellule : sinon la grille (et son
        // Ellipse 540×540 à taille explicite) reste calée en haut-gauche et les
        // cartes ne reposent plus sur l'anneau. Parité croix .home-hub web.
        HubView.HorizontalAlignment = HorizontalAlignment.Center;
        HubView.VerticalAlignment = VerticalAlignment.Center;
        Placer(CardProject, Cibles[0].AngleDeg);
        Placer(CardTasks, Cibles[1].AngleDeg);
        Placer(CardFiles, Cibles[2].AngleDeg);
        Placer(CardNotes, Cibles[3].AngleDeg);
    }

    private static void Placer(Button carte, double angleDeg)
    {
        // Centre la carte dans sa cellule AVANT la translation polaire : avec une
        // taille explicite (150×112) WinUI la pose en haut-gauche et la translation
        // part du coin — Notes (angle 270 → X = −250) sortait hors écran, inclicable.
        carte.HorizontalAlignment = HorizontalAlignment.Center;
        carte.VerticalAlignment = VerticalAlignment.Center;
        var rad = angleDeg * Math.PI / 180;
        // TranslateX/Y relatifs au centre (cartes centrées via Alignment + render transform).
        carte.RenderTransform = new TranslateTransform
        {
            X = Math.Cos(rad - Math.PI / 2) * Rayon,
            Y = Math.Sin(rad - Math.PI / 2) * Rayon,
        };
    }

    /// <summary>Cascade d'entrée (parité --stagger-i × 45 ms).</summary>
    private void CascaderEntreeDuHub()
    {
        var cartes = new[] { CardProject, CardTasks, CardFiles, CardNotes };
        for (var i = 0; i < cartes.Length; i++)
        {
            var transform = (TranslateTransform)cartes[i].RenderTransform;
            var animation = new DoubleAnimation
            {
                From = transform.Y + 26,
                To = transform.Y,
                Duration = new Duration(TimeSpan.FromMilliseconds(380)),
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
                BeginTime = TimeSpan.FromMilliseconds(i * 45),
            };
            var storyboard = new Storyboard();
            Storyboard.SetTarget(animation, cartes[i]);
            Storyboard.SetTargetProperty(animation, "(UIElement.RenderTransform).(TranslateTransform.Y)");
            storyboard.Children.Add(animation);
            storyboard.Begin();
        }
    }

    private void OnHubCard(object sender, RoutedEventArgs e)
    {
        if (sender is not Button carte || carte.Tag is not string index) return;
        if (index == "0") { OuvrirChat(carte); return; } // carte Projet = conversation réelle (phase 3)
        if (index == "1") { OuvrirTaches(carte); return; } // carte Tâches = page agents/modes (jalon 2)
        if (index == "2") { OuvrirFichiers(carte); return; } // carte Fichiers (phase 4)
        if (index == "3") { OuvrirNotes(carte); return; } // carte Notes (phase 4)
        var cible = Cibles[int.Parse(index)];
        PageTitle.Text = cible.Titre;
        PageHint.Text = cible.Hint;
        OuvrirPageDepuis(carte);
    }

    /// <summary>Flip hub → page : TOUTES les vues vivent dans PageView, donc chaque
    /// Ouvrir* DOIT passer d'abord par ici — sans ce flip la vue s'allume dans une
    /// page invisible (bug « presque aucun bouton n'est utilisable sauf Accueil »).
    /// Masque aussi toutes les vues (une seule visible à la fois).</summary>
    private void OuvrirPageDepuis(UIElement? source)
    {
        PageView.Visibility = Visibility.Visible;
        HubView.Visibility = Visibility.Collapsed;
        MasquerVues();
        PagePlaceholder.Visibility = Visibility.Visible; // repli générique (OnSettings le masque)
        RafraîchirBannières(); // les bannières d'état ne vivent que hors hub (parité)
        // Connected Animation (parité du shared element v9.7.0) : la source
        // (carte du hub, bouton Terminal/Paramètres) DEVIENT l'en-tête de la page.
        // JAMAIS de reset de _chatOuvert ici : revenir au hub puis re-ouvrir
        // Projet ne doit pas re-spawner le moteur (orphelins node).
        if (source is null) return; // relance depuis la voix : pas d'animation
        PageView.UpdateLayout();
        var animation = ConnectedAnimationService.GetForCurrentView().PrepareToAnimate("hub-card", source);
        animation.TryStart(PageTitle, new UIElement[] { PageHint });
    }

    private void OnHome(object sender, RoutedEventArgs e)
    {
        // Retour : la page cède sa place, le hub reprend sa cascade (parité goHome v9.7.1).
        HubView.Visibility = Visibility.Visible;
        PageView.Visibility = Visibility.Collapsed;
        CascaderEntreeDuHub();
        RafraîchirBannières(); // le hub n'affiche que sa pastille d'état
        RafraîchirAprèsChat(); // récents + sidebar fraîchis à chaque retour au hub
    }

    // ── Jalon 3 (parité SettingsDialog v9.3.0) : page Paramètres 3 onglets ─────────
    // Configuration (clés/notifications/diagnostic/priorités/espaces) | Apparence
    // (thème/accent/largeurs/affichages/voix) | Usage (statistiques agrégées).

    private void OnSettings(object sender, RoutedEventArgs e)
    {
        PageTitle.Text = "Paramètres";
        PageHint.Text = "Configuration, apparence et usage de l'application.";
        OuvrirPageDepuis(HomeButton);
        PagePlaceholder.Visibility = Visibility.Collapsed; // le panneau porte son contenu
        SettingsPanel.Visibility = Visibility.Visible;
        AfficherOngletParametres("config");
        PeuplerConfiguration();
        PeuplerApparence();
    }

    private void OnOngletParametres(object sender, RoutedEventArgs e)
    {
        if (sender is not Button bouton || bouton.Tag is not string onglet) return;
        AfficherOngletParametres(onglet);
    }

    private void AfficherOngletParametres(string onglet)
    {
        PanneauConfiguration.Visibility = onglet == "config" ? Visibility.Visible : Visibility.Collapsed;
        PanneauApparence.Visibility = onglet == "apparence" ? Visibility.Visible : Visibility.Collapsed;
        PanneauUsage.Visibility = onglet == "usage" ? Visibility.Visible : Visibility.Collapsed;
        // Onglet actif en surbrillance (parité .settings-tabs .selected).
        SurbrillerOnglet(OngletConfiguration, onglet == "config");
        SurbrillerOnglet(OngletApparence, onglet == "apparence");
        SurbrillerOnglet(OngletUsage, onglet == "usage");
        if (onglet == "usage") PeuplerUsage(); // rechargé à chaque ouverture (parité useEffect)
    }

    private void SurbrillerOnglet(Button bouton, bool actif)
    {
        bouton.Background = BrushDe(actif ? "AvenAccentBrush" : "AvenPanelSoftBrush");
        bouton.Foreground = actif ? new SolidColorBrush(Microsoft.UI.Colors.White) : BrushDe("AvenTextBrush");
        bouton.BorderBrush = BrushDe(actif ? "AvenAccentBrush" : "AvenBorderBrush");
    }

    /// <summary>Onglet Configuration (parité renderGeneral) : recharge tout l'état
    /// affiché depuis le BootService — clés, warnings, priorités, espaces, sync, versions.</summary>
    private void PeuplerConfiguration()
    {
        var état = _boot.State;

        // Clés API par fournisseur (parité state.providers + state.keys + keyWarnings).
        ClesListe.Children.Clear();
        _boitesCles.Clear();
        foreach (var fournisseur in Aven.Bridge.Providers.Liste)
            ClesListe.Children.Add(CarteClé(fournisseur, état));

        // Notifications (parité api.prefs → prefs.json).
        _majApparence = true;
        try
        {
            BasculeNotifications.IsOn = Aven.Bridge.SettingsService.Load(Aven.Bridge.AppData.Dir()).Notifications;
        }
        finally { _majApparence = false; }

        PrioritesTexte.Text = FormaterPriorites(état);

        EspacesListe.Children.Clear();
        foreach (var espace in _boot.ListerEspaces())
            EspacesListe.Children.Add(RangéeEspace(espace, état.Workspace));

        SyncTexte.Text = état.Sync.Count == 0
            ? "Aucun fichier de config signalé pour l'instant (le seed se fait au démarrage de l'espace)."
            : string.Join("\n", état.Sync.Select(s => "  " + s.File + " : " + LibelleSync(s.Status)));

        var version = "OpenCode " + (état.Version ?? "?") + " · CLI : " + (état.Cli ?? "?")
            + "\nDossier de travail actif : " + (état.Workspace ?? "?")
            + "\nAven " + AppVersion + " — natif WinUI 3 (WASDK 1.7)";
        if (état.Status == "error" && état.Error is not null) version += "\nMoteur : " + état.Error;
        if (état.VersionWarning is not null) version += "\n" + état.VersionWarning;
        if (état.NewModels.Count > 0)
            version += "\nNouveaux modèles ajoutés à ta table de priorités : " + string.Join(", ", état.NewModels);
        if (état.RemovedModels.Count > 0)
            version += "\nModèles payants retirés de cet espace : " + string.Join(", ", état.RemovedModels);
        SettingsVersion.Text = version;
    }

    /// <summary>Une carte clé par fournisseur (parité du champ .field du web) :</r
    /// statut, avertissement, saisie masquée + Enregistrer / Effacer / Obtenir une clé.</summary>
    private Border CarteClé(Aven.Bridge.ProviderInfo fournisseur, Aven.Bridge.AppModelState état)
    {
        var enregistrée = état.Keys.TryGetValue(fournisseur.Id, out var aClé) && aClé;
        var bloc = new StackPanel { Spacing = 6 };

        var titre = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        titre.Children.Add(new TextBlock
        {
            Text = fournisseur.Label,
            FontSize = 14,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = BrushDe("AvenTextBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        });
        if (enregistrée)
        {
            titre.Children.Add(new TextBlock
            {
                Text = "\u2713 clé enregistrée",
                FontSize = 12,
                Foreground = BrushDe("AvenSuccessBrush"),
                VerticalAlignment = VerticalAlignment.Center,
            });
        }
        bloc.Children.Add(titre);
        bloc.Children.Add(new TextBlock
        {
            Text = fournisseur.Note,
            FontSize = 12,
            TextWrapping = TextWrapping.Wrap,
            Foreground = BrushDe("AvenMutedBrush"),
        });
        if (état.KeyWarnings.TryGetValue(fournisseur.Id, out var avertissement))
        {
            bloc.Children.Add(new TextBlock
            {
                Text = avertissement,
                FontSize = 12,
                TextWrapping = TextWrapping.Wrap,
                Foreground = BrushDe("AvenDangerBrush"),
            });
        }

        var ligne = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var boite = new PasswordBox
        {
            PlaceholderText = enregistrée ? "Remplacer la clé…" : "Coller la clé…",
            Width = 240,
            MinHeight = 32,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _boitesCles[fournisseur.Id] = boite;
        ligne.Children.Add(boite);

        var enregistrer = new Button
        {
            Content = "Enregistrer",
            MinHeight = 32,
            Padding = new Thickness(12, 4, 12, 4),
            Background = BrushDe("AvenAccentBrush"),
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.White),
            IsEnabled = false,
            VerticalAlignment = VerticalAlignment.Center,
        };
        boite.PasswordChanged += (_, _) => enregistrer.IsEnabled = boite.Password.Trim().Length > 0;
        var id = fournisseur.Id;
        enregistrer.Click += async (_, _) => await EnregistrerCléAsync(id, boite.Password);
        ligne.Children.Add(enregistrer);

        if (enregistrée)
        {
            var effacer = new Button
            {
                Content = "Effacer",
                MinHeight = 32,
                Padding = new Thickness(12, 4, 12, 4),
                Background = BrushDe("AvenPanelSoftBrush"),
                Foreground = BrushDe("AvenDangerBrush"),
                VerticalAlignment = VerticalAlignment.Center,
            };
            effacer.Click += async (_, _) => await EnregistrerCléAsync(id, "");
            ligne.Children.Add(effacer);
        }

        var obtenir = new Button
        {
            Content = "Obtenir une clé",
            MinHeight = 32,
            Padding = new Thickness(12, 4, 12, 4),
            Background = BrushDe("AvenPanelSoftBrush"),
            Foreground = BrushDe("AvenTextBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        obtenir.Click += async (_, _) =>
        {
            try { await Windows.System.Launcher.LaunchUriAsync(new Uri(fournisseur.Url)); }
            catch (Exception erreur) { EspaceErreur.Text = erreur.Message; }
        };
        ligne.Children.Add(obtenir);
        bloc.Children.Add(ligne);

        return new Border
        {
            CornerRadius = new CornerRadius(12),
            Background = BrushDe("AvenPanelBrush"),
            BorderBrush = BrushDe("AvenBorderBrush"),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(14, 10, 14, 10),
            Child = bloc,
        };
    }

    /// <summary>Sauvegarde/efface une clé puis relance le boot (parité api.setKey :
    /// le main relit les clés et redémarre le moteur pour prendre l'env à jour).</summary>
    private async Task EnregistrerCléAsync(string id, string cle)
    {
        try
        {
            EspaceErreur.Text = "";
            Aven.Bridge.KeysService.Save(Aven.Bridge.AppData.Dir(), id, cle.Trim());
            if (_boitesCles.TryGetValue(id, out var boite)) boite.Password = "";
            if (_espace is not null) await _boot.BootAsync(_espace);
            PeuplerConfiguration();
        }
        catch (Exception erreur) { EspaceErreur.Text = erreur.Message; }
    }

    private static string FormaterPriorites(Aven.Bridge.AppModelState état)
    {
        var lignes = new List<string>();
        if (état.Warning is not null) lignes.Add("Table de priorités : " + état.Warning);
        if (état.Assignments is JsonObject obj && obj.Count > 0)
        {
            foreach (var (agent, noeud) in obj)
            {
                var chaine = (noeud as JsonArray ?? [])
                    .Select(m => Aven.Bridge.JsonAide.Texte(m, "label") ?? Aven.Bridge.JsonAide.Texte(m, "ref") ?? "")
                    .Where(s => s.Length > 0)
                    .ToList();
                if (chaine.Count == 0)
                {
                    lignes.Add(agent + " : aucun modèle disponible");
                    continue;
                }
                var cinq = string.Join("  \u2192  ", chaine.Take(5).Select((l, i) => (i + 1) + ". " + l));
                lignes.Add(agent + " : " + cinq + (chaine.Count > 5 ? "  (+" + (chaine.Count - 5) + ")" : ""));
            }
        }
        else if (lignes.Count == 0)
        {
            lignes.Add("Moteur non démarré — les priorités apparaîtront ici au boot.");
        }
        return string.Join("\n", lignes);
    }

    private static string LibelleSync(string status) => status switch
    {
        "created" => "créé",
        "updated" => "mis à jour automatiquement (tu ne l'avais pas modifié)",
        "unchanged" => "à jour",
        "custom" => "personnalisé — laissé tel quel",
        _ => status,
    };

    /// <summary>Une ligne d'espace : nom (actif en surbrillance) + chemin + Utiliser /
    /// Retirer — parité de la liste workspaces du web.</summary>
    private Border RangéeEspace(Aven.Bridge.WorkspaceEntry espace, string? actif)
    {
        var estActif = actif is not null &&
            string.Equals(Path.GetFullPath(espace.Path), Path.GetFullPath(actif), StringComparison.OrdinalIgnoreCase);
        var ligne = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var infos = new StackPanel { Spacing = 2 };
        infos.Children.Add(new TextBlock
        {
            Text = (estActif ? "\u25CF " : "") + espace.Name,
            FontSize = 13,
            FontWeight = estActif ? Microsoft.UI.Text.FontWeights.SemiBold : Microsoft.UI.Text.FontWeights.Normal,
            Foreground = BrushDe(estActif ? "AvenAccentBrush" : "AvenTextBrush"),
        });
        infos.Children.Add(new TextBlock
        {
            Text = espace.Path,
            FontSize = 11,
            Foreground = BrushDe("AvenMutedBrush"),
        });
        ligne.Children.Add(infos);

        if (!estActif)
        {
            var utiliser = new Button
            {
                Content = "Utiliser",
                MinHeight = 30,
                Padding = new Thickness(12, 4, 12, 4),
                Background = BrushDe("AvenPanelSoftBrush"),
                Foreground = BrushDe("AvenTextBrush"),
                VerticalAlignment = VerticalAlignment.Center,
            };
            var chemin = espace.Path;
            utiliser.Click += (_, _) => ActiverEspace(chemin);
            ligne.Children.Add(utiliser);
        }

        var retirer = new Button
        {
            Content = "Retirer de la liste",
            MinHeight = 30,
            Padding = new Thickness(12, 4, 12, 4),
            Background = BrushDe("AvenPanelSoftBrush"),
            Foreground = BrushDe("AvenDangerBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        var àRetirer = espace.Path;
        retirer.Click += (_, _) => RetirerEspace(àRetirer);
        ligne.Children.Add(retirer);

        return new Border
        {
            CornerRadius = new CornerRadius(10),
            Background = BrushDe("AvenPanelBrush"),
            BorderBrush = BrushDe("AvenBorderBrush"),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(12, 8, 12, 8),
            Child = ligne,
        };
    }

    /// <summary>Retirer un espace (parité removeWs) : le dernier retiré ramène à
    /// l'écran de choix (aucun dossier n'est créé à ta place), sinon l'espace actif
    /// parti cède la place au premier restant.</summary>
    private void RetirerEspace(string chemin)
    {
        try
        {
            var dataDir = Aven.Bridge.AppData.Dir();
            var restantes = Aven.Bridge.WorkspacesService.Remove(dataDir, chemin);
            if (restantes.Count == 0)
            {
                _espace = null;
                _boot.PublierBesoinEspace();
                SettingsPanel.Visibility = Visibility.Collapsed;
                AfficherChoixEspace(true);
                return;
            }
            if (_boot.ActiveWorkspace() is null)
                ActiverEspace(restantes[0].Path); // l'espace actif partait : on en choisit un autre
            PeuplerConfiguration();
        }
        catch (Exception erreur) { EspaceErreur.Text = erreur.Message; }
    }

    private async void OnParamCreerEspace(object sender, RoutedEventArgs e) => await ChoisirEspaceAsync(creer: true);

    private async void OnParamOuvrirEspace(object sender, RoutedEventArgs e) => await ChoisirEspaceAsync(creer: false);

    /// <summary>Diagnostic copiable (parité api.diagnostic) : un JSON lisible SANS
    /// aucune clé API — la rédaction de Diagnostic.Build passe sur le document entier.</summary>
    private void OnDiagnostic(object sender, RoutedEventArgs e)
    {
        try
        {
            var état = _boot.State;
            var texte = Aven.Bridge.Diagnostic.Build(new Aven.Bridge.DiagnosticInput(
                Versions: new Dictionary<string, string?>
                {
                    ["app"] = AppVersion,
                    ["os"] = Environment.OSVersion.VersionString,
                    ["dotnet"] = Environment.Version.ToString(),
                },
                Platform: Environment.OSVersion.Platform + "-" + System.Runtime.InteropServices.RuntimeInformation.OSArchitecture,
                Status: état.Status + (état.Error is null ? "" : " — " + état.Error),
                OpencodeVersion: état.Version,
                Cli: état.Cli,
                // Jamais de VALEUR de clé : seulement les ids des providers présents.
                KeyIds: état.Keys.Where(kv => kv.Value).Select(kv => kv.Key).ToList(),
                Assignments: état.Assignments,
                Warning: état.Warning ?? état.VersionWarning,
                KeyWarnings: état.KeyWarnings,
                Workspace: état.Workspace,
                Workspaces: _boot.ListerEspaces().Select(w => w.Path).ToList(),
                Log:
                [
                    "status=" + état.Status,
                    "sync=" + string.Join(",", état.Sync.Select(s => s.File + ":" + s.Status)),
                    "newModels=" + string.Join(",", état.NewModels),
                ]));
            var paquet = new Windows.ApplicationModel.DataTransfer.DataPackage();
            paquet.SetText(texte);
            Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(paquet);
            try { Windows.ApplicationModel.DataTransfer.Clipboard.Flush(); } catch { /* best effort */ }
            DiagnosticEtat.Text = "Diagnostic copié (sans aucune clé API).";
        }
        catch (Exception erreur) { DiagnosticEtat.Text = erreur.Message; }
    }

    /// <summary>Onglet Usage (parité renderUsage) : mêmes agrégats que l'Electron
    /// (compteurs = conversations par modèle, agentIds = les 4 onglets).</summary>
    private async void PeuplerUsage()
    {
        UsageStats.Children.Clear();
        UsageEtat.Text = "Chargement…";
        try
        {
            var espace = _espace ?? "";
            var note = "";
            var chats = new List<Aven.Bridge.ChatInfo>();
            if (_boot.Client is not null && espace.Length > 0)
            {
                try
                {
                    chats = (await _boot.Client.ListChatsAsync(espace, agent: null, includeArchived: true)).ToList();
                }
                catch (Exception erreur) { note = "Moteur indisponible : " + erreur.Message; }
            }
            var dictations = espace.Length > 0
                ? Aven.Bridge.StatsSqlite.ReadDictationStats(espace)
                : new Aven.Bridge.DictationStats(0, "", 0);
            var compteurs = chats.Where(c => c.Model is not null)
                .GroupBy(c => c.Model!)
                .ToDictionary(g => g.Key, g => (long)g.Count());
            var payload = new Aven.Bridge.StatsService.StatsPayload(
                chats.Select(c => new Aven.Bridge.StatsService.ChatLite(c.Id, c.Agent, c.Archived)).ToList(),
                dictations,
                compteurs);
            var agrégé = Aven.Bridge.StatsService.Aggregate(payload, Aven.Bridge.ConversationClient.Tabs);

            AjouterTuile(UsageStats, agrégé.TotalChats.ToString(), "conversations actives");
            AjouterTuile(UsageStats, agrégé.ArchivedChats.ToString(), "archivées");
            AjouterTuile(UsageStats, agrégé.DictationsTotal.ToString(),
                "dictées (" + agrégé.DictationsToday + " aujourd'hui)");
            foreach (var (agent, compte) in agrégé.PerAgent)
                AjouterTuile(UsageStats, compte.ToString(), "conversations · " + NomAgent(agent));
            if (agrégé.TopModels.Count > 0)
            {
                AjouterTuile(UsageStats,
                    string.Join(" · ", agrégé.TopModels.Select(m => m.Model + " (" + m.Count + ")")),
                    "modèles les plus utilisés");
            }
            UsageEtat.Text = note;
        }
        catch (Exception erreur)
        {
            UsageEtat.Text = "Stats indisponibles : " + erreur.Message;
        }
    }

    private void AjouterTuile(StackPanel conteneur, string valeur, string libelle)
    {
        var ligne = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        ligne.Children.Add(new TextBlock
        {
            Text = valeur,
            FontSize = 20,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = BrushDe("AvenAccentBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        });
        ligne.Children.Add(new TextBlock
        {
            Text = libelle,
            FontSize = 13,
            TextWrapping = TextWrapping.Wrap,
            Foreground = BrushDe("AvenMutedBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        });
        conteneur.Children.Add(new Border
        {
            CornerRadius = new CornerRadius(12),
            Background = BrushDe("AvenPanelBrush"),
            BorderBrush = BrushDe("AvenBorderBrush"),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(14, 10, 14, 10),
            Child = ligne,
        });
    }

    private void OnUsageActualiser(object sender, RoutedEventArgs e) => PeuplerUsage();

    // ── Onglet Apparence : thème/accent/largeurs appliqués EN DIRECT à la fenêtre ────

    private void OnChoisirTheme(object sender, RoutedEventArgs e)
    {
        if (_majApparence || sender is not Button bouton || bouton.Tag is not string theme) return;
        _apparence = _apparence with { Theme = theme };
        EnregistrerApparence();
    }

    private void OnChoisirAccent(object sender, RoutedEventArgs e)
    {
        if (_majApparence || sender is not Button bouton || bouton.Tag is not string accent) return;
        _apparence = _apparence with { Accent = accent };
        EnregistrerApparence();
    }

    private void OnResetApparence(object sender, RoutedEventArgs e)
    {
        if (_majApparence) return;
        _apparence = Aven.Bridge.AppearanceService.Defaut;
        EnregistrerApparence();
        ApparenceEtat.Text = "Réglages réinitialisés.";
    }

    /// <summary>Parité api.announcerTest : la voix SE PARLE quel que soit l'état de
    /// l'opt-in (c'est le test qui doit convaincre de l'activer).</summary>
    private void OnTesterVoix(object sender, RoutedEventArgs e) =>
        _ = ParlerAsync("Annonce vocale activée. Les événements des agents seront annoncés.");

    /// <summary>Test de voix : parle TOUJOURS (même opt-in off) — même comportement
    /// que api.announcerTest côté web.</summary>
    private async Task ParlerAsync(string texte)
    {
        try
        {
            var sûr = texte.Replace("'", "''");
            await ExécuterPowerShell(
                $"Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('{sûr}')");
        }
        catch (Exception erreur) { ApparenceEtat.Text = erreur.Message; }
    }

    /// <summary>Branche les événements des contrôles Paramètres : délégés typés en C#
    /// (Slider/ColorPicker/ToggleSwitch — signatures d'événements non garantis côté XAML).
    /// Appelé UNE fois au ctor, après InitializeComponent.</summary>
    private void BrancherRéglages()
    {
        BasculeNotifications.Toggled += (_, _) =>
        {
            if (_majApparence) return;
            try
            {
                Aven.Bridge.SettingsService.SaveNotifications(Aven.Bridge.AppData.Dir(), BasculeNotifications.IsOn);
            }
            catch (Exception erreur) { EspaceErreur.Text = erreur.Message; }
        };
        CurseurLargeurSidebar.ValueChanged += (_, _) =>
        {
            if (_majApparence) return;
            _apparence = _apparence with { SidebarWidth = (int)Math.Round(CurseurLargeurSidebar.Value) };
            EnregistrerApparence();
        };
        CurseurLargeurMessages.ValueChanged += (_, _) =>
        {
            if (_majApparence) return;
            _apparence = _apparence with { MessageWidth = (int)Math.Round(CurseurLargeurMessages.Value) };
            EnregistrerApparence();
        };
        ChoixCouleur.ColorChanged += (_, _) =>
        {
            if (_majApparence) return;
            _apparence = _apparence with { Accent = "custom", CustomAccent = ColorVersHex(ChoixCouleur.Color) };
            EnregistrerApparence();
        };
        BasculeSidebar.Toggled += (_, _) => MajBascule("sidebar", BasculeSidebar.IsOn);
        BasculeModele.Toggled += (_, _) => MajBascule("model", BasculeModele.IsOn);
        BasculeCompositeur.Toggled += (_, _) => MajBascule("composer", BasculeCompositeur.IsOn);
        BasculeGroupement.Toggled += (_, _) => MajBascule("group", BasculeGroupement.IsOn);
        BasculeVoix.Toggled += (_, _) => MajBascule("voice", BasculeVoix.IsOn);
    }

    private void MajBascule(string cle, bool valeur)
    {
        if (_majApparence) return;
        _apparence = cle switch
        {
            "sidebar" => _apparence with { ShowSidebar = valeur },
            "model" => _apparence with { ShowModel = valeur },
            "composer" => _apparence with { ShowComposer = valeur },
            "group" => _apparence with { ChatsGroupedByAgent = valeur },
            "voice" => _apparence with { VoiceAnnouncements = valeur },
            _ => _apparence,
        };
        EnregistrerApparence();
        if (cle == "group") ConstruireSidebar(); // regroupement appliqué immédiatement
    }

    /// <summary>Sauvegarde (appearance.json compact atomique) puis application EN DIRECT
    /// + resynchronisation des contrôles (parité updateAppearance du hook web).</summary>
    private void EnregistrerApparence()
    {
        try { _apparence = Aven.Bridge.AppearanceService.Save(Aven.Bridge.AppData.Dir(), _apparence); }
        catch (Exception erreur) { ApparenceEtat.Text = "Sauvegarde impossible : " + erreur.Message; }
        ApplerApparence();
        if (SettingsPanel.Visibility == Visibility.Visible) PeuplerApparence();
    }

    /// <summary>Applique l'apparence à la fenêtre (parité useAppearance : dataset.theme,
    /// --accent, --sidebar-width, --message-width + visibilités d'interface).</summary>
    private void ApplerApparence()
    {
        _majApparence = true;
        try
        {
            // Thème : la racine est la source unique ; « system » = thème de Windows.
            Racine.RequestedTheme = _apparence.Theme switch
            {
                "dark" => ElementTheme.Dark,
                "light" => ElementTheme.Light,
                _ => ElementTheme.Default,
            };

            // Accent (parité --accent) : couleur partagée + brushes dérivées
            // (Soft = accent à 8 %, Border = accent à 30 % — comme le color-mix CSS).
            var couleur = HexVersColor(Aven.Bridge.AppearanceService.CouleurAccent(_apparence));
            Application.Current.Resources["AvenAccentColor"] = couleur;
            RemplacerBrush("AvenAccentBrush", couleur, 0xFF);
            RemplacerBrush("AvenAccentSoftBrush", couleur, 0x14);
            RemplacerBrush("AvenAccentBorderBrush", couleur, 0x4D);

            // Largeurs (parité --sidebar-width / --message-width).
            ChatSidebar.Width = _apparence.SidebarWidth;
            ChatRows.MaxWidth = _apparence.MessageWidth;

            // Éléments de l'interface (parité show*).
            ModelButton.Visibility = _apparence.ShowModel ? Visibility.Visible : Visibility.Collapsed;
            if (ChatScroll.Visibility == Visibility.Visible)
            {
                ChatSidebar.Visibility = _apparence.ShowSidebar ? Visibility.Visible : Visibility.Collapsed;
                ComposerBar.Visibility = _apparence.ShowComposer ? Visibility.Visible : Visibility.Collapsed;
            }

            // Opt-in vocal (v8.7.9) : le réglage suit l'annonceur, créé au boot.
            _annonceur?.SetEnabled(_apparence.VoiceAnnouncements);
        }
        finally { _majApparence = false; }
    }

    private static void RemplacerBrush(string cle, Windows.UI.Color baseColor, byte alpha)
    {
        var couleur = alpha == 0xFF
            ? baseColor
            : Windows.UI.Color.FromArgb(alpha, baseColor.R, baseColor.G, baseColor.B);
        if (Application.Current.Resources[cle] is SolidColorBrush pinceau)
        {
            try { pinceau.Color = couleur; return; } // instance partagée : tout l'écran suit
            catch (InvalidOperationException) { /* ressource gelée : on remplace l'entrée */ }
        }
        Application.Current.Resources[cle] = new SolidColorBrush(couleur);
    }

    /// <summary>Remplit les contrôles de l'onglet Apparence sans redéclencher les
    /// handlers (garde _majApparence) — parité du rendu depuis l'état.</summary>
    private void PeuplerApparence()
    {
        _majApparence = true;
        try
        {
            CurseurLargeurSidebar.Value = _apparence.SidebarWidth;
            CurseurLargeurMessages.Value = _apparence.MessageWidth;
            EtiquetteLargeurSidebar.Text = "Largeur de la barre latérale  " + _apparence.SidebarWidth + "px";
            EtiquetteLargeurMessages.Text = "Largeur des messages  " + _apparence.MessageWidth + "px";
            BasculeSidebar.IsOn = _apparence.ShowSidebar;
            BasculeModele.IsOn = _apparence.ShowModel;
            BasculeCompositeur.IsOn = _apparence.ShowComposer;
            BasculeGroupement.IsOn = _apparence.ChatsGroupedByAgent;
            BasculeVoix.IsOn = _apparence.VoiceAnnouncements;
            SurbrillerOnglet(BoutonThemeClair, _apparence.Theme == "light");
            SurbrillerOnglet(BoutonThemeSysteme, _apparence.Theme == "system");
            SurbrillerOnglet(BoutonThemeSombre, _apparence.Theme == "dark");
            SurbrillerOnglet(BoutonAccentViolet, _apparence.Accent == "violet");
            SurbrillerOnglet(BoutonAccentBleu, _apparence.Accent == "blue");
            SurbrillerOnglet(BoutonAccentEmeraude, _apparence.Accent == "emerald");
            SurbrillerOnglet(BoutonAccentRose, _apparence.Accent == "rose");
            SurbrillerOnglet(BoutonAccentAmbre, _apparence.Accent == "amber");
            SurbrillerOnglet(BoutonAccentPerso, _apparence.Accent == "custom");
            ChoixCouleur.Visibility = _apparence.Accent == "custom" ? Visibility.Visible : Visibility.Collapsed;
            try { ChoixCouleur.Color = HexVersColor(_apparence.CustomAccent); }
            catch (FormatException) { /* hex déjà sanitisé par le service */ }
        }
        finally { _majApparence = false; }
    }

    private static Windows.UI.Color HexVersColor(string hex)
    {
        var s = hex.TrimStart('#');
        return Windows.UI.Color.FromArgb(255,
            Convert.ToByte(s.Substring(0, 2), 16),
            Convert.ToByte(s.Substring(2, 2), 16),
            Convert.ToByte(s.Substring(4, 2), 16));
    }

    private static string ColorVersHex(Windows.UI.Color couleur) =>
        "#" + couleur.R.ToString("x2") + couleur.G.ToString("x2") + couleur.B.ToString("x2");

    // ── Socle parité v10.0.0 : démarrage, registre d'espaces, bannières ──────────

    /// <summary>Registre (import du Classic à la première exécution) puis, si un
    /// espace est déjà choisi, boot du moteur — sinon écran de choix (parité v9.1.5 :
    /// aucun espace n'est imposé, le moteur ne démarre jamais sur un dossier vide).</summary>
    private async Task DémarrerApplicationAsync()
    {
        try
        {
            _boot.ListerEspaces(); // import initial du registre Electron (une fois)
            var actif = _boot.ActiveWorkspace();
            if (actif is null)
            {
                _boot.PublierBesoinEspace();
                AfficherChoixEspace(true);
                return;
            }
            _espace = actif.Path;
            AfficherChoixEspace(false);
            await _boot.BootAsync(actif.Path);
        }
        catch (Exception erreur)
        {
            // Jamais de crash au démarrage : l'état d'erreur vit dans les bannières.
            System.Diagnostics.Debug.WriteLine("boot : " + erreur.Message);
        }
    }

    /// <summary>Reflet de l'état moteur dans la fenêtre : pastille d'état, nom de
    /// l'espace, bannières, annonceur branché dès que le host est prêt.</summary>
    private void MajÉtat(Aven.Bridge.AppModelState état)
    {
        var enLigne = état.Status == "ready";
        StatusBarre.Text = enLigne ? "En ligne" : état.Status == "error" ? "Indisponible" : "Démarrage";
        StatusDot.Fill = BrushDe(enLigne ? "AvenSuccessBrush"
            : état.Status == "error" ? "AvenDangerBrush" : "AvenWarningBrush");
        HubWorkspace.Text = NomEspace(état.Workspace ?? _espace);
        if (état.Status == "error")
            StatusBannerText.Text = "Aven n'a pas démarré. " + (état.Error ?? "");
        else if (état.Status == "starting")
            StatusBannerText.Text = "Démarrage d'Aven…";
        if (état.Status == "ready" && _boot.Engine is { } moteur)
        {
            BrancherAnnonceur(moteur); // parité : les événements sont annoncés/relayés dès le boot
            _ = RafraîchirRecentsAsync(); // hub enrichi : les récents arrivent avec le moteur
        }
        RafraîchirBannières();
    }

    private static string NomEspace(string? chemin)
    {
        if (string.IsNullOrWhiteSpace(chemin)) return "Espace de travail";
        var propre = chemin.TrimEnd('\\', '/');
        var nom = Path.GetFileName(propre);
        return nom.Length > 0 ? nom : propre;
    }

    /// <summary>Bannières d'état visibles UNIQUEMENT hors hub (le hub n'affiche que
    /// sa pastille) — appelé à chaque navigation et à chaque changement d'état.</summary>
    private void RafraîchirBannières()
    {
        var état = _boot.State;
        var horsHub = PageView.Visibility == Visibility.Visible && ChoixEspace.Visibility != Visibility.Visible;
        var étatVisible = horsHub && !état.NeedsWorkspace &&
            (état.Status == "error" || (état.Status == "starting" && _espace is not null));
        StatusBanner.Visibility = étatVisible ? Visibility.Visible : Visibility.Collapsed;
        var sansClé = horsHub && état.Status == "ready" && !état.Keys.Values.Any(v => v);
        NoKeyBanner.Visibility = sansClé ? Visibility.Visible : Visibility.Collapsed;
    }

    // ── Écran de choix d'espace (parité v9.1.5) ──────────────────────────────

    private void AfficherChoixEspace(bool afficher)
    {
        ChoixEspace.Visibility = afficher ? Visibility.Visible : Visibility.Collapsed;
        if (!afficher) return;
        ChoixErreur.Text = "";
        ChoixEspaceListe.Children.Clear();
        foreach (var espace in _boot.ListerEspaces())
        {
            var chemin = espace.Path;
            var bouton = new Button
            {
                Content = espace.Name + "  -  " + espace.Path,
                HorizontalAlignment = HorizontalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Left,
                MinHeight = 40,
                Background = BrushDe("AvenPanelBrush"),
                BorderBrush = BrushDe("AvenBorderBrush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(10),
                Foreground = BrushDe("AvenTextBrush"),
            };
            bouton.Click += (_, _) => ActiverEspace(chemin);
            ChoixEspaceListe.Children.Add(bouton);
        }
    }

    private async void ActiverEspace(string chemin)
    {
        try
        {
            Aven.Bridge.WorkspacesService.SetActive(Aven.Bridge.AppData.Dir(), chemin);
            _espace = chemin;
            AfficherChoixEspace(false);
            await _boot.BootAsync(chemin);
        }
        catch (Exception erreur) { ChoixErreur.Text = erreur.Message; }
    }

    private async void OnChoixCreer(object sender, RoutedEventArgs e) => await ChoisirEspaceAsync(creer: true);

    private async void OnChoixOuvrir(object sender, RoutedEventArgs e) => await ChoisirEspaceAsync(creer: false);

    /// <summary>Sélecteur Windows de dossier (parité workspace:createNew / addExisting) :
    /// annulation = aucun changement ; création = validation du nom + anti-doublon.</summary>
    private async Task ChoisirEspaceAsync(bool creer)
    {
        try
        {
            var chemin = await ChoisirDossierAsync(creer
                ? "Nouvel espace de travail — choisis ou crée son dossier"
                : "Choisir un dossier de travail");
            if (chemin is null) return; // annulé : aucun changement (parité v9.0.0)
            var dataDir = Aven.Bridge.AppData.Dir();
            var propre = Path.GetFullPath(chemin);
            var nom = Path.GetFileName(propre.TrimEnd('\\', '/'));
            if (creer)
            {
                Aven.Bridge.WorkspacesService.ValidateName(nom);
                if (Aven.Bridge.WorkspacesService.List(dataDir).Any(w => Path.GetFullPath(w.Path) == propre))
                    throw new InvalidOperationException("Ce dossier fait déjà partie des espaces de travail connus.");
            }
            Aven.Bridge.WorkspacesService.Register(dataDir, propre, nom);
            Aven.Bridge.WorkspacesService.SetActive(dataDir, propre);
            _espace = propre;
            AfficherChoixEspace(false);
            await _boot.BootAsync(propre);
        }
        catch (Exception erreur) { ChoixErreur.Text = erreur.Message; }
    }

    private async Task<string?> ChoisirDossierAsync(string _titre)
    {
        // FolderPicker de ce TFM n'expose pas Title (CS0117) : le libellé vit dans
        // l'écran ChoixEspace, le sélecteur garde son chemin par défaut (Bureau).
        var picker = new Windows.Storage.Pickers.FolderPicker
        {
            SuggestedStartLocation = Windows.Storage.Pickers.PickerLocationId.Desktop,
        };
        picker.FileTypeFilter.Add("*"); // requis par FolderPicker (aucun filtre réel)
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        WinRT.Interop.InitializeWithWindow.Initialize(picker, hwnd);
        var dossier = await picker.PickSingleFolderAsync();
        return dossier?.Path;
    }

    // ── Chat réel (phase 3) — voir ChatViewModel (Aven.Bridge), testé sans WinUI ──

    private void OuvrirChat(UIElement? source = null)
    {
        PageTitle.Text = "Projet";
        PageHint.Text = "Conversation avec l'agent central (Freebuff)";
        OuvrirPageDepuis(source); // flip hub → page AVANT d'allumer la vue
        // Garde anti re-spawn : le chat ne crée sa conversation qu'UNE fois. Un
        // échec (moteur indisponible) autorise un nouvel essai SANS nouveau process :
        // le host appartient au BootService, jamais relancé par le chat.
        if (!_chatOuvert && !_chatEnCours)
        {
            _chatEnCours = true;
            _ = DémarrerChat();
        }
        ChatScroll.Visibility = Visibility.Visible;
        ComposerBar.Visibility = _apparence.ShowComposer ? Visibility.Visible : Visibility.Collapsed;
        ChatSidebar.Visibility = _apparence.ShowSidebar ? Visibility.Visible : Visibility.Collapsed; // réglage Apparence (défaut : suit la conversation)
        _ = RafraîchirSidebarAsync();
        Composer.Focus(FocusState.Programmatic);
    }

    private async Task DémarrerChat(string agent = "projet")
    {
        // Le boot (registre + clés + seed + initialize) part au lancement : le chat
        // attend SA FIN — sans initialize, session.create échouerait (« OpenCode
        // n'est pas prêt »). Cœur de la parité v10.0.0 (jalon espaces/clés).
        Aven.Bridge.AppModelState état;
        try { état = await _boot.AttendreAsync(TimeSpan.FromSeconds(60)); }
        catch { état = _boot.State; }

        if (état.Status != "ready" || _boot.Client is null || string.IsNullOrEmpty(_espace))
        {
            _chatEnCours = false;
            PageHint.Text = "Moteur indisponible : " + (état.Error
                ?? (état.NeedsWorkspace ? "choisis d'abord un espace de travail."
                : "démarrage en cours — réessaie dans un instant."));
            return;
        }

        var client = _boot.Client;
        _chatAgent = agent;
        _chat = new Aven.Bridge.ChatViewModel(client, _espace,
            marshal: action => DispatcherQueue.TryEnqueue(() => action()));
        _chat.PropertyChanged += (_, _) => SynchroniserChat();

        // Conversation créée à la volée (la relecture des anciens chats vit dans la
        // sidebar). On n'attache le VM qu'APRÈS : les événements d'une autre session
        // seraient filtrés comme « child ».
        try
        {
            var ouverte = await _chat.CreateChatAsync(agent);
            _chat.Attach(ouverte.Id);
            _chatId = ouverte.Id;
            PageHint.Text = $"Conversation {ouverte.Model}";
        }
        catch (Exception erreur)
        {
            _chatEnCours = false;
            PageHint.Text = "Moteur indisponible : " + erreur.Message;
            return;
        }

        _chatOuvert = true;
        _chatEnCours = false;
        AssurerBranchementsChat(client);
        RafraîchirAprèsChat(); // sidebar + récents fraîchis à chaque conversation créée
        SynchroniserChat();
    }

    /// <summary>Câblages FENÊTRE du chat (follow-bottom, Échap, frames, Live) posés UNE
    /// seule fois — extraits de DémarrerChat pour être partagés avec l'ouverture d'une
    /// conversation existante (sidebar / récents), qui ne passe pas par une création.</summary>
    private void AssurerBranchementsChat(Aven.Bridge.ConversationClient client)
    {
        if (_chatBranche) return;
        _chatBranche = true;

        // Follow-bottom : l'utilisateur re-arme en revenant au bas (parité « Dernier message »).
        ChatScroll.ViewChanged += (_, _) =>
        {
            if (_chat is { } c)
                c.FollowBottom = ChatScroll.VerticalOffset + ChatScroll.ViewportHeight >= ChatScroll.ExtentHeight - 40;
        };

        // Échap = Arrêter (parité v9.7 : raccourci global du tour en cours).
        var échap = new Microsoft.UI.Xaml.Input.KeyboardAccelerator { Key = Windows.System.VirtualKey.Escape };
        échap.Invoked += (_, args) =>
        {
            if (_chat?.Live.Busy == true)
            {
                ArrêterTour();
                args.Handled = true;
            }
        };
        TitleBar.KeyboardAccelerators.Add(échap);

        // Mesure brute pour l'acceptation « 60 fps » : frames comptées pendant les
        // tours (fenêtres d'une seconde, 30 s glissantes affichées dans le hint).
        Microsoft.UI.Xaml.Media.CompositionTarget.Rendering += SurFrame;

        // Live → lignes : les événements du moteur arrivent sur le thread de lecture,
        // la réconciliation d'arbre doit passer par l'interface.
        client.LiveChanged += _ => DispatcherQueue.TryEnqueue(SynchroniserChat);
    }

    private void RafraîchirAprèsChat()
    {
        _ = RafraîchirSidebarAsync();
        _ = RafraîchirRecentsAsync();
    }

    // ── Jalon 2 (parité v10) : sidebar conversations, récents du hub, page Tâches ──

    /// <summary>Ouvre une conversation EXISTANTE (clic sidebar, récents du hub ou
    /// « dernière conversation » d'un mode) — parité openConversation du web.</summary>
    private async void OuvrirConversation(string chatId, string agent, UIElement? source = null)
    {
        if (_espace is null || _boot.Client is null) return;
        if (source is not null || PageView.Visibility != Visibility.Visible)
            OuvrirPageDepuis(source); // flip si on vient du hub (masque les autres vues)
        MasquerVues();
        ChatScroll.Visibility = Visibility.Visible;
        ComposerBar.Visibility = _apparence.ShowComposer ? Visibility.Visible : Visibility.Collapsed;
        ChatSidebar.Visibility = _apparence.ShowSidebar ? Visibility.Visible : Visibility.Collapsed;
        PageTitle.Text = agent == "projet" ? "Projet" : NomAgent(agent);
        PageHint.Text = "Conversation " + agent;

        if (chatId == _chatId && _chat is not null)
        {
            SynchroniserChat(); // déjà ouverte : simple réaffichage
            Composer.Focus(FocusState.Programmatic);
            return;
        }

        var vm = new Aven.Bridge.ChatViewModel(_boot.Client, _espace,
            marshal: action => DispatcherQueue.TryEnqueue(() => action()));
        _chat = vm;
        _chatId = chatId;
        _chatAgent = agent;
        _chatOuvert = true;
        _chatEnCours = false;
        vm.PropertyChanged += (_, _) => SynchroniserChat();
        AssurerBranchementsChat(_boot.Client);
        try
        {
            await vm.AttachExistingAsync(chatId); // transcript complet (sous-agents inclus)
        }
        catch (Exception erreur)
        {
            PageHint.Text = "Ouverture impossible : " + erreur.Message;
        }
        SynchroniserChat();
        ScrollBas();
        _ = RafraîchirSidebarAsync(); // l'actif de la sidebar suit
        Composer.Focus(FocusState.Programmatic);
    }

    /// <summary>Crée une conversation pour l'agent donné et l'ouvre (boutons « Ouvrir »
    /// des modes, « Nouvelle conversation » de la sidebar, carte Tâches).</summary>
    private async void NouvelleConversation(string agent)
    {
        if (_espace is null || _boot.Client is null)
        {
            PageHint.Text = "Moteur indisponible : le boot n'a pas encore abouti.";
            return;
        }
        if (PageView.Visibility != Visibility.Visible) OuvrirPageDepuis(null);
        MasquerVues();
        ChatScroll.Visibility = Visibility.Visible;
        ComposerBar.Visibility = _apparence.ShowComposer ? Visibility.Visible : Visibility.Collapsed;
        ChatSidebar.Visibility = _apparence.ShowSidebar ? Visibility.Visible : Visibility.Collapsed;
        ChatRows.Children.Clear();
        _chatRendu = null;
        _chatId = null;
        _chatOuvert = false;
        _chatAgent = agent;
        PageTitle.Text = agent == "projet" ? "Projet" : NomAgent(agent);
        PageHint.Text = "Création de la conversation...";
        _chatEnCours = true;
        await DémarrerChat(agent);
    }

    /// <summary>Recharge la sidebar (parité loadChats) : TOUTES les conversations,
    /// groupées par agent (parité chatsGroupedByAgent v9.0.0).</summary>
    private async Task RafraîchirSidebarAsync()
    {
        if (_espace is null) return;
        SidebarTitre.Text = _sidebarArchivées ? "Archivées" : "Actives";
        if (_boot.Client is null) { _sidebarChats = []; ConstruireSidebar(); return; }
        if (_agentsTaches.Count == 0)
        {
            try { _agentsTaches = (await _boot.Client.ListAgentsAsync(_espace)).ToList(); }
            catch { /* noms personnalisés indisponibles : les ids font foi */ }
        }
        try
        {
            _sidebarChats = (await _boot.Client.ListChatsAsync(
                _espace, agent: null, includeArchived: _sidebarArchivées)).ToList();
        }
        catch (Exception erreur)
        {
            _sidebarChats = [];
            System.Diagnostics.Debug.WriteLine("sidebar : " + erreur.Message);
        }
        ConstruireSidebar();
    }

    private string NomAgent(string id) =>
        _agentsTaches.FirstOrDefault(a => a.Id == id)?.Name ?? id;

    private void ConstruireSidebar()
    {
        SidebarListe.Children.Clear();
        var filtre = _sidebarFiltre.Trim();
        IEnumerable<Aven.Bridge.ChatInfo> visibles = _sidebarChats;
        if (filtre.Length > 0)
            visibles = visibles.Where(c => c.Title.Contains(filtre, StringComparison.OrdinalIgnoreCase));

        var groupes = visibles.GroupBy(c => c.Agent ?? "").ToList();
        // agents connus (ordre TABS) d'abord, « Autre » en dernier (parité groupChatsByAgent).
        var ordre = groupes.Where(g => Aven.Bridge.ConversationClient.Tabs.Contains(g.Key)).ToList();
        ordre.AddRange(groupes.Where(g => !Aven.Bridge.ConversationClient.Tabs.Contains(g.Key)));

        foreach (var groupe in ordre)
        {
            var enTête = new Grid();
            enTête.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            enTête.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var nom = new TextBlock
            {
                Text = groupe.Key.Length > 0 ? NomAgent(groupe.Key) : "Autre",
                FontSize = 11,
                FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
                Foreground = BrushDe("AvenMutedBrush"),
                VerticalAlignment = VerticalAlignment.Center,
            };
            var compte = new TextBlock
            {
                Text = groupe.Count().ToString(),
                FontSize = 11,
                Foreground = BrushDe("AvenMutedBrush"),
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Right,
            };
            Grid.SetColumn(nom, 0);
            Grid.SetColumn(compte, 1);
            enTête.Children.Add(nom);
            enTête.Children.Add(compte);
            SidebarListe.Children.Add(enTête);

            foreach (var chat in groupe)
                SidebarListe.Children.Add(RangéeConversation(chat));
        }

        if (SidebarListe.Children.Count == 0)
        {
            SidebarListe.Children.Add(new TextBlock
            {
                Text = "Rien à afficher ici.",
                FontSize = 12,
                TextWrapping = TextWrapping.Wrap,
                Foreground = BrushDe("AvenMutedBrush"),
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 18, 0, 0),
            });
        }
    }

    /// <summary>Une conversation de la sidebar : titre cliquable + actions (renommer,
    /// archiver/désarchiver, supprimer) — parité .chat du web.</summary>
    private Border RangéeConversation(Aven.Bridge.ChatInfo chat)
    {
        var bordure = new Border
        {
            CornerRadius = new CornerRadius(8),
            BorderBrush = BrushDe("AvenBorderBrush"),
            BorderThickness = new Thickness(1),
            Background = _chatId == chat.Id ? BrushDe("AvenPanelSoftBrush") : BrushDe("AvenPanelBrush"),
            Padding = new Thickness(8, 4, 8, 4),
        };
        var grille = new Grid();
        grille.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grille.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        if (_renommageId == chat.Id)
        {
            var zone = new TextBox
            {
                Text = chat.Title,
                MinHeight = 30,
                FontSize = 12,
                Background = BrushDe("AvenPanelBrush"),
                BorderBrush = BrushDe("AvenAccentBrush"),
            };
            var idRenommage = chat.Id;
            zone.KeyDown += (_, args) =>
            {
                if (args.Key == Windows.System.VirtualKey.Enter)
                {
                    args.Handled = true;
                    _ = RenommerAsync(idRenommage, zone.Text);
                }
                else if (args.Key == Windows.System.VirtualKey.Escape)
                {
                    args.Handled = true;
                    _renommageId = null;
                    ConstruireSidebar();
                }
            };
            zone.LostFocus += (_, _) =>
            {
                if (_renommageId == idRenommage) _ = RenommerAsync(idRenommage, zone.Text);
            };
            Grid.SetColumn(zone, 0);
            grille.Children.Add(zone);
        }
        else
        {
            var contenu = new StackPanel { Spacing = 1 };
            contenu.Children.Add(new TextBlock
            {
                Text = chat.Title,
                FontSize = 12,
                TextTrimming = TextTrimming.CharacterEllipsis,
                Foreground = BrushDe("AvenTextBrush"),
            });
            contenu.Children.Add(new TextBlock
            {
                Text = DateCourte(chat.Updated),
                FontSize = 10,
                Foreground = BrushDe("AvenMutedBrush"),
            });
            var main = new Button
            {
                Content = contenu,
                HorizontalAlignment = HorizontalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Left,
                MinHeight = 36,
                Padding = new Thickness(4, 2, 4, 2),
                Background = BrushDe("AvenPanelSoftBrush"),
                BorderThickness = new Thickness(0),
                CornerRadius = new CornerRadius(6),
            };
            AutomationProperties.SetName(main, "Conversation : " + chat.Title);
            var idC = chat.Id;
            var agentC = chat.Agent ?? _chatAgent;
            main.Click += (_, _) => OuvrirConversation(idC, agentC);
            Grid.SetColumn(main, 0);
            grille.Children.Add(main);

            var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2 };
            actions.Children.Add(ActionBouton("\u270E", "Renommer : " + chat.Title,
                (_, _) => { _renommageId = chat.Id; ConstruireSidebar(); }));
            actions.Children.Add(ActionBouton(_sidebarArchivées ? "R" : "A",
                (_sidebarArchivées ? "Désarchiver : " : "Archiver : ") + chat.Title,
                async (_, _) => await BasculerArchiveAsync(chat.Id, !_sidebarArchivées)));
            actions.Children.Add(ActionBouton("\u00D7", "Supprimer : " + chat.Title,
                async (_, _) => await SupprimerAsync(chat.Id)));
            Grid.SetColumn(actions, 1);
            grille.Children.Add(actions);
        }

        bordure.Child = grille;
        return bordure;
    }

    private Button ActionBouton(string contenu, string nomUi, RoutedEventHandler clic)
    {
        var bouton = new Button
        {
            Content = contenu,
            MinWidth = 24,
            MinHeight = 26,
            Padding = new Thickness(4, 2, 4, 2),
            FontSize = 11,
            Background = BrushDe("AvenPanelSoftBrush"),
            BorderThickness = new Thickness(0),
            Foreground = BrushDe("AvenTextBrush"),
        };
        AutomationProperties.SetName(bouton, nomUi);
        bouton.Click += clic;
        return bouton;
    }

    private static string DateCourte(long updated)
    {
        if (updated <= 0) return "";
        try { return DateTimeOffset.FromUnixTimeMilliseconds(updated).ToLocalTime().ToString("dd MMM"); }
        catch { return ""; }
    }

    private async Task RenommerAsync(string id, string titre)
    {
        _renommageId = null;
        try
        {
            if (_boot.Client is not null) await _boot.Client.RenameChatAsync(id, titre);
        }
        catch (Exception erreur) { PageHint.Text = "Renommage impossible : " + erreur.Message; }
        await RafraîchirSidebarAsync();
        _ = RafraîchirRecentsAsync();
    }

    private async Task BasculerArchiveAsync(string id, bool archiver)
    {
        if (_espace is null) return;
        try { Aven.Bridge.ChatsService.SetArchived(_espace, id, archiver); }
        catch (Exception erreur) { PageHint.Text = "Archivage impossible : " + erreur.Message; }
        await RafraîchirSidebarAsync();
        _ = RafraîchirRecentsAsync();
    }

    private async Task SupprimerAsync(string id)
    {
        if (_espace is null || _boot.Client is null) return;
        try { await _boot.Client.DeleteChatAsync(id, _espace); }
        catch (Exception erreur) { PageHint.Text = "Suppression impossible : " + erreur.Message; return; }
        if (_chatId == id)
        {
            // La conversation ouverte disparaît : retour au hub (parité removeChat).
            _chat = null;
            _chatId = null;
            _chatOuvert = false;
            _chatRendu = null;
            ChatRows.Children.Clear();
            OnHome(this, new RoutedEventArgs());
        }
        await RafraîchirSidebarAsync();
        _ = RafraîchirRecentsAsync();
    }

    /// <summary>Hub enrichi (parité .home-recent) : les 3 dernières conversations,
    /// clic = réouverture. Nom UIA « Reprendre : » (jamais le préfixe d'une carte).</summary>
    private async Task RafraîchirRecentsAsync()
    {
        if (_espace is null || _boot.Client is null) return;
        try
        {
            var récentes = (await _boot.Client.ListChatsAsync(_espace)).Take(3).ToList();
            HubRecentsList.Children.Clear();
            foreach (var chat in récentes)
            {
                var pile = new StackPanel { Spacing = 1 };
                pile.Children.Add(new TextBlock
                {
                    Text = chat.Title,
                    FontSize = 12,
                    FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
                    Foreground = BrushDe("AvenTextBrush"),
                    TextTrimming = TextTrimming.CharacterEllipsis,
                });
                var meta = (chat.Agent ?? "") + (chat.Model is { Length: > 0 } modèle ? " · " + modèle : "");
                pile.Children.Add(new TextBlock
                {
                    Text = meta,
                    FontSize = 10,
                    Foreground = BrushDe("AvenMutedBrush"),
                    TextTrimming = TextTrimming.CharacterEllipsis,
                });
                var bouton = new Button
                {
                    Content = pile,
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    HorizontalContentAlignment = HorizontalAlignment.Left,
                    MinHeight = 42,
                    Padding = new Thickness(10, 6, 10, 6),
                    Background = BrushDe("AvenPanelSoftBrush"),
                    BorderThickness = new Thickness(0),
                    CornerRadius = new CornerRadius(10),
                };
                AutomationProperties.SetName(bouton, "Reprendre : " + chat.Title);
                var id = chat.Id;
                var agent = chat.Agent ?? "projet";
                bouton.Click += (_, _) => OuvrirConversation(id, agent, bouton);
                HubRecentsList.Children.Add(bouton);
            }
            if (récentes.Count == 0)
            {
                HubRecentsList.Children.Add(new TextBlock
                {
                    Text = "Commencez une conversation pour la retrouver ici.",
                    FontSize = 11,
                    TextWrapping = TextWrapping.Wrap,
                    Foreground = BrushDe("AvenMutedBrush"),
                });
            }
        }
        catch (Exception erreur)
        {
            System.Diagnostics.Debug.WriteLine("récents : " + erreur.Message);
        }
    }

    // ── Page Tâches (parité v9.6.0) : agent principal + modes ────────────────────

    private void OuvrirTaches(UIElement? source)
    {
        PageTitle.Text = "Tâches";
        PageHint.Text = "Un agent principal, des modes par besoin — l'orchestrateur délègue aux spécialistes.";
        OuvrirPageDepuis(source); // flip hub → page AVANT d'allumer la vue
        TasksScroll.Visibility = Visibility.Visible;
        _ = ChargerTachesAsync();
    }

    private async Task ChargerTachesAsync()
    {
        if (_espace is null || _boot.Client is null)
        {
            TasksPrincipalOuvrir.IsEnabled = false; // parité tasks-card-off
            return;
        }
        try { _agentsTaches = (await _boot.Client.ListAgentsAsync(_espace)).ToList(); }
        catch { _agentsTaches = []; }

        var principal = _agentsTaches.FirstOrDefault(a => a.Id == "projet");
        TasksPrincipalNom.Text = principal?.Name ?? "Projet";
        TasksPrincipalOuvrir.IsEnabled = principal is not null;

        List<Aven.Bridge.ChatInfo> toutes = [];
        try { toutes = (await _boot.Client.ListChatsAsync(_espace)).ToList(); }
        catch { /* pas de dernière conversation affichée */ }

        var modes = new (string Id, string Repli, string Desc)[]
        {
            ("code", "Code", "Écrire, corriger, exécuter du code et des commandes."),
            ("analyse", "Analyse", "Données, chiffres, statistiques, rapports."),
            ("recherche", "Recherche", "Documentation, comparaisons, veille, explications."),
            ("projet", "Tâche complexe", "Orchestre code + analyse + recherche, puis synthétise."),
        };

        TasksModes.Children.Clear();
        foreach (var (id, repli, desc) in modes)
        {
            var agent = _agentsTaches.FirstOrDefault(a => a.Id == id);
            var dernière = toutes.FirstOrDefault(c => c.Agent == id);
            var pile = new StackPanel { Spacing = 6 };
            pile.Children.Add(new TextBlock
            {
                Text = id,
                FontSize = 11,
                Foreground = BrushDe("AvenMutedBrush"),
            });
            pile.Children.Add(new TextBlock
            {
                Text = agent?.Name ?? repli,
                FontSize = 15,
                FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
                Foreground = BrushDe("AvenTextBrush"),
            });
            pile.Children.Add(new TextBlock
            {
                Text = desc,
                FontSize = 12,
                TextWrapping = TextWrapping.Wrap,
                Foreground = BrushDe("AvenMutedBrush"),
            });
            if (dernière is not null)
            {
                var idDernier = dernière.Id;
                var ouvrirDernier = new Button
                {
                    Content = dernière.Title,
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    HorizontalContentAlignment = HorizontalAlignment.Left,
                    MinHeight = 32,
                    Padding = new Thickness(10, 4, 10, 4),
                    FontSize = 12,
                    Background = BrushDe("AvenPanelSoftBrush"),
                    BorderThickness = new Thickness(0),
                    CornerRadius = new CornerRadius(8),
                    Foreground = BrushDe("AvenTextBrush"),
                };
                AutomationProperties.SetName(ouvrirDernier, "Dernière conversation " + id + " : " + dernière.Title);
                ouvrirDernier.Click += (_, _) => OuvrirConversation(idDernier, id);
                pile.Children.Add(ouvrirDernier);
            }
            var ouvrir = new Button
            {
                Content = "Ouvrir",
                IsEnabled = agent is not null,
                HorizontalAlignment = HorizontalAlignment.Left,
                MinHeight = 32,
                Padding = new Thickness(14, 4, 14, 4),
                Background = BrushDe("AvenPanelSoftBrush"),
                Foreground = BrushDe("AvenTextBrush"),
            };
            var agentId = id;
            ouvrir.Click += (_, _) => NouvelleConversation(agentId);
            pile.Children.Add(ouvrir);

            var carte = new Border
            {
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(14, 12, 14, 12),
                Background = BrushDe("AvenPanelBrush"),
                BorderBrush = agent is null ? BrushDe("AvenBorderBrush") : BrushDe("AvenAccentBorderBrush"),
                BorderThickness = new Thickness(1),
                Child = pile,
            };
            if (agent is null) carte.Opacity = 0.55; // parité tasks-card-off
            TasksModes.Children.Add(carte);
        }
    }

    // ── Handlers XAML de la sidebar / page Tâches ────────────────────────────────

    private void OnSidebarNouvelle(object sender, RoutedEventArgs e) => NouvelleConversation(_chatAgent);

    private void OnSidebarArchive(object sender, RoutedEventArgs e)
    {
        _sidebarArchivées = !_sidebarArchivées;
        SidebarArchive.Content = _sidebarArchivées ? "Revenir aux actives" : "Voir les archivées";
        _ = RafraîchirSidebarAsync();
    }

    private void OnSidebarRecherche(object sender, TextChangedEventArgs e)
    {
        _sidebarFiltre = SidebarRecherche.Text;
        ConstruireSidebar();
    }

    private void OnTasksPrincipal(object sender, RoutedEventArgs e) => NouvelleConversation("projet");

    private void OnComposerKey(object sender, Microsoft.UI.Xaml.Input.KeyRoutedEventArgs e)
    {
        // Parité composeur : Entrée = envoyer, Maj+Entrée = retour ligne (AcceptsReturn).
        if (e.Key == Windows.System.VirtualKey.Enter &&
            !Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(Windows.System.VirtualKey.Shift)
                .HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down))
        {
            e.Handled = true;
            Envoyer();
        }
    }

    private void OnSend(object sender, RoutedEventArgs e) => Envoyer();

    private async void Envoyer()
    {
        var texte = Composer.Text;
        if (string.IsNullOrWhiteSpace(texte) || _chat is null) return;
        Composer.Text = "";
        try { await _chat.SendAsync(texte); }
        catch (Exception erreur)
        {
            PageHint.Text = "Envoi impossible : " + erreur.Message;
        }
    }

    private void OnStop(object sender, RoutedEventArgs e) => ArrêterTour();

    // ── Vue Fichiers (phase 4) — FilesService cloisonné par safeResolve ───────

    /// <summary>Espace actif (registre v10.0.0) — parité requireWorkspace de
    /// l'Electron : JAMAIS de dossier par défaut (v9.1.5) ; "" = aucun espace
    /// choisi (l'écran de choix couvre l'UI, les vues affichent l'erreur).</summary>
    private string Espace() => _espace ?? "";

    private void OuvrirFichiers(UIElement? source = null)
    {
        PageTitle.Text = "Fichiers";
        PageHint.Text = "Explorateur de l'espace (lecture seule)";
        OuvrirPageDepuis(source); // flip hub → page AVANT d'allumer la vue
        if (!_filesOuvert) { _filesOuvert = true; }
        FilesView.Visibility = Visibility.Visible;
        ReconstruireArbreFichiers(); // arbre frais à chaque ouverture (lecture seule, sans état caché)
        ListerFichiers(_filesRelative);
    }

    /// <summary>Arbre gauche (spec phase 4 « TreeView + GridView ») : un niveau chargé,
    /// l'expansion charge les enfants LAZY (même FilesService.List → safeResolve).
    /// TreeViewNode n'a ni Tag ni HasChildren settable : le chemin vit dans le
    /// dictionnaire d'instance et le chevron vient d'un nœud FANTÔME (pattern WinUI).</summary>
    private readonly Dictionary<TreeViewNode, string> _nœudsChemins = new();
    private const string NœudFantôme = "\u2026";

    private void ReconstruireArbreFichiers()
    {
        _nœudsChemins.Clear();
        FilesTree.RootNodes.Clear();
        try
        {
            foreach (var nœud in Aven.Bridge.FilesTree.Construire(Espace()))
                FilesTree.RootNodes.Add(NœudArbre(nœud));
        }
        catch { /* pas d'espace : l'arbre reste vide, la liste à droite affiche l'erreur */ }
    }

    private TreeViewNode NœudArbre(Aven.Bridge.FileTreeNode nœud)
    {
        var t = new TreeViewNode { Content = nœud.Nom };
        _nœudsChemins[t] = nœud.Relatif;
        if (nœud.EstDossier) t.Children.Add(new TreeViewNode { Content = NœudFantôme }); // chevron
        return t;
    }

    private void OnFilesTreeExpanding(TreeView sender, TreeViewExpandingEventArgs args)
    {
        if (args.Node is not { } nœud || !_nœudsChemins.TryGetValue(nœud, out var relatif)) return;
        // Fantôme présent = enfants jamais chargés ; sinon le sous-arbre est déjà là.
        if (nœud.Children.Count != 1 || nœud.Children[0].Content as string != NœudFantôme) return;
        nœud.Children.Clear();
        try
        {
            foreach (var enfant in Aven.Bridge.FilesTree.Construire(Espace(), relatif))
                nœud.Children.Add(NœudArbre(enfant));
        }
        catch { /* dossier disparu : reste vide */ }
    }

    private void OnFilesTreeInvoked(TreeView sender, TreeViewItemInvokedEventArgs args)
    {
        if (args.InvokedItem is TreeViewNode nœud && _nœudsChemins.TryGetValue(nœud, out var relatif))
            ListerFichiers(relatif);
    }

    private void ListerFichiers(string relatif)
    {
        try
        {
            _filesRelative = relatif;
            var entrées = Aven.Bridge.FilesService.List(Espace(), relatif);
            FilesList.Children.Clear();
            FilesPreview.Visibility = Visibility.Collapsed;
            FilesAnalyzeAgents.Visibility = Visibility.Collapsed; // parite openDir : analyzeFor = null
            _filesApercuChemin = null;
            FilesUp.Visibility = relatif.Length > 0 ? Visibility.Visible : Visibility.Collapsed;

            // Fil d'ariane cliquable (parité files-crumbs).
            FilesCrumbs.Children.Clear();
            var crumbs = Aven.Bridge.FilesService.Breadcrumb(relatif);
            for (var i = 0; i < crumbs.Count; i++)
            {
                if (i > 0) FilesCrumbs.Children.Add(new TextBlock { Text = "\u203A", VerticalAlignment = VerticalAlignment.Center, Foreground = BrushDe("AvenMutedBrush") });
                var c = crumbs[i];
                var bouton = new Button
                {
                    Content = c.Label,
                    Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
                    BorderThickness = new Thickness(0),
                    Padding = new Thickness(6, 2, 6, 2),
                    Foreground = BrushDe("AvenTextBrush"),
                };
                var chemin = c.Path;
                bouton.Click += (_, _) => ListerFichiers(chemin);
                FilesCrumbs.Children.Add(bouton);
            }

            foreach (var entrée in entrées)
            {
                var rangée = new Button
                {
                    Content = entrée.Kind == "dir" ? "\uD83D\uDCC1  " + entrée.Name : "\u25A4  " + entrée.Name + (entrée.Size > 0 ? "   (" + TailleHumaine(entrée.Size) + ")" : ""),
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    HorizontalContentAlignment = HorizontalAlignment.Left,
                    MinHeight = 34,
                    Background = BrushDe("AvenPanelBrush"),
                    BorderBrush = BrushDe("AvenBorderBrush"),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(8),
                    Foreground = BrushDe("AvenTextBrush"),
                };
                var kind = entrée.Kind;
                var chemin = entrée.Path;
                rangée.Click += (_, _) =>
                {
                    if (kind == "dir") ListerFichiers(chemin);
                    else AperçuFichier(chemin);
                };
                FilesList.Children.Add(rangée);
            }
            if (entrées.Count == 0) FilesList.Children.Add(new TextBlock { Text = "Dossier vide.", Foreground = BrushDe("AvenMutedBrush") });
        }
        catch (Exception erreur)
        {
            FilesList.Children.Clear();
            FilesList.Children.Add(new TextBlock { Text = erreur.Message, Foreground = BrushDe("AvenDangerBrush") });
        }
    }

    private void AperçuFichier(string chemin)
    {
        try
        {
            var fichier = Aven.Bridge.FilesService.Read(Espace(), chemin);
            _filesApercuChemin = fichier.Path; // cible de "Faire analyser" (parite preview.path)
            FilesAnalyzeAgents.Visibility = Visibility.Collapsed; // parite openFile : analyzeFor = null
            FilesPreviewPath.Text = "APER\u00C7U \u00B7 " + fichier.Path;
            FilesPreviewMeta.Text = TailleHumaine(fichier.Size) + (fichier.Truncated ? " \u00B7 aper\u00E7u tronqu\u00E9 (512 Kio)" : "");
            FilesPreviewContent.Text = fichier.Content;
            FilesPreview.Visibility = Visibility.Visible;
        }
        catch (Exception erreur)
        {
            _filesApercuChemin = null;
            FilesAnalyzeAgents.Visibility = Visibility.Collapsed;
            FilesPreview.Visibility = Visibility.Visible;
            FilesPreviewPath.Text = "";
            FilesPreviewMeta.Text = "";
            FilesPreviewContent.Text = erreur.Message;
        }
    }

    private static string TailleHumaine(long octets) => octets < 1024 ? $"{octets} o"
        : octets < 1024 * 1024 ? $"{octets / 1024.0:0.0} Kio" : $"{octets / (1024.0 * 1024.0):0.0} Mio";

    private void OnFilesUp(object sender, RoutedEventArgs e)
    {
        var segments = _filesRelative.Split('/', StringSplitOptions.RemoveEmptyEntries);
        ListerFichiers(string.Join("/", segments.Take(segments.Length - 1)));
    }

    // ── Vue Notes (phase 4) — NotesService, même format disque que l'Electron ──

    private void OuvrirNotes(UIElement? source = null)
    {
        PageTitle.Text = "Notes";
        PageHint.Text = "De vrais fichiers Markdown sur ton PC, \u00E9tiquetables par agent.";
        OuvrirPageDepuis(source); // flip hub → page AVANT d'allumer la vue
        if (!_notesOuvert) { _notesOuvert = true; }
        NotesScroll.Visibility = Visibility.Visible;
        NotesDirHint.Text = Aven.Bridge.NotesService.Dir(Espace());
        ListerNotes();
        _ = RafraîchirÉtiquettesAsync(); // noms d'agents réels sur les étiquettes
    }

    private void ListerNotes()
    {
        try
        {
            var query = NotesQuery.Text.Trim().ToLowerInvariant();
            var pins = Aven.Bridge.NotesService.LoadPinned(Espace());
            var toutes = Aven.Bridge.NotesService.List(Espace());

            // Étiquettes par note (parité useEffect tags), puis filtre par agent
            // (notes-tags-filter) appliqué à la liste.
            var tags = new Dictionary<string, IReadOnlyList<string>>();
            foreach (var n in toutes)
            {
                try { tags[n.Id] = Aven.Bridge.NotesService.LoadTags(Espace(), n.Id); }
                catch { tags[n.Id] = []; }
            }
            var tousTags = tags.Values.SelectMany(t => t).Distinct().ToList();
            if (_notesTagFiltre is { } actif && !tousTags.Contains(actif)) _notesTagFiltre = null;
            ConstruireFiltreTags(tousTags);

            var notes = toutes
                .Where(n => _notesTagFiltre is null || tags[n.Id].Contains(_notesTagFiltre))
                .Where(n => query.Length == 0 || n.Title.ToLowerInvariant().Contains(query) || n.Markdown.ToLowerInvariant().Contains(query))
                .OrderByDescending(n => pins.Contains(n.Id)) // épinglées d'abord (parité visible)
                .ThenByDescending(n => n.Updated);
            NotesList.Children.Clear();
            foreach (var note in notes)
            {
                // Parité rangée web : titre, id, puis les tags (noms d'agents).
                var étiquettes = tags[note.Id];
                var affichage = étiquettes.Count == 0 ? "" : "   \u00B7 " + string.Join(", ", étiquettes.Select(NomAgent));
                var rangée = new Button
                {
                    Content = (pins.Contains(note.Id) ? "\uD83D\uDCCC " : "") + note.Title + "   " + note.Id + affichage,
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    HorizontalContentAlignment = HorizontalAlignment.Left,
                    MinHeight = 36,
                    Background = BrushDe("AvenPanelBrush"),
                    BorderBrush = BrushDe("AvenBorderBrush"),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(8),
                    Foreground = BrushDe("AvenTextBrush"),
                };
                var id = note.Id;
                rangée.Click += (_, _) => OuvrirNote(id);
                NotesList.Children.Add(rangée);
            }
            if (!NotesList.Children.OfType<Button>().Any())
                NotesList.Children.Add(new TextBlock { Text = query.Length > 0 ? "Aucune note ne correspond." : "Aucune note : cr\u00E9e la premi\u00E8re avec \u00AB + Nouvelle \u00BB.", Foreground = BrushDe("AvenMutedBrush") });
        }
        catch (Exception erreur)
        {
            NotesList.Children.Clear();
            NotesList.Children.Add(new TextBlock { Text = erreur.Message, Foreground = BrushDe("AvenDangerBrush") });
        }
    }

    private void OnNotesQuery(object sender, TextChangedEventArgs e) { if (_notesOuvert) ListerNotes(); }

    private void OuvrirNote(string id)
    {
        try
        {
            var note = Aven.Bridge.NotesService.Get(Espace(), id);
            _noteOuverte = note;
            NoteEditor.Visibility = Visibility.Collapsed;
            NotePreview.Visibility = Visibility.Visible;
            NotePreviewTitre.Text = note.Title;
            NotePinButton.Content = Aven.Bridge.NotesService.LoadPinned(Espace()).Contains(id) ? "D\u00E9tacher" : "\u00C9pingler";
            NoteMeta.Text = note.Markdown.Split(new[] { ' ', '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).Length + " mots \u00B7 " + TailleHumaine(note.Markdown.Length);
            NotePreviewBody.Children.Clear();
            RemplirMarkdown(NotePreviewBody, note.Markdown, BrushDe("AvenTextBrush"));
        }
        catch (Exception erreur)
        {
            PageHint.Text = erreur.Message;
        }
    }

    private void OnNotePin(object sender, RoutedEventArgs e)
    {
        if (_noteOuverte is not { } note) return;
        try
        {
            var pins = Aven.Bridge.NotesService.TogglePin(Espace(), note.Id);
            NotePinButton.Content = pins.Contains(note.Id) ? "D\u00E9tacher" : "\u00C9pingler";
            ListerNotes();
        }
        catch (Exception erreur) { PageHint.Text = erreur.Message; }
    }

    private void OnNoteEdit(object sender, RoutedEventArgs e)
    {
        if (_noteOuverte is not { } note) return;
        NoteEditorTitre.Text = "\u00C9DITION";
        NoteTitleBox.Text = note.Title;
        NoteBodyBox.Text = note.Markdown;
        NotePreview.Visibility = Visibility.Collapsed;
        NoteEditor.Visibility = Visibility.Visible;
        NoteTagPicker.Visibility = Visibility.Collapsed; // picker = création seule (parité)
        _noteNouvelleTags = null;
    }

    private void OnNoteNew(object sender, RoutedEventArgs e)
    {
        NoteEditorTitre.Text = "NOUVELLE NOTE";
        NoteTitleBox.Text = "";
        NoteBodyBox.Text = "";
        // L'agent de la conversation ouverte est pr\u00E9-coch\u00E9 (parit\u00E9 editingTags).
        _noteNouvelleTags = string.IsNullOrEmpty(_chatAgent) ? null : new List<string> { _chatAgent };
        NotePreview.Visibility = Visibility.Collapsed;
        NoteEditor.Visibility = Visibility.Visible;
        _ = ConstruireNoteTagPickerAsync();
    }

    private async void OnNoteSave(object sender, RoutedEventArgs e)
    {
        try
        {
            var id = _noteOuverte is { } ouverte && NoteEditorTitre.Text == "\u00C9DITION" ? ouverte.Id : "";
            var note = await Task.Run(() => Aven.Bridge.NotesService.Save(Espace(), id, NoteTitleBox.Text, NoteBodyBox.Text));
            _noteOuverte = note;
            // Etiquettes choisies a la CREATION seulement (parite commitEdit :
            // editing.id === ""), puis remise a zero quoi qu'il arrive.
            if (id.Length == 0 && _noteNouvelleTags is { Count: > 0 } tags)
                Aven.Bridge.NotesService.SetTags(Espace(), note.Id, tags);
            _noteNouvelleTags = null;
            NoteEditor.Visibility = Visibility.Collapsed;
            ListerNotes();
            OuvrirNote(note.Id);
        }
        catch (Exception erreur) { PageHint.Text = erreur.Message; }
    }

    private void OnNoteCancel(object sender, RoutedEventArgs e)
    {
        NoteEditor.Visibility = Visibility.Collapsed;
        NoteTagPicker.Visibility = Visibility.Collapsed; // parite setEditingTags(null)
        _noteNouvelleTags = null;
        if (_noteOuverte is { } note) OuvrirNote(note.Id);
    }

    // ── Jalon 4 : parite Notes/Fichiers du web (tags agents, joindre, exporter,
    //    ouvrir dans l'Explorateur, analyse par agent) ─────────────────────────

    /// <summary>Pastille cliquable (facture .notes-tag du web, style SurbrillerOnglet) :
    /// accent quand actif, soft sinon. L'id vit dans Tag pour les mises a jour d'etat.</summary>
    private Button BoutonÉtiquette(string nom, string id, bool actif, RoutedEventHandler clic)
    {
        var bouton = new Button
        {
            Content = nom,
            Tag = id,
            MinHeight = 26,
            Padding = new Thickness(10, 2, 10, 2),
            FontSize = 11,
            CornerRadius = new CornerRadius(999),
            Background = BrushDe(actif ? "AvenAccentBrush" : "AvenPanelSoftBrush"),
            Foreground = actif ? new SolidColorBrush(Microsoft.UI.Colors.White) : BrushDe("AvenMutedBrush"),
            BorderBrush = BrushDe(actif ? "AvenAccentBrush" : "AvenBorderBrush"),
            BorderThickness = new Thickness(1),
        };
        bouton.Click += clic;
        return bouton;
    }

    /// <summary>Charge la liste d'agents du moteur UNE fois (noms lisibles des
    /// etiquettes) — sans moteur, les ids d'onglets font foi (parite fallback web).</summary>
    private async Task AssurerAgentsAsync()
    {
        if (_agentsTaches.Count > 0 || _espace is null || _boot.Client is null) return;
        try { _agentsTaches = (await _boot.Client.ListAgentsAsync(_espace)).ToList(); }
        catch { /* moteur muet : les ids restent affichés */ }
    }

    /// <summary>Noms d'agents arrivés tard : la liste et l'editeur d'etiquettes se
    /// redessinent avec les noms reels (une seule fois, si la vue est encore ouverte).</summary>
    private async Task RafraîchirÉtiquettesAsync()
    {
        var avant = _agentsTaches.Count;
        await AssurerAgentsAsync();
        if (_agentsTaches.Count == avant || !_notesOuvert) return;
        ListerNotes();
        if (_noteOuverte is { } note && NotePreview.Visibility == Visibility.Visible)
            ConstruireNoteTagsEditor(note);
    }

    /// <summary>Filtre par agent (parite notes-tags-filter) : "Toutes" + un bouton
    /// par tag reellement present ; le clic filtre la liste (toggle sur un tag).</summary>
    private void ConstruireFiltreTags(IReadOnlyList<string> tags)
    {
        NotesTagFilter.Children.Clear();
        if (tags.Count == 0) { NotesTagFilter.Visibility = Visibility.Collapsed; return; }
        NotesTagFilter.Children.Add(BoutonÉtiquette("Toutes", "", _notesTagFiltre is null, (_, _) =>
        {
            _notesTagFiltre = null;
            ListerNotes();
        }));
        foreach (var tag in tags)
        {
            var local = tag;
            NotesTagFilter.Children.Add(BoutonÉtiquette(NomAgent(tag), tag, _notesTagFiltre == tag, (_, _) =>
            {
                _notesTagFiltre = _notesTagFiltre == local ? null : local;
                ListerNotes();
            }));
        }
        NotesTagFilter.Visibility = Visibility.Visible;
    }

    /// <summary>Pastilles de la NOUVELLE note (parite notes-tag-picker) : agents du
    /// moteur (ids d'onglets en secours), agent courant pre-coche, toggle en memoire
    /// puis SetTags a l'enregistrement.</summary>
    private async Task ConstruireNoteTagPickerAsync()
    {
        try
        {
            await AssurerAgentsAsync();
            var ids = _agentsTaches.Count > 0
                ? _agentsTaches.Select(a => a.Id).ToList()
                : Aven.Bridge.ConversationClient.Tabs.ToList();
            NoteTagPicker.Children.Clear();
            foreach (var id in ids)
            {
                var local = id;
                NoteTagPicker.Children.Add(BoutonÉtiquette(NomAgent(id), id, _noteNouvelleTags?.Contains(id) == true, (s, _) =>
                {
                    var tags = _noteNouvelleTags ?? new List<string>();
                    if (tags.Contains(local)) tags.Remove(local);
                    else if (tags.Count < Aven.Bridge.NotesService.MaxNoteTags) tags.Add(local);
                    _noteNouvelleTags = tags;
                    SurbrillerOnglet((Button)s!, _noteNouvelleTags.Contains(local));
                }));
            }
            NoteTagPicker.Visibility = NoteTagPicker.Children.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        }
        catch (Exception erreur) { PageHint.Text = erreur.Message; }
    }

    /// <summary>Etiquettes de la note ouverte (parite notes-tags-editor) : un clic
    /// bascule l'agent avec SetTags immediate (parite commitTags), la liste suit.</summary>
    private async void ConstruireNoteTagsEditor(Aven.Bridge.Note note)
    {
        try
        {
            await AssurerAgentsAsync();
            if (_noteOuverte?.Id != note.Id) return; // l'utilisateur a change de note entre-temps
            var actifs = Aven.Bridge.NotesService.LoadTags(Espace(), note.Id);
            NoteTagsEditor.Children.Clear();
            var ids = _agentsTaches.Count > 0
                ? _agentsTaches.Select(a => a.Id).ToList()
                : Aven.Bridge.ConversationClient.Tabs.ToList();
            foreach (var id in ids)
            {
                var local = id;
                NoteTagsEditor.Children.Add(BoutonÉtiquette(NomAgent(id), id, actifs.Contains(id), (_, _) =>
                {
                    try
                    {
                        var courants = Aven.Bridge.NotesService.LoadTags(Espace(), note.Id).ToList();
                        if (courants.Contains(local)) courants.Remove(local);
                        else if (courants.Count < Aven.Bridge.NotesService.MaxNoteTags) courants.Add(local);
                        var sauvés = Aven.Bridge.NotesService.SetTags(Espace(), note.Id, courants);
                        foreach (Button b in NoteTagsEditor.Children)
                            SurbrillerOnglet(b, sauvés.Contains((string)b.Tag!));
                        ListerNotes(); // la liste et le filtre reflètent les tags
                    }
                    catch (Exception erreur) { PageHint.Text = erreur.Message; }
                }));
            }
            NoteTagsEditor.Visibility = NoteTagsEditor.Children.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        }
        catch (Exception erreur) { PageHint.Text = erreur.Message; }
    }

    /// <summary>Ouvre un chemin via le shell (parite shell.openPath de l'Electron :
    /// dossier -> Explorateur, fichier -> application par defaut).</summary>
    private static void OuvrirDansExplorateur(string chemin)
    {
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
        {
            FileName = chemin,
            UseShellExecute = true,
        });
    }

    private void OnNoteOuvrirDossier(object sender, RoutedEventArgs e)
    {
        try
        {
            var dossier = Aven.Bridge.NotesService.Dir(Espace());
            Directory.CreateDirectory(dossier); // parite ensureDir(notesDir)
            OuvrirDansExplorateur(dossier);
        }
        catch (Exception erreur) { PageHint.Text = erreur.Message; }
    }

    /// <summary>Parite composeIntoChat : le texte atterrit dans le composeur de la
    /// conversation de l'agent courant ( creee si aucune n'est ouverte ) — l'utilisateur
    /// valide lui-meme avec Envoyer.</summary>
    private void ComposerVersChat(string texte)
    {
        Composer.Text = texte;
        if (!string.IsNullOrEmpty(_chatId) && _chat is not null)
            OuvrirConversation(_chatId, _chatAgent, null);
        else if (_chatEnCours)
            OuvrirChat(null); // creation en vol : on rejoint la conversation naissante
        else
            NouvelleConversation(_chatAgent); // composeIntoChat : createChat si besoin
        Composer.Focus(FocusState.Programmatic);
    }

    private void OnNoteJoindre(object sender, RoutedEventArgs e)
    {
        if (_noteOuverte is not { } note) return;
        ComposerVersChat(Aven.Bridge.NotesService.TexteJoindre(note));
    }

    private async void OnNoteExporter(object sender, RoutedEventArgs e)
    {
        if (_noteOuverte is not { } note) return;
        try
        {
            var picker = new Windows.Storage.Pickers.FileSavePicker
            {
                SuggestedStartLocation = Windows.Storage.Pickers.PickerLocationId.DocumentsLibrary,
                SuggestedFileName = Aven.Bridge.NotesService.NomExport(note.Title) + ".md",
            };
            picker.FileTypeChoices.Add("Markdown", new List<string> { ".md" });
            var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
            WinRT.Interop.InitializeWithWindow.Initialize(picker, hwnd);
            var fichier = await picker.PickSaveFileAsync();
            if (fichier is null) return; // annule (parite res.canceled)
            await Windows.Storage.FileIO.WriteTextAsync(fichier, note.Markdown); // UTF-8 sans BOM
            PageHint.Text = "Note exportée : " + fichier.Path;
        }
        catch (Exception erreur) { PageHint.Text = erreur.Message; }
    }

    private void OnFilesOpenExplorer(object sender, RoutedEventArgs e)
    {
        try
        {
            var cible = Aven.Bridge.FilesService.SafeResolve(Espace(), _filesRelative);
            OuvrirDansExplorateur(cible); // parite files:open (dossier courant)
        }
        catch (Exception erreur) { PageHint.Text = erreur.Message; }
    }

    private async void OnFilesAnalyser(object sender, RoutedEventArgs e)
    {
        // Bascule de la rangée d'agents (parite analyzeFor : un 2e clic referme).
        if (FilesAnalyzeAgents.Visibility == Visibility.Visible)
        {
            FilesAnalyzeAgents.Visibility = Visibility.Collapsed;
            return;
        }
        try
        {
            await AssurerAgentsAsync();
            var ids = _agentsTaches.Count > 0
                ? _agentsTaches.Select(a => a.Id).ToList()
                : Aven.Bridge.ConversationClient.Tabs.ToList();
            FilesAnalyzeAgents.Children.Clear();
            foreach (var id in ids)
            {
                FilesAnalyzeAgents.Children.Add(BoutonÉtiquette(NomAgent(id), id, false, (_, _) =>
                {
                    var cible = _filesApercuChemin ?? _filesRelative;
                    FilesAnalyzeAgents.Visibility = Visibility.Collapsed;
                    ComposerVersChat(Aven.Bridge.FilesService.TexteAnalyse(cible));
                }));
            }
            FilesAnalyzeAgents.Visibility = FilesAnalyzeAgents.Children.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        }
        catch (Exception erreur) { PageHint.Text = erreur.Message; }
    }

    // ── Terminal Freebuff (phase 5) ──────────────────────────────────────

    private void OnFreebuff(object sender, RoutedEventArgs e) => OuvrirTerminal(FreebuffButton);

    private void MasquerVues()
    {
        ChatScroll.Visibility = Visibility.Collapsed;
        ComposerBar.Visibility = Visibility.Collapsed;
        ChatSidebar.Visibility = Visibility.Collapsed;
        TasksScroll.Visibility = Visibility.Collapsed;
        FilesView.Visibility = Visibility.Collapsed;
        NotesScroll.Visibility = Visibility.Collapsed;
        TerminalView.Visibility = Visibility.Collapsed;
        SettingsPanel.Visibility = Visibility.Collapsed;
    }

    private void OuvrirTerminal(UIElement? source = null)
    {
        PageTitle.Text = "Terminal Freebuff";
        PageHint.Text = "Le CLI gratuit, dans Aven";
        OuvrirPageDepuis(source); // flip hub → page + masque les autres vues
        TerminalView.Visibility = Visibility.Visible;
        TerminalInput.Focus(FocusState.Programmatic);
        if (_écranActif) AssurerÉcran(); // l'émulateur suit (le TUI se redessine aux prochains chunks)

        if (_terminal is not null) return;
        _terminal = new Aven.Bridge.FreebuffTerminal();
        var replay = _terminal.Start(
            () => Aven.Bridge.NodePtyTransport.Démarrer(Espace(), Aven.Bridge.FreebuffTerminal.DefaultCols, Aven.Bridge.FreebuffTerminal.DefaultRows),
            new Aven.Bridge.TerminalHandlers(
                OnData: chunk => DispatcherQueue.TryEnqueue(() => DonnéesTerminal(chunk)),
                OnStatus: état => DispatcherQueue.TryEnqueue(() =>
                    PageHint.Text = état switch
                    {
                        Aven.Bridge.TerminalState.Starting => "Démarrage du CLI...",
                        Aven.Bridge.TerminalState.Restarting => "Relance automatique...",
                        _ => "Session active",
                    }),
                OnExit: (code, _) => DispatcherQueue.TryEnqueue(() =>
                    TerminalSessionBar.Text = $"Session terminée (code {code}) — Relancer pour une nouvelle"),
                OnError: message => DispatcherQueue.TryEnqueue(() =>
                    TerminalSessionBar.Text = message)),
            cols: _dims.Cols, rows: _dims.Rows); // dims par défaut (l'émulateur ajustera via event Taille)
        if (replay.Length > 0) DonnéesTerminal(replay); // reprise de session : replay du scrollback
        _ = VérifierConflitDesktop();
    }

    private async Task VérifierConflitDesktop()
    {
        try
        {
            var sortie = await ExécuterPowerShell(
                "Get-CimInstance Win32_Process -Filter \"name='freebuff.exe'\" | Where-Object { $_.ExecutablePath -like '*codebufffreebuff-desktop*' } | Select-Object -First 1 -ExpandProperty ProcessId");
            var conflit = sortie.Split('\n').Any(l => System.Text.RegularExpressions.Regex.IsMatch(l.Trim(), "^\\d+$"));
            TerminalBannière.Visibility = conflit ? Visibility.Visible : Visibility.Collapsed;
        }
        catch { /* détection best effort (parité isFreebuffDesktopRunning) */ }
    }

    private static async Task<string> ExécuterPowerShell(string commande)
    {
        using var proc = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
        {
            FileName = "powershell",
            Arguments = $"-NoProfile -Command \"{commande}\"",
            RedirectStandardOutput = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        }) ?? throw new InvalidOperationException("powershell introuvable");
        var sortie = await proc.StandardOutput.ReadToEndAsync().ConfigureAwait(false);
        proc.WaitForExit(10000);
        return sortie;
    }

    /// <summary>Morceau coalescé : buffer → lignes → transcript filtré → vue.</summary>
    private void DonnéesTerminal(string morceau)
    {
        if (_écranActif) _écran?.Write(morceau); // chunk VT brut → émulateur (parité vue web)
        _tamponBrut.Append(morceau);
        var texte = _tamponBrut.ToString();
        var lignes = texte.Replace("\r\n", "\n").Split('\n');
        _tamponBrut.Clear();
        _tamponBrut.Append(lignes[^1]); // dernière ligne gardée (peut-être incomplète)
        _lignesBrutes.AddRange(lignes[..^1]);
        if (_lignesBrutes.Count > 400) _lignesBrutes.RemoveRange(0, _lignesBrutes.Count - 400); // parité buffer 400

        var transcript = Aven.Bridge.FreebuffTranscript.Build(_lignesBrutes);
        TerminalTranscript.Children.Clear();
        foreach (var ligne in transcript.Lines.TakeLast(60))
        {
            TerminalTranscript.Children.Add(new TextBlock
            {
                Text = (ligne.User ? "❯ " : "") + ligne.Text,
                TextWrapping = TextWrapping.Wrap,
                Foreground = ligne.User ? BrushDe("AvenAccentBrush") : BrushDe("AvenTextBrush"),
                FontSize = 13,
            });
        }
        if (transcript.SessionBar.Length > 0) TerminalSessionBar.Text = transcript.SessionBar;
        TerminalScroll.UpdateLayout();
        TerminalScroll.ChangeView(null, TerminalScroll.ScrollableHeight, zoomFactor: 1f, disableAnimation: true);
    }

    private void OnTerminalKey(object sender, Microsoft.UI.Xaml.Input.KeyRoutedEventArgs ev)
    {
        if (_écranActif) return; // le TUI capte le clavier via xterm (onData), pas le TextBox
        if (ev.Key != Windows.System.VirtualKey.Enter || TerminalInput.Text.Length == 0) return;
        ev.Handled = true;
        // Le TUI lit une LIGNE : texte + Entrée (parité xterm onData).
        _terminal?.Write(TerminalInput.Text + "\r");
        TerminalInput.Text = "";
    }

    private void OnTerminalStop(object sender, RoutedEventArgs e)
    {
        if (_écranActif) { _terminal?.SignalInt(); return; } // « Arrêter » → Ctrl+C sur la ligne active du TUI
        _terminal?.SignalInt(); // Ctrl+C
    }

    private void OnTerminalRestart(object sender, RoutedEventArgs e)
    {
        _terminal?.Restart();
        _écran?.Réinitialiser(); // écran net : le nouveau TUI se redessine de zéro
        _lignesBrutes.Clear();
        TerminalTranscript.Children.Clear();
        TerminalSessionBar.Text = "Session en cours...";
    }

    // ── Écran VT (décision §5.1) : WebView2 + xterm.js 5.5.0 ───────────────

    /// <summary>Crée (une fois) et initialise l'émulateur embarqué ; retombe sur le
    /// transcript TextBlock si le runtime WebView2 manque (jamais d'écran noir).</summary>
    private async void AssurerÉcran()
    {
        TerminalÉcranToggle.IsChecked = _écranActif;
        TerminalHôte.Visibility = Visibility.Visible;
        if (_écran is null)
        {
            var v = new TerminalWebView();
            v.Data += frappe => DispatcherQueue.TryEnqueue(() => _terminal?.Write(frappe));
            v.Taille += (cols, rows) =>
            {
                _dims = Aven.Bridge.FreebuffTerminal.ClampDims(cols, rows);
                _terminal?.Resize(_dims.Cols, _dims.Rows);
            };
            v.Prêt += () => DispatcherQueue.TryEnqueue(() =>
            {
                v.Write("\x1b[2J\x1b[H"); // écran net au montage : le TUI va se redessiner
                _terminal?.Resize(_dims.Cols, _dims.Rows);
            });
            TerminalHôte.Children.Insert(0, v); // sous le transcript (un seul visible)
            _écran = v;
        }
        TerminalScroll.Visibility = _écranActif ? Visibility.Collapsed : Visibility.Visible;
        _écran.Visibility = _écranActif ? Visibility.Visible : Visibility.Collapsed;
        try
        {
            await _écran.InitialiserAsync(CouleurFond(), CouleurTexte(), "#8B5CF6");
        }
        catch
        {
            // Runtime WebView2 absent (rare sur Win10 1803+) : transcript filtré, jamais d'écran noir.
            _écranActif = false;
            TerminalScroll.Visibility = Visibility.Visible;
            _écran.Visibility = Visibility.Collapsed;
            TerminalÉcranToggle.IsChecked = false;
            TerminalÉcranToggle.IsEnabled = false;
            TerminalSessionBar.Text = "Écran VT indisponible (runtime WebView2) — transcript filtré";
        }
    }

    private void OnTerminalMode(object sender, RoutedEventArgs e)
    {
        _écranActif = TerminalÉcranToggle.IsChecked == true;
        if (_écranActif) { AssurerÉcran(); return; }
        if (_écran is not null) _écran.Visibility = Visibility.Collapsed;
        TerminalScroll.Visibility = Visibility.Visible;
    }

    private static string CouleurFond() =>
        Application.Current.RequestedTheme == ApplicationTheme.Dark ? "#12151D" : "#FFFFFF";

    private static string CouleurTexte() =>
        Application.Current.RequestedTheme == ApplicationTheme.Dark ? "#E7E9F2" : "#171923";

    // ── Voix (phase 6) : dictée push-to-talk via le pipeline testé ────────

    private void InitialiserVoix()
    {
        if (_voix is not null) return;
        _voixPipeline = new Aven.Bridge.VoicePipeline(new GroqHttp());
        _voix = new VoiceRuntime(_voixPipeline);
        if (_boot.Engine is { } moteur) BrancherAnnonceur(moteur);
    }

    /// <summary>Annonceur (parité announcer.ts) : créé une fois puis branché à CHAQUE
    /// host moteur — indépendant du push-to-talk : les événements arrivent dès le boot.</summary>
    private void BrancherAnnonceur(Aven.Bridge.EngineClient moteur)
    {
        BrancherNotifications(moteur); // J7 : la politique de toast est indépendante de l'annonceur
        if (_engineAnnoncé == moteur && _annonceur is not null) return;
        _engineAnnoncé = moteur;
        // Voix Windows SAPI via PowerShell (parité speakWithSapi de main.ts).
        var annonceur = _annonceur = new Aven.Bridge.Announcer(speak: texte => Task.Run(async () =>
        {
            var sûr = texte.Replace("'", "''");
            await ExécuterPowerShell(
                $"Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('{sûr}')");
        }), settleMs: 250);
        // Parité v8.7.9 : l'annonceur est un OPT-IN (off par défaut côté web, dans
        // l'apparence) — le réglage natif sera branché avec le panneau Apparence.
        annonceur.SetEnabled(false);
        moteur.EventReceived += ev =>
        {
            var données = new Dictionary<string, string>();
            if (Aven.Bridge.JsonAide.Texte(ev.Data, "text") is { } t) données["text"] = t;
            if (Aven.Bridge.JsonAide.Texte(ev.Data, "action") is { } a) données["action"] = a;
            if (Aven.Bridge.JsonAide.Texte(ev.Data, "errorMessage") is { } m) données["errorMessage"] = m;
            annonceur.Handle(ev.Type, données);
        };
    }

    // ── Jalon 7 : notifications de bureau, tray, raccourci Ctrl+Maj+O ──────────

    /// <summary>Ramène Aven au premier plan (parité showWindow d'Electron) : restaure
    /// si réduite, montre si masquée dans le tray, puis donne le focus.</summary>
    private void MontrerFenêtre()
    {
        try
        {
            if (AppWindow.Presenter is Microsoft.UI.Windowing.OverlappedPresenter
                { State: Microsoft.UI.Windowing.OverlappedPresenterState.Minimized } réduit)
                réduit.Restore();
            AppWindow.Show(); // active aussi la fenêtre (contrat du SDK)
        }
        catch (Exception erreur) { System.Diagnostics.Debug.WriteLine("showWindow : " + erreur.Message); }
    }

    /// <summary>Sortie EXPLICITE depuis le tray (parité before-quit) : autorise la
    /// fermeture, libère les ressources, puis ferme — l'app se termine faute de fenêtre.</summary>
    private void Quitter()
    {
        _quitExplicite = true;
        try { _tray?.Dispose(); } catch { /* jamais bloquant */ }
        try { _ = _boot.DisposeAsync(); } catch { /* idem */ }
        try { Close(); }
        catch { Application.Current.Exit(); } // repli : fermeture de l'app XAML
    }

    /// <summary>Notifications pilotées par les événements moteur (J7 — parité
    /// notifyFromEvent de main.ts) : durée mesurée au session.execution.started de
    /// CHAQUE session (sous-agents inclus), politique pure NotifyPolicy, toast via
    /// l'API typée du Windows App SDK. Abonnement UNE seule fois par moteur.</summary>
    private void BrancherNotifications(Aven.Bridge.EngineClient moteur)
    {
        if (_moteurNotifié == moteur) return;
        _moteurNotifié = moteur;
        moteur.EventReceived += NotifierDepuisÉvénement;
    }

    private void NotifierDepuisÉvénement(Aven.Bridge.EngineEvent ev)
    {
        try
        {
            var sessionID = Aven.Bridge.JsonAide.Texte(ev.Data, "sessionID") ?? "";
            var maintenant = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            if (ev.Type == "session.execution.started" && sessionID.Length > 0)
            {
                lock (_verrouTours) _départsTours[sessionID] = maintenant;
                return;
            }
            if (ev.Type == "session.execution.succeeded" && sessionID.Length > 0)
            {
                long? durée = null;
                lock (_verrouTours)
                {
                    if (_départsTours.Remove(sessionID, out var départ)) durée = maintenant - départ;
                }
                Notifier(Aven.Bridge.NotifyPolicy.TourTermine, durée);
                return;
            }
            if (ev.Type == "session.execution.failed" && sessionID.Length > 0)
            {
                lock (_verrouTours) _départsTours.Remove(sessionID);
                Notifier(Aven.Bridge.NotifyPolicy.TourEchoue, null);
                return;
            }
            if (ev.Type == "permission.asked") Notifier(Aven.Bridge.NotifyPolicy.Permission, null);
            else if (ev.Type == "form.created") Notifier(Aven.Bridge.NotifyPolicy.Formulaire, null);
        }
        catch (Exception erreur)
        {
            // Jamais d'exception vers le moteur : la notification reste best-effort.
            System.Diagnostics.Debug.WriteLine("notif : " + erreur.Message);
        }
    }

    /// <summary>Applique la politique (focus + interruptateur réglages + durée) puis
    /// publie le toast. Thread arrière-plan accepté : NotificationService est thread-safe.</summary>
    private void Notifier(string type, long? duréeTourMs)
    {
        try
        {
            // Parité win.isFocused() && win.isVisible() : masquée dans le tray ⇒ la
            // fenêtre est déactivée ⇒ _fenêtreActive est déjà false (aucun accès AppWindow
            // hors thread UI ici).
            var fenêtreAuPremierPlan = _fenêtreActive;
            var activé = Aven.Bridge.SettingsService.Load(Aven.Bridge.AppData.Dir()).Notifications;
            if (!Aven.Bridge.NotifyPolicy.DevraitNotifier(fenêtreAuPremierPlan, type, activé, duréeTourMs)) return;
            var (titre, corps) = Aven.Bridge.NotifyPolicy.Contenu(type, duréeTourMs);
            Aven.Native.NotificationService.Afficher(titre, corps);
        }
        catch (Exception erreur) { System.Diagnostics.Debug.WriteLine("notif : " + erreur.Message); }
    }

    /// <summary>Push-to-talk Ctrl+Maj+V : démarre/arrête la dictée, exécute les intentions d'app.</summary>
    private async void SurPushToTalk()
    {
        InitialiserVoix();
        try
        {
            await _voix!.BasculerDictée(résultat => DispatcherQueue.TryEnqueue(() =>
            {
                if (résultat.Intent is { Kind: "app", Action: not null } intention)
                {
                    switch (intention.Action)
                    {
                        case "open-notes": OuvrirNotes(); break;
                        case "open-settings": OnSettings(this, new RoutedEventArgs()); break;
                        case "open-freebuff": OuvrirTerminal(); break;
                    }
                }
                else if (résultat.Intent is { Kind: "agent" })
                    PageHint.Text = "Dictée pour l'agent " + (résultat.Intent.Target ?? "courant") + " : " + (résultat.Cleaned ?? résultat.Raw);
                else
                    PageHint.Text = "Dictée : " + (résultat.Cleaned ?? résultat.Raw);
            }));
            PageHint.Text = _voix.EnCours ? "🎙 Dictée en cours... (Ctrl+Maj+V pour arrêter)" : "Dictée terminée";
        }
        catch (Exception erreur) { PageHint.Text = "Micro indisponible : " + erreur.Message; }
    }

    private async void ArrêterTour()
    {
        if (_chat is { } chat) await chat.StopAsync();
    }

    private void SynchroniserChat()
    {
        var chat = _chat;
        if (chat is null) return;

        // Diff incrémental : le VM ne touche que les lignes changées ; ici on reflète
        // l'ObservableCollection (insertions) et les propriétés (INPC) dans l'arbre XAML.
        // Changement de conversation (sidebar / récents) : les bulles de l'ANCIEN VM sont
        // jetées entièrement — patcher des Tags périmés afficherait le vieux transcript.
        if (!ReferenceEquals(_chatRendu, chat))
        {
            ChatRows.Children.Clear();
            _chatRendu = chat;
        }
        while (ChatRows.Children.Count > chat.Rows.Count)
            ChatRows.Children.RemoveAt(ChatRows.Children.Count - 1);
        for (var i = ChatRows.Children.Count; i < chat.Rows.Count; i++)
            ChatRows.Children.Add(FabriqueBulle(chat.Rows[i]));
        for (var i = 0; i < Math.Min(ChatRows.Children.Count, chat.Rows.Count); i++)
        {
            if (ChatRows.Children[i] is Border bordure && bordure.Tag is Aven.Bridge.ChatRow ligne) RemplirBulle(bordure, ligne);
        }

        // Dialogs bloquants (un seul à la fois) : autorisation puis question.
        if (chat.Live.Asks.Count > 0) ReconsidérerAutorisations();
        else if (chat.Live.Forms.Count > 0) ReconsidérerQuestions();

        // État du tour : Arrêter visible quand busy, Envoyer désactivé (parité v9.7).
        var busy = chat.Live.Busy;
        StopButton.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
        SendButton.IsEnabled = !busy;
        if (busy && chat.FollowBottom) ScrollBas();
        if (!busy && chat.FollowBottom && chat.Rows.Count > 0) ScrollBas();
    }

    private void ScrollBas()
    {
        ChatScroll.UpdateLayout();
        ChatScroll.ChangeView(null, ChatScroll.ScrollableHeight, zoomFactor: 1f, disableAnimation: true);
    }

    private Brush BrushDe(string clé) =>
        (Brush)Application.Current.Resources[clé];

    /// <summary>
    /// Fabrique la bulle : Border + StackPanel C# (aucun DataTemplate à compiler —
    /// leçon phase 2 : le XamlCompiler net472 crash silencieusement sur du XAML invalide,
    /// on garde l'arbre dynamique minimal et testé). Les deltas patchent les propriétés
    /// via INPC : seule CETTE bulle se re-rend, jamais la liste.
    /// </summary>
    private Border FabriqueBulle(Aven.Bridge.ChatRow ligne)
    {
        var bordure = new Border
        {
            Tag = ligne,
            CornerRadius = new CornerRadius(14),
            Padding = new Thickness(12, 8, 12, 8),
            Margin = new Thickness(0, 0, 0, 2),
            MaxWidth = 640,
            HorizontalAlignment = ligne.IsUser ? HorizontalAlignment.Right : HorizontalAlignment.Left,
            Background = ligne.IsUser ? BrushDe("AvenAccentBrush") : BrushDe("AvenPanelBrush"),
            BorderBrush = BrushDe("AvenBorderBrush"),
            BorderThickness = new Thickness(1),
        };
        var pile = new StackPanel { Spacing = 4 };
        bordure.Child = pile;
        RemplirBulle(bordure, ligne);
        ligne.PropertyChanged += (_, _) => DispatcherQueue.TryEnqueue(() =>
        {
            RemplirBulle(bordure, ligne);
            if (_chat?.FollowBottom == true) ScrollBas();
        });
        return bordure;
    }

    private void RemplirBulle(Border bordure, Aven.Bridge.ChatRow ligne)
    {
        if (bordure.Child is not StackPanel pile) return;
        pile.Children.Clear();

        if (ligne.Kind == Aven.Bridge.ChatRowKind.Error)
        {
            bordure.Background = BrushDe("AvenPanelBrush");
            bordure.BorderBrush = BrushDe("AvenDangerBrush");
            pile.Children.Add(new TextBlock
            {
                Text = ligne.Text,
                TextWrapping = TextWrapping.Wrap,
                Foreground = BrushDe("AvenDangerBrush"),
            });
            return;
        }

        bordure.BorderBrush = BrushDe("AvenBorderBrush");
        if (ligne.Text.Length > 0)
        {
            // Markdown-lite (parseur pur testé) : titres, gras, italique, code —
            // le contenu reste toujours du texte, rien n'est exécutable ni navigable.
            RemplirMarkdown(pile, ligne.Text,
                ligne.IsUser ? new SolidColorBrush(Microsoft.UI.Colors.White) : BrushDe("AvenTextBrush"));
        }
        if (ligne.Meta is { } méta)
            pile.Children.Add(new TextBlock { Text = méta, FontSize = 11, Foreground = BrushDe("AvenMutedBrush") });
        if (ligne.HasTools)
            pile.Children.Add(new TextBlock { Text = ligne.Tools, FontSize = 11, Foreground = BrushDe("AvenMutedBrush") });
        if (ligne.HasForm)
        {
            pile.Children.Add(new TextBlock
            {
                Text = ligne.Question,
                FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
                Foreground = BrushDe("AvenTextBrush"),
            });
            if (ligne.Answer is { } réponse)
                pile.Children.Add(new TextBlock { Text = réponse, FontSize = 12, Foreground = BrushDe("AvenMutedBrush") });
        }
    }

    /// <summary>Rendu du Markdown-lite (parité RichMarkdown web) : blocs de code,
    /// titres, listes à puces/numérotées, tableaux GFM, liens inertes (label visible,
    /// jamais navigable — span mdlink côté web).</summary>
    private static void RemplirMarkdown(StackPanel pile, string texte, Brush couleur)
    {
        foreach (var bloc in Aven.Bridge.MarkdownLite.Parse(texte))
        {
            switch (bloc)
            {
                case Aven.Bridge.MdCodeBlock code:
                    var encadré = new Border
                    {
                        Background = Application.Current.Resources["AvenPanelSoftBrush"] as Brush,
                        CornerRadius = new CornerRadius(8),
                        Padding = new Thickness(8, 6, 8, 6),
                    };
                    var monospace = new TextBlock
                    {
                        FontFamily = new Microsoft.UI.Xaml.Media.FontFamily("Consolas"),
                        FontSize = 12,
                        TextWrapping = TextWrapping.Wrap,
                        Foreground = couleur,
                    };
                    monospace.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run
                    {
                        Text = (code.Language.Length > 0 ? "[" + code.Language + "]\n" : "") + string.Join("\n", code.Lines),
                    });
                    encadré.Child = monospace;
                    pile.Children.Add(encadré);
                    break;

                case Aven.Bridge.MdBullet puce:
                    var lignePuce = new TextBlock
                    {
                        TextWrapping = TextWrapping.Wrap,
                        Foreground = couleur,
                        FontSize = 13,
                        Margin = new Thickness(14 + 14 * puce.Niveau, 0, 0, 0),
                    };
                    lignePuce.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = "\u2022  " });
                    AjouterSegments(lignePuce, puce.Segments, couleur);
                    pile.Children.Add(lignePuce);
                    break;

                case Aven.Bridge.MdOrdered énum:
                    var ligneNum = new TextBlock
                    {
                        TextWrapping = TextWrapping.Wrap,
                        Foreground = couleur,
                        FontSize = 13,
                        Margin = new Thickness(14, 0, 0, 0),
                    };
                    ligneNum.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = énum.Num + ".  " });
                    AjouterSegments(ligneNum, énum.Segments, couleur);
                    pile.Children.Add(ligneNum);
                    break;

                case Aven.Bridge.MdTable table:
                    pile.Children.Add(TableauDe(table, couleur));
                    break;

                case Aven.Bridge.MdLine ligne:
                    var blocTexte = new TextBlock
                    {
                        TextWrapping = TextWrapping.Wrap,
                        Foreground = couleur,
                        FontSize = ligne.HeadingLevel > 0 ? 15 : 13,
                        FontWeight = ligne.HeadingLevel > 0 ? Microsoft.UI.Text.FontWeights.SemiBold : Microsoft.UI.Text.FontWeights.Normal,
                    };
                    AjouterSegments(blocTexte, ligne.Segments, couleur);
                    pile.Children.Add(blocTexte);
                    break;
            }
        }
    }

    /// <summary>Segments → inlines : gras/italique/code, liens AFFICHÉS en Hyperlink
    /// SANS NavigateUri (aucun clic ne navigue — parité sécurité RichMarkdown).</summary>
    private static void AjouterSegments(TextBlock bloc, IReadOnlyList<Aven.Bridge.MdSegment> segments, Brush couleur)
    {
        foreach (var segment in segments)
        {
            if (segment.Link is not null)
            {
                var lien = new Microsoft.UI.Xaml.Documents.Hyperlink(); // PAS de NavigateUri : inert
                lien.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = segment.Text });
                if (Application.Current.Resources["AvenAccentBrush"] is Brush accent) lien.Foreground = accent;
                bloc.Inlines.Add(lien);
                continue;
            }
            var run = new Microsoft.UI.Xaml.Documents.Run { Text = segment.Text };
            if (segment.Bold) run.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold;
            if (segment.Italic) run.FontStyle = Windows.UI.Text.FontStyle.Italic;
            if (segment.Code) run.FontFamily = new Microsoft.UI.Xaml.Media.FontFamily("Consolas");
            bloc.Inlines.Add(run);
        }
    }

    /// <summary>Tableau GFM minimal : header en gras sur fond panel-soft, colonnes égales.</summary>
    private static Grid TableauDe(Aven.Bridge.MdTable table, Brush couleur)
    {
        var grille = new Grid { Margin = new Thickness(0, 2, 0, 2) };
        var colonnes = Math.Max(table.Header.Count, 1);
        for (var c = 0; c < colonnes; c++)
            grille.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        AjouterLigneTableau(grille, table.Header, 0, header: true, couleur);
        for (var r = 0; r < table.Rows.Count; r++)
            AjouterLigneTableau(grille, table.Rows[r], r + 1, header: false, couleur);
        return grille;
    }

    private static void AjouterLigneTableau(Grid grille, IReadOnlyList<IReadOnlyList<Aven.Bridge.MdSegment>> cellules, int ligne, bool header, Brush couleur)
    {
        for (var c = 0; c < grille.ColumnDefinitions.Count; c++)
        {
            var cellule = new TextBlock
            {
                TextWrapping = TextWrapping.Wrap,
                FontSize = 12,
                Foreground = couleur,
            };
            if (header) cellule.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold;
            if (c < cellules.Count) AjouterSegments(cellule, cellules[c], couleur);
            var cadre = new Border
            {
                Child = cellule,
                Padding = new Thickness(8, 4, 8, 4),
            };
            if (header) cadre.Background = Application.Current.Resources["AvenPanelSoftBrush"] as Brush;
            Grid.SetColumn(cadre, c);
            grille.Children.Add(cadre);
        }
    }

    private void SurFrame(object? sender, object e)
    {
        if (_chat?.Live.Busy != true) return;
        _fpsCompteur++;
        var maintenant = DateTimeOffset.UtcNow;
        if (_fpsFenêtre == default) _fpsFenêtre = maintenant;
        if ((maintenant - _fpsFenêtre).TotalSeconds < 1) return;
        _fpsHistorique.Enqueue(_fpsCompteur);
        if (_fpsHistorique.Count > 30) _fpsHistorique.Dequeue();
        var min = _fpsHistorique.Min();
        var max = _fpsHistorique.Max();
        PageHint.Text = $"Streaming — {_fpsCompteur} fps (fenêtre : {min}–{max} fps / {_fpsHistorique.Count} s)";
        _fpsCompteur = 0;
        _fpsFenêtre = maintenant;
    }

    /// <summary>Sélecteur de modèles (parité v9.4.0) : « Auto » + chaîne du routeur.</summary>
    private async void OnModelMenu(object sender, RoutedEventArgs e)
    {
        if (_boot.Client is not { } client || _chat is null) return;
        var flyout = new MenuFlyout();
        var auto = new MenuFlyoutItem { Text = _modelLabel == "Auto" ? "Auto ✓" : "Auto" };
        auto.Click += (_, _) => _ = ÉpinglerModèle(null);
        flyout.Items.Add(auto);
        flyout.Items.Add(new MenuFlyoutSeparator());
        try
        {
            var chain = await client.ChainForAsync("projet");
            if (chain is System.Text.Json.Nodes.JsonArray liste)
            {
                foreach (var item in liste)
                {
                    if (item?["ref"]?.GetValue<string>() is not { } reference) continue;
                    var label = item["label"]?.GetValue<string>() ?? reference;
                    var entrée = new MenuFlyoutItem { Text = _modelLabel == reference ? label + " ✓" : label };
                    var refCapturé = reference;
                    entrée.Click += (_, _) => _ = ÉpinglerModèle(refCapturé);
                    flyout.Items.Add(entrée);
                }
            }
            flyout.ShowAt(ModelButton);
        }
        catch (Exception erreur)
        {
            PageHint.Text = "Chaîne de modèles indisponible : " + erreur.Message;
        }
    }

    private async Task ÉpinglerModèle(string? reference)
    {
        if (_boot.Client is not { } client || _chat is null) return;
        try
        {
            var résultat = await client.SetChatModelAsync(_chat.ChatId, reference);
            _modelLabel = reference is null ? "Auto" : résultat.Model;
            ModelButton.Content = _modelLabel + " \u25BE";
            PageHint.Text = "Modèle : " + _modelLabel;
        }
        catch (Exception erreur)
        {
            PageHint.Text = "Changement impossible : " + erreur.Message;
        }
    }

    /// <summary>Autorisation d'outil en ContentDialog (parité FormDialog, décision v9.4).</summary>
    private async void ReconsidérerAutorisations()
    {
        if (_dialogOuvert || _boot.Client is not { } client || _chat is null) return;
        var demande = _chat.Live.Asks.FirstOrDefault();
        if (demande is null) return;
        _dialogOuvert = true;
        try
        {
            var dialog = new ContentDialog
            {
                XamlRoot = ChatScroll.XamlRoot,
                Title = "Autorisation demandée",
                Content = (demande.Message ?? "L'agent demande " + demande.Action)
                    + (demande.Resources.Count > 0 ? "\n" + string.Join(", ", demande.Resources) : ""),
                PrimaryButtonText = "Toujours",
                SecondaryButtonText = "Une fois",
                CloseButtonText = "Refuser",
                DefaultButton = ContentDialogButton.Secondary,
            };
            var décision = await dialog.ShowAsync();
            var réponse = décision switch
            {
                ContentDialogResult.Primary => "always",
                ContentDialogResult.Secondary => "once",
                _ => "reject",
            };
            await client.ReplyPermissionAsync(demande.SessionId, demande.Id, réponse);
        }
        catch { /* dialog fermé avec la fenêtre */ }
        finally { _dialogOuvert = false; }
    }

    /// <summary>Question de l'agent (outil « question ») en ContentDialog — parité FormDialog.</summary>
    private async void ReconsidérerQuestions()
    {
        if (_dialogOuvert || _boot.Client is not { } client || _chat is null) return;
        var question = _chat.Live.Forms.FirstOrDefault();
        if (question is null) return;
        _dialogOuvert = true;
        try
        {
            var champ = new TextBox { PlaceholderText = "Ta réponse" };
            var dialog = new ContentDialog
            {
                XamlRoot = ChatScroll.XamlRoot,
                Title = question.Raw?["title"]?.GetValue<string>() ?? "L'agent a une question",
                Content = champ,
                PrimaryButtonText = "Répondre",
                CloseButtonText = "Annuler",
                DefaultButton = ContentDialogButton.Primary,
            };
            var résultat = await dialog.ShowAsync();
            if (résultat == ContentDialogResult.Primary && champ.Text.Trim().Length > 0)
            {
                // La clé attendue est celle du premier champ du formulaire (parité web).
                var clé = question.Raw?["fields"] is System.Text.Json.Nodes.JsonArray champs
                    && champs.Count > 0 && champs[0]?["key"]?.GetValue<string>() is { } k ? k : "answer";
                await client.ReplyFormAsync(_chat.ChatId, question.Id, new Dictionary<string, object> { [clé] = champ.Text.Trim() });
            }
        }
        finally { _dialogOuvert = false; }
    }
}

using System.Text;
using Microsoft.UI.Xaml;
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
        (90, "Tâches — Spécialistes", "Le sélecteur de modes (code, analyse, recherche) arrive en phase 3."),
        (180, "Fichiers", "L'explorateur intégré de l'espace arrive en phase 4 (FilesService)."),
        (270, "Notes", "Les notes Markdown par agent arrivent en phase 4 (NotesService)."),
    };

    public MainWindow()
    {
        InitializeComponent();

        Title = "Aven";
        AppWindow.Resize(new SizeInt32(1200, 800));

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
    }

    // ── Chat (phase 3) : moteur + client + VM, ouverts depuis la carte Projet ──
    private Aven.Bridge.EngineClient? _engine;
    private Aven.Bridge.ConversationClient? _client;
    private Aven.Bridge.ChatViewModel? _chat;
    private bool _chatOuvert;
    private bool _filesOuvert, _notesOuvert;
    private string _filesRelative = "";
    private Aven.Bridge.Note? _noteOuverte;
    private string? _noteNouvelleTags;
    private bool _dialogOuvert;

    // ── Terminal Freebuff (phase 5) : machine à états testée + ConPTY réel ────
    private Aven.Bridge.FreebuffTerminal? _terminal;
    private readonly StringBuilder _tamponBrut = new();
    private readonly List<string> _lignesBrutes = [];

    // ── Écran VT (décision §5.1) : WebView2 + xterm.js (même rendu que le web) ─
    private TerminalWebView? _écran; // créé paresseusement, réutilisé entre sessions
    private bool _écranActif = true; // défaut : TUI complet (parité vue terminal web)
    private (int Cols, int Rows) _dims = (Aven.Bridge.FreebuffTerminal.DefaultCols, Aven.Bridge.FreebuffTerminal.DefaultRows);

    // ── Voix (phase 6) : pipeline testé + capture micro + annonceur ──────────
    private Aven.Bridge.GlobalHotKey? _hotkey; // raccourci OS global Ctrl+Maj+V (décision phase 6)
    private Aven.Bridge.VoicePipeline? _voixPipeline;
    private VoiceRuntime? _voix;
    private Aven.Bridge.Announcer? _annonceur;
    private string _modelLabel = "Auto";
    private readonly Queue<int> _fpsHistorique = new();
    private int _fpsCompteur;
    private DateTimeOffset _fpsFenêtre;

    private void PositionHubCards()
    {
        Placer(CardProject, Cibles[0].AngleDeg);
        Placer(CardTasks, Cibles[1].AngleDeg);
        Placer(CardFiles, Cibles[2].AngleDeg);
        Placer(CardNotes, Cibles[3].AngleDeg);
    }

    private static void Placer(Button carte, double angleDeg)
    {
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
        if (index == "0") { OuvrirChat(); return; } // carte Projet = conversation réelle (phase 3)
        if (index == "2") { OuvrirFichiers(); return; } // carte Fichiers (phase 4)
        if (index == "3") { OuvrirNotes(); return; } // carte Notes (phase 4)
        var cible = Cibles[int.Parse(index)];
        PageTitle.Text = cible.Titre;
        PageHint.Text = cible.Hint;
        OuvrirPageDepuis(carte);
    }

    private void OuvrirPageDepuis(Button source)
    {
        // Connected Animation (parité du shared element v9.7.0) : la carte du hub
        // DEVENT l'en-tête de la page — le même effet que View Transitions côté web.
        PageView.Visibility = Visibility.Visible;
        HubView.Visibility = Visibility.Collapsed;
        // Une seule vue à la fois : tout est masqué, Ouvrir* rallume le sien.
        _chatOuvert = false;
        ChatScroll.Visibility = Visibility.Collapsed;
        ComposerBar.Visibility = Visibility.Collapsed;
        FilesView.Visibility = Visibility.Collapsed;
        NotesScroll.Visibility = Visibility.Collapsed;
        SettingsPanel.Visibility = Visibility.Collapsed;
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
    }

    private void OnSettings(object sender, RoutedEventArgs e)
    {
        PageTitle.Text = "Paramètres";
        PageHint.Text = "Usage local de l'app — les clés API et espaces restent dans l'Electron Classic pour l'instant.";
        OuvrirPageDepuis(HomeButton);
        SettingsPanel.Visibility = Visibility.Visible;
        SettingsVersion.Text = "Aven " + AppVersion + " — natif WinUI 3 (WASDK 1.7)";
        try
        {
            // Stats SQLite (décision §5.3) : compteur + fenêtre 7 jours en une requête.
            var stats = Aven.Bridge.StatsSqlite.ReadDictationStats(Espace());
            var semaine = Aven.Bridge.StatsSqlite.History(Espace(), 7).Sum(h => h.Count);
            SettingsDictations.Text = $"Dictées : {stats.Total} au total · {stats.DayCount} aujourd'hui · {semaine} sur 7 jours.";
        }
        catch (Exception erreur)
        {
            SettingsDictations.Text = "Stats indisponibles : " + erreur.Message;
        }
    }

    // ── Chat réel (phase 3) — voir ChatViewModel (Aven.Bridge), testé sans WinUI ──

    private void OuvrirChat()
    {
        if (!_chatOuvert)
        {
            _chatOuvert = true;
            DémarrerChat();
        }
        SettingsPanel.Visibility = Visibility.Collapsed;
        PageTitle.Text = "Projet";
        PageHint.Text = "Conversation avec l'agent central (Freebuff)";
        ChatScroll.Visibility = Visibility.Visible;
        ComposerBar.Visibility = Visibility.Visible;
        Composer.Focus(FocusState.Programmatic);
    }

    private async void DémarrerChat()
    {
        // Le host est le bundle de phase 1 (dist-electron/aven-engine-host.mjs) : le
        // même moteur que l'app Electron — aucune logique moteur dupliquée.
        var host = ChercherHost();
        _engine = new Aven.Bridge.EngineClient(host);
        _client = new Aven.Bridge.ConversationClient(_engine);
        _chat = new Aven.Bridge.ChatViewModel(_client, AppContext.BaseDirectory,
            marshal: action => DispatcherQueue.TryEnqueue(() => action()));

        // Conversation de phase 3 : création à la volée (la relecture des anciens
        // chats arrive en phase 4). On n'attache le VM qu'APRÈS : les événements
        // d'une autre session seraient filtrés comme « child ».
        try
        {
            var ouverte = await _chat.CreateChatAsync("projet");
            _chat.Attach(ouverte.Id);
            PageHint.Text = $"Conversation {ouverte.Model}";
        }
        catch (Exception erreur)
        {
            PageHint.Text = "Moteur indisponible : " + erreur.Message;
            return;
        }

        _chat.PropertyChanged += (_, _) => SynchroniserChat();

        // Follow-bottom : l'utilisateur re-arme en revenant au bas (parité « Dernier message »).
        ChatScroll.ViewChanged += (_, _) =>
            _chat.FollowBottom = ChatScroll.VerticalOffset + ChatScroll.ViewportHeight >= ChatScroll.ExtentHeight - 40;

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
        _client.LiveChanged += _ => DispatcherQueue.TryEnqueue(SynchroniserChat);
        SynchroniserChat();
    }

    private static string ChercherHost()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidat = Path.Combine(dir.FullName, "dist-electron", "aven-engine-host.mjs");
            if (File.Exists(candidat)) return candidat;
        }
        return Path.Combine(AppContext.BaseDirectory, "aven-engine-host.mjs");
    }

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

    private static string Espace() => Directory.Exists("C:/Users/Liam/Downloads/Aven")
        ? "C:/Users/Liam/Downloads/Aven" : AppContext.BaseDirectory;

    private void OuvrirFichiers()
    {
        if (!_filesOuvert) { _filesOuvert = true; }
        SettingsPanel.Visibility = Visibility.Collapsed;
        PageTitle.Text = "Fichiers";
        PageHint.Text = "Explorateur de l'espace (lecture seule)";
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
            FilesPreviewPath.Text = "APER\u00C7U \u00B7 " + fichier.Path;
            FilesPreviewMeta.Text = TailleHumaine(fichier.Size) + (fichier.Truncated ? " \u00B7 aper\u00E7u tronqu\u00E9 (512 Kio)" : "");
            FilesPreviewContent.Text = fichier.Content;
            FilesPreview.Visibility = Visibility.Visible;
        }
        catch (Exception erreur)
        {
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

    private void OuvrirNotes()
    {
        if (!_notesOuvert) { _notesOuvert = true; }
        SettingsPanel.Visibility = Visibility.Collapsed;
        PageTitle.Text = "Notes";
        PageHint.Text = "De vrais fichiers Markdown sur ton PC, \u00E9tiquetables par agent.";
        NotesScroll.Visibility = Visibility.Visible;
        NotesDirHint.Text = Aven.Bridge.NotesService.Dir(Espace());
        ListerNotes();
    }

    private void ListerNotes()
    {
        try
        {
            var query = NotesQuery.Text.Trim().ToLowerInvariant();
            var pins = Aven.Bridge.NotesService.LoadPinned(Espace());
            var notes = Aven.Bridge.NotesService.List(Espace())
                .Where(n => query.Length == 0 || n.Title.ToLowerInvariant().Contains(query) || n.Markdown.ToLowerInvariant().Contains(query))
                .OrderByDescending(n => pins.Contains(n.Id)) // épinglées d'abord (parité visible)
                .ThenByDescending(n => n.Updated);
            NotesList.Children.Clear();
            foreach (var note in notes)
            {
                var rangée = new Button
                {
                    Content = (pins.Contains(note.Id) ? "\uD83D\uDCCC " : "") + note.Title + "   " + note.Id,
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
    }

    private void OnNoteNew(object sender, RoutedEventArgs e)
    {
        NoteEditorTitre.Text = "NOUVELLE NOTE";
        NoteTitleBox.Text = "";
        NoteBodyBox.Text = "";
        _noteNouvelleTags = null;
        NotePreview.Visibility = Visibility.Collapsed;
        NoteEditor.Visibility = Visibility.Visible;
    }

    private async void OnNoteSave(object sender, RoutedEventArgs e)
    {
        try
        {
            var id = _noteOuverte is { } ouverte && NoteEditorTitre.Text == "\u00C9DITION" ? ouverte.Id : "";
            var note = await Task.Run(() => Aven.Bridge.NotesService.Save(Espace(), id, NoteTitleBox.Text, NoteBodyBox.Text));
            _noteOuverte = note;
            if (_noteNouvelleTags is { } tag) { Aven.Bridge.NotesService.SetTags(Espace(), note.Id, new[] { tag }); _noteNouvelleTags = null; }
            NoteEditor.Visibility = Visibility.Collapsed;
            ListerNotes();
            OuvrirNote(note.Id);
        }
        catch (Exception erreur) { PageHint.Text = erreur.Message; }
    }

    private void OnNoteCancel(object sender, RoutedEventArgs e)
    {
        NoteEditor.Visibility = Visibility.Collapsed;
        if (_noteOuverte is { } note) OuvrirNote(note.Id);
    }

    // ── Terminal Freebuff (phase 5) ──────────────────────────────────────

    private void OnFreebuff(object sender, RoutedEventArgs e) => OuvrirTerminal();

    private void MasquerVues()
    {
        ChatScroll.Visibility = Visibility.Collapsed;
        ComposerBar.Visibility = Visibility.Collapsed;
        FilesView.Visibility = Visibility.Collapsed;
        NotesScroll.Visibility = Visibility.Collapsed;
        TerminalView.Visibility = Visibility.Collapsed;
        SettingsPanel.Visibility = Visibility.Collapsed;
    }

    private void OuvrirTerminal()
    {
        MasquerVues();
        PageTitle.Text = "Terminal Freebuff";
        PageHint.Text = "Le CLI gratuit, dans Aven";
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
        // Annonceur : voix Windows SAPI via PowerShell (parité speakWithSapi de main.ts).
        _annonceur = new Aven.Bridge.Announcer(speak: texte => Task.Run(async () =>
        {
            var sûr = texte.Replace("'", "''");
            await ExécuterPowerShell(
                $"Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('{sûr}')");
        }), settleMs: 250);
        _engine!.EventReceived += ev =>
        {
            var données = new Dictionary<string, string>();
            if (Aven.Bridge.JsonAide.Texte(ev.Data, "text") is { } t) données["text"] = t;
            if (Aven.Bridge.JsonAide.Texte(ev.Data, "action") is { } a) données["action"] = a;
            if (Aven.Bridge.JsonAide.Texte(ev.Data, "errorMessage") is { } m) données["errorMessage"] = m;
            _annonceur.Handle(ev.Type, données);
        };
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
        if (ChatRows.Children.Count != chat.Rows.Count)
        {
            for (var i = ChatRows.Children.Count; i < chat.Rows.Count; i++)
                ChatRows.Children.Add(FabriqueBulle(chat.Rows[i]));
        }
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
        if (_client is null || _chat is null) return;
        var flyout = new MenuFlyout();
        var auto = new MenuFlyoutItem { Text = _modelLabel == "Auto" ? "Auto ✓" : "Auto" };
        auto.Click += (_, _) => _ = ÉpinglerModèle(null);
        flyout.Items.Add(auto);
        flyout.Items.Add(new MenuFlyoutSeparator());
        try
        {
            var chain = await _client.ChainForAsync("projet");
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
        if (_client is null || _chat is null) return;
        try
        {
            var résultat = await _client.SetChatModelAsync(_chat.ChatId, reference);
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
        if (_dialogOuvert || _client is null || _chat is null) return;
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
            await _client.ReplyPermissionAsync(demande.SessionId, demande.Id, réponse);
        }
        catch { /* dialog fermé avec la fenêtre */ }
        finally { _dialogOuvert = false; }
    }

    /// <summary>Question de l'agent (outil « question ») en ContentDialog — parité FormDialog.</summary>
    private async void ReconsidérerQuestions()
    {
        if (_dialogOuvert || _client is null || _chat is null) return;
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
                await _client.ReplyFormAsync(_chat.ChatId, question.Id, new Dictionary<string, object> { [clé] = champ.Text.Trim() });
            }
        }
        finally { _dialogOuvert = false; }
    }
}

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
        FilesScroll.Visibility = Visibility.Collapsed;
        NotesScroll.Visibility = Visibility.Collapsed;
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
        PageHint.Text = "Les réglages (clés, espaces, usage) arrivent en phase 4 (SettingsService).";
        OuvrirPageDepuis(HomeButton);
    }

    // ── Chat réel (phase 3) — voir ChatViewModel (Aven.Bridge), testé sans WinUI ──

    private void OuvrirChat()
    {
        if (!_chatOuvert)
        {
            _chatOuvert = true;
            DémarrerChat();
        }
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
        PageTitle.Text = "Fichiers";
        PageHint.Text = "Explorateur de l'espace (lecture seule)";
        FilesScroll.Visibility = Visibility.Visible;
        ListerFichiers(_filesRelative);
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

    /// <summary>Rendu du Markdown-lite : blocs de code (Consolas) + lignes stylées.</summary>
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

                case Aven.Bridge.MdLine ligne:
                    var blocTexte = new TextBlock
                    {
                        TextWrapping = TextWrapping.Wrap,
                        Foreground = couleur,
                        FontSize = ligne.HeadingLevel > 0 ? 15 : 13,
                        FontWeight = ligne.HeadingLevel > 0 ? Microsoft.UI.Text.FontWeights.SemiBold : Microsoft.UI.Text.FontWeights.Normal,
                    };
                    foreach (var segment in ligne.Segments)
                    {
                        var run = new Microsoft.UI.Xaml.Documents.Run { Text = segment.Text };
                        if (segment.Bold) run.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold;
                        if (segment.Italic) run.FontStyle = Windows.UI.Text.FontStyle.Italic;
                        blocTexte.Inlines.Add(run);
                    }
                    pile.Children.Add(blocTexte);
                    break;
            }
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

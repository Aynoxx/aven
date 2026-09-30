using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
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
}

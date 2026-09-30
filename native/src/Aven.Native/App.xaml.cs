using Microsoft.UI.Xaml;

namespace Aven.Native;

/// <summary>Point d'entrée WinUI de la coquille native Aven (phase 0).</summary>
public partial class App : Application
{
    private Window? _window;

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new MainWindow();
        _window.Activate();
    }
}

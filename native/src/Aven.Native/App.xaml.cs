using Microsoft.UI.Xaml;

namespace Aven.Native;

/// <summary>Point d'entrée WinUI de la coquille native Aven (phase 0).</summary>
public partial class App : Application
{
    private Window? _window;

    public App()
    {
        InitializeComponent();
        // Télémétrie de crash LOCALE (phase 7) : trace horodatée dans
        // %LOCALAPPDATA%\Aven\crash.log — journal via System.AppDomain (le
        // debugger de CI n'existe pas ici ; parity d'esprit avec la télémétrie
        // exigée par l'acceptation phase 7).
        System.AppDomain.CurrentDomain.UnhandledException += (_, e) =>
        {
            try
            {
                // Même emplacement que le reste des données natives (AVEN_DATA_DIR
                // inclus) : un scratch de smoke isole aussi le journal de crash.
                var dossier = Aven.Bridge.AppData.Dir();
                System.IO.Directory.CreateDirectory(dossier);
                System.IO.File.AppendAllText(
                    System.IO.Path.Combine(dossier, "crash.log"),
                    $"[{System.DateTime.Now:yyyy-MM-dd HH:mm:ss}] {e.ExceptionObject}\n");
            }
            catch { /* on ne crashe jamais dans le logger de crash */ }
        };
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new MainWindow();
        _window.Activate();
    }
}

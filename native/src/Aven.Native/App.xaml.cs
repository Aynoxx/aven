using Microsoft.UI.Xaml;

namespace Aven.Native;

/// <summary>Point d'entrée WinUI de la coquille native Aven (phase 0).</summary>
public partial class App : Application
{
    private MainWindow? _window; // type concret : MontrerFenêtre (réveil mono-instance) y vit

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
        // Mono-instance (Lot 6, parité app.requestSingleInstanceLock d'electron/
        // main.ts) : un second lancement ne duplique ni fenêtre ni process OpenCode
        // sur le même espace. La deuxième instance réveille la première (parité
        // « second-instance » → showWindow) puis meurt (parité app.quit()).
        if (!Aven.Bridge.InstanceUnique.Acquérir())
        {
            Aven.Bridge.InstanceUnique.RéveillerPremière();
            Environment.Exit(0);
        }
        // Première instance : l'événement de réveil est posé AVANT d'afficher, pour
        // ne jamais rater un double-lancement pendant le boot. L'attente est
        // fire-and-forget sur le thread appelant (avant toute pompe UI ici) ;
        // le réveil lui-même est rétroprojeté sur le DispatcherQueue de la fenêtre.
        Aven.Bridge.InstanceUnique.PréparerÉvénement();
        _ = Task.Run(() =>
        {
            try
            {
                var événement = Aven.Bridge.InstanceUnique.ÉvénementRéveil;
                if (événement is null) return;
                événement.WaitOne();
                // Rétroprojection obligatoire : WaitOne tourne sur un thread pool.
                _window?.DispatcherQueue.TryEnqueue(_window.MontrerFenêtre);
            }
            catch { /* le réveil est best effort (parité showWindow try/catch) */ }
        });

        _window = new MainWindow();
        _window.Activate();
    }
}

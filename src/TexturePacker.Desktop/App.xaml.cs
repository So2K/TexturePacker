using System.IO;
using System.Windows;

namespace TexturePacker.Desktop;

public partial class App : Application
{
    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        DispatcherUnhandledException += (_, args) =>
        {
            File.AppendAllText(Path.Combine(Path.GetTempPath(), "TexturePacker-error.log"), args.Exception + Environment.NewLine);
            MessageBox.Show("Texture Packer encountered an unexpected error. Details were saved to TexturePacker-error.log in your temporary folder.", "Texture Packer", MessageBoxButton.OK, MessageBoxImage.Error);
            args.Handled = true;
        };
        if (e.Args.Length == 2 && e.Args[0] == "--smoke-test")
        {
            try { await DesktopSmoke.RunAsync(e.Args[1]); Shutdown(0); }
            catch (Exception ex)
            {
                Directory.CreateDirectory(e.Args[1]);
                File.WriteAllText(Path.Combine(e.Args[1], "failure.txt"), ex.ToString());
                Shutdown(1);
            }
            return;
        }
        var window = new MainWindow();
        MainWindow = window;
        window.Show();
    }
}

using System.Windows;
using Hub.Desktop.Configuration;
using Hub.Desktop.Diagnostics;

namespace Hub.Desktop;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        DesktopLog.Initialize();

        try
        {
            var options = DesktopOptions.Load();
            var window = new MainWindow(options);
            MainWindow = window;
            window.Show();
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Desktop startup failed", exception);
            MessageBox.Show(
                "HUB Desktop не удалось запустить. Проверьте конфигурацию приложения.",
                "HUB Desktop",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Shutdown(1);
        }
    }
}

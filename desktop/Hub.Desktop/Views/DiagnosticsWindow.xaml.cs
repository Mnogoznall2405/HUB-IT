using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Input;
using Hub.Desktop.Configuration;
using Hub.Desktop.Diagnostics;
using Hub.Desktop.ViewModels;
using Microsoft.Win32;

namespace Hub.Desktop.Views;

public partial class DiagnosticsWindow : Window
{
    private readonly DesktopDiagnosticsSnapshot _snapshot;
    private readonly DesktopSupportBundleExporter _exporter;

    public DiagnosticsWindow(
        DesktopDiagnosticsSnapshot snapshot,
        bool diagnosticsExportEnabled = true)
    {
        _snapshot = snapshot;
        _exporter = new DesktopSupportBundleExporter();
        InitializeComponent();
        var model = new DiagnosticsViewModel(snapshot);
        DataContext = model;
        RenderingWarningPanel.Visibility = model.HasRenderingWarning
            ? Visibility.Visible
            : Visibility.Collapsed;
        if (!diagnosticsExportEnabled)
        {
            ExportButton.IsEnabled = false;
            ExportButton.ToolTip = "Экспорт отключён политикой администратора";
            ExportStatusText.Text = "Создание архива отключено политикой администратора.";
        }

        Loaded += (_, _) =>
        {
            if (ExportButton.IsEnabled)
            {
                ExportButton.Focus();
            }
            else
            {
                OpenLogsButton.Focus();
            }
        };
    }

    private async void ExportButton_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new Microsoft.Win32.SaveFileDialog
        {
            Title = "Сохранить архив диагностики HUB Desktop",
            Filter = "ZIP-архив (*.zip)|*.zip",
            AddExtension = true,
            DefaultExt = ".zip",
            FileName = $"HUB-Desktop-Diagnostics-{DateTime.Now:yyyyMMdd-HHmm}.zip",
            OverwritePrompt = true,
        };
        if (dialog.ShowDialog(this) != true)
        {
            return;
        }

        ExportButton.IsEnabled = false;
        OpenLogsButton.IsEnabled = false;
        ExportStatusText.Text = "Создаём очищенный архив…";
        try
        {
            await Task.Run(() => _exporter.Export(dialog.FileName, _snapshot));
            ExportStatusText.Text =
                $"Архив создан: {Path.GetFileName(dialog.FileName)}";
            DesktopLog.Info("Desktop support bundle exported");
        }
        catch (Exception exception)
        {
            ExportStatusText.Text =
                "Не удалось создать архив. Выберите другую папку и повторите попытку.";
            DesktopLog.Error("Desktop support bundle export failed", exception);
        }
        finally
        {
            ExportButton.IsEnabled = true;
            OpenLogsButton.IsEnabled = true;
        }
    }

    private void OpenLogsButton_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            Directory.CreateDirectory(DesktopPaths.LogsFolder);
            _ = Process.Start(new ProcessStartInfo(DesktopPaths.LogsFolder)
            {
                UseShellExecute = true,
            });
            DesktopLog.Info("Desktop logs folder opened");
        }
        catch (Exception exception)
        {
            ExportStatusText.Text =
                "Не удалось открыть папку логов. Создайте архив для поддержки.";
            DesktopLog.Error("Desktop logs folder could not be opened", exception);
        }
    }

    private void CloseButton_Click(object sender, RoutedEventArgs e) => Close();

    private void Window_PreviewKeyDown(
        object sender,
        System.Windows.Input.KeyEventArgs e)
    {
        if (e.Key != Key.Escape)
        {
            return;
        }

        e.Handled = true;
        Close();
    }
}

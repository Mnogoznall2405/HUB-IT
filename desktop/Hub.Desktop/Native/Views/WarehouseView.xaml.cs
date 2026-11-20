using System.IO;
using System.Windows;
using Hub.Desktop.Diagnostics;
using Hub.Desktop.Native.ViewModels;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Раздел «Склад 1С»: остатки, ведомость движений с карточкой документа
/// и склады уволенных. Выгрузка файлов документа идёт через SaveFileDialog —
/// диалог живёт здесь, VM отдаёт только событие и метод выгрузки в поток.
/// </summary>
public partial class WarehouseView : System.Windows.Controls.UserControl
{
    public WarehouseView()
    {
        InitializeComponent();
        DataContextChanged += WarehouseView_DataContextChanged;
    }

    private void WarehouseView_DataContextChanged(object sender, DependencyPropertyChangedEventArgs e)
    {
        if (e.OldValue is WarehouseViewModel oldModel)
        {
            oldModel.FileDownloadRequested -= ViewModel_FileDownloadRequested;
        }

        if (e.NewValue is WarehouseViewModel newModel)
        {
            newModel.FileDownloadRequested += ViewModel_FileDownloadRequested;
        }
    }

    private async void ViewModel_FileDownloadRequested(
        object? sender,
        WarehouseMovementFileItemViewModel file)
    {
        if (DataContext is not WarehouseViewModel viewModel)
        {
            return;
        }

        var dialog = new Microsoft.Win32.SaveFileDialog
        {
            FileName = file.Name,
            Filter = "Все файлы|*.*",
            Title = "Сохранить файл документа 1С",
        };
        if (dialog.ShowDialog() != true)
        {
            return;
        }

        try
        {
            await using var stream = new System.IO.FileStream(
                dialog.FileName,
                System.IO.FileMode.Create,
                System.IO.FileAccess.Write,
                System.IO.FileShare.None);
            await viewModel.DownloadMovementFileAsync(file, stream, CancellationToken.None);
        }
        catch (Exception exception)
        {
            file.StatusText = "Не удалось сохранить файл";
            DesktopLog.Error("Warehouse 1C file download failed", exception);
        }
    }
}

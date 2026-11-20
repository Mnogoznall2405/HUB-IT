using System.Collections.Generic;
using System.Windows;
using Hub.Desktop.Native.ViewModels;
using Button = System.Windows.Controls.Button;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>Страница «База»: поиск + фильтры, список слева, карточка справа.</summary>
public partial class DatabaseView : UserControl
{
    public DatabaseView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
        // Шов выбора файла «+ Добавить фото»/«Загрузить акт» живёт в code-behind (OpenFileDialog — UI).
        DataContextChanged += (_, _) =>
        {
            if (DataContext is DatabaseViewModel viewModel)
            {
                viewModel.PhotoFilePicker = PickPhotoFile;
                viewModel.ActFilePicker = PickActFile;
            }
        };
    }

    /// <summary>
    /// OpenFileDialog «+ Добавить фото»: только изображения allowlist'а бэкенда,
    /// один файл за раз (мультивыбор веба здесь не нужен).
    /// </summary>
    private IReadOnlyList<string> PickPhotoFile()
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Multiselect = false,
            Title = "Выбрать фото оборудования",
            Filter = "Изображения (*.jpg;*.jpeg;*.png;*.gif;*.webp;*.bmp)|*.jpg;*.jpeg;*.png;*.gif;*.webp;*.bmp",
        };
        var owner = Window.GetWindow(this);
        return dialog.ShowDialog(owner) == true ? dialog.FileNames : [];
    }

    /// <summary>
    /// OpenFileDialog «⇪ Загрузить акт»: только PDF подписанного акта —
    /// allowlist как у веб-пикера (accept="application/pdf,.pdf").
    /// </summary>
    private IReadOnlyList<string> PickActFile()
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Multiselect = false,
            Title = "Выбрать подписанный акт",
            Filter = "PDF-файл акта (*.pdf)|*.pdf",
        };
        var owner = Window.GetWindow(this);
        return dialog.ShowDialog(owner) == true ? dialog.FileNames : [];
    }

    /// <summary>Кнопка «Поле: … ▾» — меню полей серверного поиска.</summary>
    private void FieldFilterMenuButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { ContextMenu: { } menu } button
            || DataContext is not DatabaseViewModel model)
        {
            return;
        }

        menu.PlacementTarget = button;
        menu.ItemsSource = model.FieldFilterOptions;
        menu.IsOpen = true;
    }

    /// <summary>Кнопка «Тип: … ▾» — меню типов оборудования из справочника.</summary>
    private void TypeFilterMenuButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { ContextMenu: { } menu } button
            || DataContext is not DatabaseViewModel model)
        {
            return;
        }

        menu.PlacementTarget = button;
        menu.ItemsSource = model.TypeFilterOptions;
        menu.IsOpen = true;
    }

    /// <summary>Esc в оверлее передачи — закрытие диалога (как ✕/Отмена).</summary>
    private void TransferOverlay_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != System.Windows.Input.Key.Escape
            || DataContext is not DatabaseViewModel model
            || model.Transfer is null)
        {
            return;
        }

        model.Transfer.CloseCommand.Execute(null);
        e.Handled = true;
    }

    /// <summary>Esc в редакторе карточки — закрытие диалога (как ✕/Отмена).</summary>
    private void EditorOverlay_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != System.Windows.Input.Key.Escape
            || DataContext is not DatabaseViewModel model
            || model.Editor is null)
        {
            return;
        }

        model.Editor.CloseCommand.Execute(null);
        e.Handled = true;
    }

    /// <summary>Esc в панели сотрудника — закрытие оверлея (как ✕).</summary>
    private void EmployeeOverlay_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != System.Windows.Input.Key.Escape
            || DataContext is not DatabaseViewModel model
            || model.Employee is null)
        {
            return;
        }

        model.Employee.CloseCommand.Execute(null);
        e.Handled = true;
    }

    /// <summary>Esc в просмотре фото — закрытие оверлея (как «✕ Закрыть»).</summary>
    private void PhotoViewerOverlay_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != System.Windows.Input.Key.Escape
            || DataContext is not DatabaseViewModel model
            || !model.IsPhotoViewerOpen)
        {
            return;
        }

        model.ClosePhotoViewerCommand.Execute(null);
        e.Handled = true;
    }

    /// <summary>Esc в диалоге загрузки фото — закрытие, если загрузка не идёт.</summary>
    private void PhotoUploadOverlay_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != System.Windows.Input.Key.Escape
            || DataContext is not DatabaseViewModel model
            || model.PhotoUpload is null)
        {
            return;
        }

        model.PhotoUpload.CloseCommand.Execute(null);
        e.Handled = true;
    }

    /// <summary>Esc в диалоге загрузки акта — закрытие (как ✕/Закрыть).</summary>
    private void UploadActOverlay_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != System.Windows.Input.Key.Escape
            || DataContext is not DatabaseViewModel model
            || model.UploadAct is null)
        {
            return;
        }

        model.UploadAct.CloseCommand.Execute(null);
        e.Handled = true;
    }

    /// <summary>Esc в диалоге причины отклонения — как «Отмена» (не во время запроса).</summary>
    private void PhotoRejectOverlay_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != System.Windows.Input.Key.Escape
            || DataContext is not DatabaseViewModel model
            || !model.IsPhotoRejectOpen)
        {
            return;
        }

        model.CancelRejectPhotoCommand.Execute(null);
        e.Handled = true;
    }

    /// <summary>Esc в регистрации работы — закрытие диалога (как ✕/Отмена).</summary>
    private void MaintenanceOverlay_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != System.Windows.Input.Key.Escape
            || DataContext is not DatabaseViewModel model
            || model.Maintenance is null)
        {
            return;
        }

        model.Maintenance.CloseCommand.Execute(null);
        e.Handled = true;
    }
}

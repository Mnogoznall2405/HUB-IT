using System.Collections.Generic;
using System.Windows;
using Hub.Desktop.Native.ViewModels;
using Button = System.Windows.Controls.Button;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using MessageBox = System.Windows.MessageBox;
using MessageBoxButton = System.Windows.MessageBoxButton;
using MessageBoxImage = System.Windows.MessageBoxImage;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>Страница «Мои файлы»: диски/библиотеки слева, содержимое и действия справа.</summary>
public partial class MyFilesView : UserControl
{
    public MyFilesView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
        // Швы выбора файла и подтверждения удаления живут в code-behind (UI-зависимость).
        DataContextChanged += (_, _) =>
        {
            if (DataContext is MyFilesViewModel viewModel)
            {
                viewModel.FilePicker = PickUploadFiles;
                viewModel.ConfirmDelete = ConfirmDelete;
            }
        };
    }

    /// <summary>OpenFileDialog для загрузки — паттерн композера почты (Multiselect, owner-окно).</summary>
    private IReadOnlyList<string> PickUploadFiles()
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Multiselect = true,
            Title = "Загрузить файлы",
        };
        var owner = Window.GetWindow(this);
        return dialog.ShowDialog(owner) == true ? dialog.FileNames : [];
    }

    /// <summary>Подтверждение удаления перед backend-вызовом (в корзину).</summary>
    private bool ConfirmDelete(string prompt)
    {
        var owner = Window.GetWindow(this);
        return MessageBox.Show(
            owner,
            prompt,
            "Удаление",
            MessageBoxButton.YesNo,
            MessageBoxImage.Warning) == MessageBoxResult.Yes;
    }

    /// <summary>Кнопка «Хранить: … ▾» — меню сроков хранения (паттерн фильтров адресной книги).</summary>
    private void RetentionMenuButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { ContextMenu: { } menu } button
            || DataContext is not MyFilesViewModel viewModel)
        {
            return;
        }

        menu.PlacementTarget = button;
        menu.ItemsSource = viewModel.RetentionOptions;
        menu.IsOpen = true;
    }

    /// <summary>Enter — подтвердить имя, Esc — отменить редактирование.</summary>
    private void NameEditorInput_KeyDown(object sender, KeyEventArgs e)
    {
        if (DataContext is not MyFilesViewModel viewModel)
        {
            return;
        }

        if (e.Key == System.Windows.Input.Key.Enter)
        {
            viewModel.ConfirmNameEditorCommand.Execute(null);
            e.Handled = true;
        }
        else if (e.Key == System.Windows.Input.Key.Escape)
        {
            viewModel.CancelNameEditorCommand.Execute(null);
            e.Handled = true;
        }
    }
}

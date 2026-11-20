using System.Windows;
using Hub.Desktop.Native.ViewModels;
using Key = System.Windows.Input.Key;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Страница «Администрирование»: левое меню секций (как в веб-админке /admin),
/// списки с поиском и деталь отдела. PasswordBox не поддерживает привязку —
/// значение передаётся в VM через SubmitAsync из code-behind.
/// </summary>
public partial class AdminView : UserControl
{
    public AdminView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
        // Шов выбора файлов редактора новостей — OpenFileDialog в code-behind
        // (как ComposeFilePicker у почты), тесты подставляют заглушку путей.
        DataContextChanged += (_, _) =>
        {
            if (DataContext is AdminViewModel viewModel)
            {
                viewModel.NewsFilePicker = PickNewsFiles;
            }
        };
    }

    /// <summary>OpenFileDialog для «📎 Прикрепить» редактора новости — паттерн композера почты.</summary>
    private IReadOnlyList<string> PickNewsFiles()
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Multiselect = true,
            Title = "Прикрепить файлы к новости",
        };
        var owner = Window.GetWindow(this);
        return dialog.ShowDialog(owner) == true ? dialog.FileNames : [];
    }

    /// <summary>Esc в оверлее редактора пользователя — закрытие диалога (как ✕/Отмена).</summary>
    private void UserEditorOverlay_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Escape
            || DataContext is not AdminViewModel model
            || model.UserEditor is null)
        {
            return;
        }

        model.UserEditor.CloseCommand.Execute(null);
        e.Handled = true;
    }

    /// <summary>«Сохранить» — пароль из PasswordBox + вызов SubmitAsync редактора.</summary>
    private async void UserEditorSave_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is not AdminViewModel model || model.UserEditor is null)
        {
            return;
        }

        await model.UserEditor.SubmitAsync(UserEditorPasswordBox.Password);
    }

    /// <summary>Esc в оверлее редактора AI-бота — закрытие диалога (как ✕/Отмена).</summary>
    private void AiBotEditorOverlay_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Escape
            || DataContext is not AdminViewModel model
            || model.AiBotEditor is null)
        {
            return;
        }

        model.AiBotEditor.CloseCommand.Execute(null);
        e.Handled = true;
    }

    /// <summary>«Сохранить» AI-бота — вызов SubmitAsync редактора.</summary>
    private async void AiBotEditorSave_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is not AdminViewModel model || model.AiBotEditor is null)
        {
            return;
        }

        await model.AiBotEditor.SubmitAsync();
    }

    /// <summary>Esc в оверлее «Руководители отдела» — закрытие диалога.</summary>
    private void DepartmentManagersOverlay_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Escape
            || DataContext is not AdminViewModel model
            || model.DepartmentManagersEditor is null)
        {
            return;
        }

        model.DepartmentManagersEditor.CloseCommand.Execute(null);
        e.Handled = true;
    }

    /// <summary>«Сохранить» руководителей — PUT полным набором через SubmitAsync.</summary>
    private async void DepartmentManagersSave_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is not AdminViewModel model || model.DepartmentManagersEditor is null)
        {
            return;
        }

        await model.DepartmentManagersEditor.SubmitAsync();
    }

    /// <summary>Esc в оверлее редактора новости — закрытие диалога (как ✕/Отмена).</summary>
    private void NewsEditorOverlay_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Escape
            || DataContext is not AdminViewModel model
            || model.NewsEditor is null)
        {
            return;
        }

        model.NewsEditor.CloseCommand.Execute(null);
        e.Handled = true;
    }

    /// <summary>Esc в оверлее «Статистика» — закрытие (как ✕).</summary>
    private void NewsStatsOverlay_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Escape
            || DataContext is not AdminViewModel model
            || model.NewsStats is null)
        {
            return;
        }

        model.NewsStats.CloseCommand.Execute(null);
        e.Handled = true;
    }
}

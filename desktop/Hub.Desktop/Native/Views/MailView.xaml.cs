using System.Collections.Generic;
using System.Windows;
using Hub.Desktop.Native.ViewModels;
using Button = System.Windows.Controls.Button;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using TextBox = System.Windows.Controls.TextBox;
using TextChangedEventArgs = System.Windows.Controls.TextChangedEventArgs;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>Страница «Почта»: папки, список писем и панель чтения.</summary>
public partial class MailView : UserControl
{
    public MailView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
        // Шов выбора файлов композера живёт в code-behind (OpenFileDialog — UI).
        DataContextChanged += (_, _) =>
        {
            if (DataContext is MailViewModel viewModel)
            {
                viewModel.ComposeFilePicker = PickComposeFiles;
            }
        };
    }

    private void SearchInput_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == System.Windows.Input.Key.Enter)
        {
            (DataContext as MailViewModel)?.RefreshCommand.Execute(null);
            e.Handled = true;
        }
    }

    /// <summary>OpenFileDialog для «📎» композера — паттерн ChatView (Multiselect, owner-окно).</summary>
    private IReadOnlyList<string> PickComposeFiles()
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Multiselect = true,
            Title = "Прикрепить файлы к письму",
        };
        var owner = Window.GetWindow(this);
        return dialog.ShowDialog(owner) == true ? dialog.FileNames : [];
    }

    /// <summary>Кнопка «Переместить ▾» в панели чтения: открывает меню папок-целей.</summary>
    private void MoveMenuButton_Click(object sender, RoutedEventArgs e)
    {
        OpenMoveMenu(sender);
    }

    /// <summary>Кнопка «Переместить ▾» bulk-бара: то же меню, команда — BulkMoveCommand.</summary>
    private void BulkMoveMenuButton_Click(object sender, RoutedEventArgs e)
    {
        OpenMoveMenu(sender);
    }

    private void OpenMoveMenu(object sender)
    {
        if (sender is not Button { ContextMenu: { } menu } button
            || DataContext is not MailViewModel viewModel)
        {
            return;
        }

        menu.PlacementTarget = button;
        menu.ItemsSource = viewModel.MoveTargets;
        menu.IsOpen = true;
    }

    // ---- Автоподсказка контактов в композере ----

    private MailComposeViewModel? ComposerModel() => (DataContext as MailViewModel)?.Composer;

    /// <summary>
    /// Ввод в поле адресатов: подсказки ищутся только при живом наборе
    /// (сфокусированное поле) — программный префилл reply/draft popup не открывает.
    /// </summary>
    private void RecipientTextBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (sender is TextBox { Tag: string field } box && box.IsFocused)
        {
            ContactPopup.PlacementTarget = box;
            ComposerModel()?.ScheduleContactSuggestions(field);
        }
    }

    /// <summary>Popup один на три поля: якорь — последнее сфокусированное поле.</summary>
    private void RecipientTextBox_GotFocus(object sender, RoutedEventArgs e)
    {
        if (sender is TextBox box)
        {
            ContactPopup.PlacementTarget = box;
        }
    }

    /// <summary>Escape закрывает подсказки; клик вне — StaysOpen=False у Popup.</summary>
    private void RecipientTextBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == System.Windows.Input.Key.Escape
            && ComposerModel() is { IsContactPopupOpen: true } composer)
        {
            composer.CloseContactSuggestions();
            e.Handled = true;
        }
    }

    /// <summary>Подписка на смену композера: после подстановки контакта возвращаем фокус в поле.</summary>
    private void ComposerGrid_DataContextChanged(object sender, DependencyPropertyChangedEventArgs e)
    {
        if (e.OldValue is MailComposeViewModel oldComposer)
        {
            oldComposer.SuggestionApplied -= FocusRecipientField;
        }

        if (e.NewValue is MailComposeViewModel composer)
        {
            composer.SuggestionApplied += FocusRecipientField;
        }
    }

    private void FocusRecipientField(string field)
    {
        var box = field switch
        {
            "cc" => CcInput,
            "bcc" => BccInput,
            _ => ToInput,
        };
        box.Focus();
        box.CaretIndex = box.Text.Length;
    }
}

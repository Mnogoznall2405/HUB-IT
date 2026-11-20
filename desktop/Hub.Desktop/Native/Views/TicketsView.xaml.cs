using System.Collections;
using System.Collections.Generic;
using System.Windows;
using Hub.Desktop.Native.ViewModels;
using Button = System.Windows.Controls.Button;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>Страница «Билеты»: фильтры + список заявок слева, карточка справа.</summary>
public partial class TicketsView : UserControl
{
    public TicketsView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
        // Шов выбора файлов формы «Новая заявка» и карточки живёт в code-behind
        // (OpenFileDialog — UI): один диалог на обе точки входа.
        DataContextChanged += (_, _) =>
        {
            if (DataContext is TicketsViewModel viewModel)
            {
                viewModel.CreateFilePicker = PickCreateFiles;
                viewModel.DetailFilePicker = PickCreateFiles;
                // Админка создаётся лениво при входе в режим «Управление» —
                // её швы диалогов ставим по мере появления.
                viewModel.PropertyChanged += (_, args) =>
                {
                    if (args.PropertyName == nameof(TicketsViewModel.Admin)
                        && viewModel.Admin is { } admin)
                    {
                        admin.ImportFilePicker = PickImportFile;
                        admin.SaveFilePicker = PickSaveFile;
                    }
                };
            }
        };
    }

    /// <summary>OpenFileDialog «Выбрать файл .xlsx» вкладки «Импорт» (лимит 50 МБ — у VM).</summary>
    private string? PickImportFile()
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Multiselect = false,
            Title = "Файл импорта билетов",
            Filter = "Книга Excel (*.xlsx)|*.xlsx",
        };
        var owner = Window.GetWindow(this);
        return dialog.ShowDialog(owner) == true ? dialog.FileName : null;
    }

    /// <summary>SaveFileDialog экспортов админки: имя подставляет VM, путь выбирает пользователь.</summary>
    private string? PickSaveFile(string suggestedName)
    {
        var dialog = new Microsoft.Win32.SaveFileDialog
        {
            Title = "Сохранить отчёт",
            Filter = "Книга Excel (*.xlsx)|*.xlsx",
            FileName = suggestedName,
        };
        var owner = Window.GetWindow(this);
        return dialog.ShowDialog(owner) == true ? dialog.FileName : null;
    }

    /// <summary>OpenFileDialog для «📎 Прикрепить» формы создания и карточки — паттерн композера почты.</summary>
    private IReadOnlyList<string> PickCreateFiles()
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Multiselect = true,
            Title = "Прикрепить файлы к заявке",
            Filter = "Билеты и документы (*.pdf;*.jpg;*.jpeg;*.png;*.doc;*.docx;*.xls;*.xlsx)|*.pdf;*.jpg;*.jpeg;*.png;*.doc;*.docx;*.xls;*.xlsx",
        };
        var owner = Window.GetWindow(this);
        return dialog.ShowDialog(owner) == true ? dialog.FileNames : [];
    }

    private void SearchInput_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == System.Windows.Input.Key.Enter)
        {
            (DataContext as TicketsViewModel)?.RefreshCommand.Execute(null);
            e.Handled = true;
        }
    }

    /// <summary>Enter (без Shift) в поле комментария — отправка; Shift+Enter — перевод строки.</summary>
    private void CommentInput_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == System.Windows.Input.Key.Enter
            && System.Windows.Input.Keyboard.Modifiers == System.Windows.Input.ModifierKeys.None
            && DataContext is TicketsViewModel viewModel
            && viewModel.SendCommentCommand.CanExecute(null))
        {
            viewModel.SendCommentCommand.Execute(null);
            e.Handled = true;
        }
    }

    /// <summary>Кнопка «Статус: … ▾» — меню статусов (паттерн «Переместить ▾» MailView).</summary>
    private void StatusFilterMenuButton_Click(object sender, RoutedEventArgs e)
    {
        OpenFilterMenu(sender, (DataContext as TicketsViewModel)?.StatusFilterOptions);
    }

    /// <summary>Кнопка «Объект: … ▾» — меню справочника объектов.</summary>
    private void ObjectFilterMenuButton_Click(object sender, RoutedEventArgs e)
    {
        OpenFilterMenu(sender, (DataContext as TicketsViewModel)?.ObjectFilterOptions);
    }

    private static void OpenFilterMenu(object sender, IEnumerable? itemsSource)
    {
        if (sender is not Button { ContextMenu: { } menu } button || itemsSource is null)
        {
            return;
        }

        menu.PlacementTarget = button;
        menu.ItemsSource = itemsSource;
        menu.IsOpen = true;
    }
}

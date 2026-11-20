using System.Collections.Generic;
using System.Windows;
using Hub.Desktop.Native.ViewModels;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>Страница «Мои задачи»: список, фильтры, детали и переходы.</summary>
public partial class TasksView : UserControl
{
    public TasksView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
        // Шов выбора файлов карточки живёт в code-behind (OpenFileDialog — UI),
        // как DetailFilePicker у билетов; шов сохранения отчёта аналитики —
        // SaveFileDialog.
        DataContextChanged += (_, _) =>
        {
            if (DataContext is TasksViewModel viewModel)
            {
                viewModel.DetailFilePicker = PickDetailFiles;
                viewModel.Analytics.ExportTargetPicker = PickAnalyticsExportTarget;
            }
        };
    }

    /// <summary>SaveFileDialog для «⭳ Excel» аналитики: suggestedName из VM, null — отмена.</summary>
    private string? PickAnalyticsExportTarget(string suggestedName)
    {
        var dialog = new Microsoft.Win32.SaveFileDialog
        {
            Title = "Сохранить отчёт по задачам",
            FileName = suggestedName,
            DefaultExt = ".xlsx",
            Filter = "Книга Excel (*.xlsx)|*.xlsx",
        };
        var owner = Window.GetWindow(this);
        return dialog.ShowDialog(owner) == true ? dialog.FileName : null;
    }

    /// <summary>OpenFileDialog для «📎 Прикрепить» карточки задачи — фильтр ALLOWED_UPLOAD_EXTENSIONS backend'а.</summary>
    private IReadOnlyList<string> PickDetailFiles()
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Multiselect = true,
            Title = "Прикрепить файлы к задаче",
            Filter = "Документы и изображения (*.pdf;*.doc;*.docx;*.xls;*.xlsx;*.ppt;*.pptx;*.jpg;*.jpeg;*.png;*.txt;*.zip)|*.pdf;*.doc;*.docx;*.xls;*.xlsx;*.ppt;*.pptx;*.jpg;*.jpeg;*.png;*.txt;*.zip",
        };
        var owner = Window.GetWindow(this);
        return dialog.ShowDialog(owner) == true ? dialog.FileNames : [];
    }

    private void SearchInput_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == System.Windows.Input.Key.Enter)
        {
            (DataContext as TasksViewModel)?.RefreshCommand.Execute(null);
            e.Handled = true;
        }
    }

    /// <summary>Escape в оверлее создания — то же, что «✕»/«Отмена» формы.</summary>
    private void CreateOverlay_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == System.Windows.Input.Key.Escape
            && DataContext is TasksViewModel viewModel
            && viewModel.Create?.CloseCommand.CanExecute(null) == true)
        {
            viewModel.Create.CloseCommand.Execute(null);
            e.Handled = true;
        }
    }

    /// <summary>Enter (без Shift) в поле комментария — отправка; Shift+Enter — перевод строки.</summary>
    private void CommentInput_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == System.Windows.Input.Key.Enter
            && System.Windows.Input.Keyboard.Modifiers == System.Windows.Input.ModifierKeys.None
            && DataContext is TasksViewModel viewModel
            && viewModel.SendCommentCommand.CanExecute(null))
        {
            viewModel.SendCommentCommand.Execute(null);
            e.Handled = true;
        }
    }
}

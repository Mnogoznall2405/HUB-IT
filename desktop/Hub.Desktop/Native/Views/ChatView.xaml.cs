using System.Collections.Specialized;
using System.Windows;
using Hub.Desktop.Native.ViewModels;
using Key = System.Windows.Input.Key;
using Keyboard = System.Windows.Input.Keyboard;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using ModifierKeys = System.Windows.Input.ModifierKeys;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Страница «Чат»: список диалогов, пузырьковая лента и composer.
/// Enter — отправить, Shift+Enter — новая строка. Автоскролл к последнему
/// сообщению при добавлении в конец ленты.
/// </summary>
public partial class ChatView : UserControl
{
    public ChatView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
        DataContextChanged += ChatView_DataContextChanged;
    }

    private void ChatView_DataContextChanged(object sender, DependencyPropertyChangedEventArgs e)
    {
        if (e.OldValue is ChatViewModel oldModel)
        {
            oldModel.Messages.CollectionChanged -= Messages_CollectionChanged;
        }

        if (e.NewValue is ChatViewModel model)
        {
            model.Messages.CollectionChanged += Messages_CollectionChanged;
            model.AttachmentPicker = PickAttachmentFiles;
            model.ExportTargetPicker = PickExportTarget;
            ScrollToLastMessage();
        }
    }

    /// <summary>Диалог выбора файлов для «скрепки» — view-слой, VM не тянет Win32.</summary>
    private IReadOnlyList<string> PickAttachmentFiles()
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Multiselect = true,
            Title = "Прикрепить файлы к сообщению",
            Filter = "Все файлы (*.*)|*.*",
        };
        var owner = Window.GetWindow(this);
        var result = owner is null ? dialog.ShowDialog() : dialog.ShowDialog(owner);
        return result == true ? dialog.FileNames : [];
    }

    /// <summary>
    /// SaveFileDialog для «Экспорт»: фильтр txt|json выбирает формат запроса
    /// (как два пункта меню в web), имя файла — от Content-Disposition сервера
    /// недоступно до открытия диалога, поэтому подставляем имя диалога.
    /// </summary>
    private ChatExportTarget? PickExportTarget(ConversationItemViewModel conversation)
    {
        var dialog = new Microsoft.Win32.SaveFileDialog
        {
            Title = "Экспорт истории диалога",
            FileName = "chat-" + conversation.Id,
            Filter = "Текст (*.txt)|*.txt|JSON (*.json)|*.json",
            FilterIndex = 1,
            AddExtension = true,
        };
        var owner = Window.GetWindow(this);
        var result = owner is null ? dialog.ShowDialog() : dialog.ShowDialog(owner);
        if (result != true)
        {
            return null;
        }

        return new ChatExportTarget(dialog.FileName, dialog.FilterIndex == 2 ? "json" : "txt");
    }

    private void Messages_CollectionChanged(object? sender, NotifyCollectionChangedEventArgs e)
    {
        // Скроллим только при добавлении в конец: подгрузка «ранее» вверх
        // ленты не должна дёргать позицию пользователя.
        var appendedAtEnd = e.Action == NotifyCollectionChangedAction.Add
            && e.NewItems is not null
            && e.NewStartingIndex >= MessagesList.Items.Count - e.NewItems.Count;
        if (appendedAtEnd)
        {
            ScrollToLastMessage();
        }
    }

    private void ScrollToLastMessage()
    {
        if (MessagesList.Items.Count == 0)
        {
            return;
        }

        var last = MessagesList.Items[MessagesList.Items.Count - 1];
        Dispatcher.BeginInvoke(new Action(() => MessagesList.ScrollIntoView(last)));
    }

    // PreviewKeyDown, а не KeyDown: при AcceptsReturn=True классовый
    // TextBoxBase.OnKeyDown вставляет перевод строки и помечает Enter
    // Handled раньше instance-обработчиков — KeyDown сюда не доходит.
    private void ComposerInput_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter || (Keyboard.Modifiers & ModifierKeys.Shift) != 0)
        {
            return;
        }

        if (DataContext is ChatViewModel model && model.SendCommand.CanExecute(null))
        {
            model.SendCommand.Execute(null);
        }

        e.Handled = true;
    }
}

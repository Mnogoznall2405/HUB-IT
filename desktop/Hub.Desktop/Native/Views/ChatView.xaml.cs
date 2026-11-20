using System.Collections.Specialized;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media.Imaging;
using Hub.Desktop.Native.ViewModels;
using DataFormats = System.Windows.DataFormats;
using DataObject = System.Windows.DataObject;
using DragDropEffects = System.Windows.DragDropEffects;
using DragEventArgs = System.Windows.DragEventArgs;
using IDataObject = System.Windows.IDataObject;
using ICommand = System.Windows.Input.ICommand;
using Key = System.Windows.Input.Key;
using Keyboard = System.Windows.Input.Keyboard;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using ModifierKeys = System.Windows.Input.ModifierKeys;
using MouseButtonEventArgs = System.Windows.Input.MouseButtonEventArgs;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Страница «Чат»: список диалогов, пузырьковая лента и composer.
/// Enter — отправить, Shift+Enter — новая строка. Автоскролл к последнему
/// сообщению при добавлении в конец ленты.
/// </summary>
public partial class ChatView : UserControl
{
    // Скролл-память по диалогам (tg restore position): офсет храним как долю
    // ScrollableHeight — устойчива к росту истории; «у конца» возвращается
    // в конец. Восстановление — после IsLoadingMessages=false, когда лента
    // уже отрисована; первый заход в диалог — стандартный автоскролл вниз.
    private readonly Dictionary<string, double> _scrollFractions = new(StringComparer.Ordinal);
    private string? _activeConversationId;
    private double _pendingRestoreFraction = -1;
    private ScrollViewer? _messagesScroller;

    public ChatView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
        DataContextChanged += ChatView_DataContextChanged;
        // Ctrl+V перехватываем до TextBox: файлы/картинка из буфера уходят
        // в upload-пайплайн, обычный текст вставляется как раньше.
        DataObject.AddPastingHandler(ComposerInput, OnComposerPasting);
        // ScrollChanged внутреннего ScrollViewer всплывает через ListBox —
        // здесь же ведём позицию активного диалога.
        MessagesList.AddHandler(
            ScrollViewer.ScrollChangedEvent,
            new ScrollChangedEventHandler(OnMessagesScrollChanged));
        // UI-002: на узком окне «Информация» уходит в оверлей поверх ленты,
        // иначе колонка 330 оставляет истории ~90px (1024−216−380−5−330).
        // Сплиттер меняет колонку без изменения общей ширины — слушаем оба.
        ChatAreaGrid.SizeChanged += (_, _) => UpdateInfoOverlayMode();
        SidebarHost.SizeChanged += (_, _) => UpdateInfoOverlayMode();
    }

    // Ширина панели «Информация» в колоночном режиме и минимально читаемая
    // лента; значение feedWouldBe не зависит от текущего режима — гистерезис
    // не нужен, оверлей не мечется на пороге.
    private const double InfoPanelWidth = 330;
    private const double MinReadableFeedWidth = 360;

    private void UpdateInfoOverlayMode()
    {
        if (DataContext is not ChatViewModel model)
        {
            return;
        }

        var sidebarWidth = ChatAreaGrid.ColumnDefinitions[0].ActualWidth;
        var feedWouldBe = ChatAreaGrid.ActualWidth - sidebarWidth - 5 - InfoPanelWidth;
        model.IsCompactInfoOverlay = feedWouldBe < MinReadableFeedWidth;
    }

    private void ChatView_DataContextChanged(object sender, DependencyPropertyChangedEventArgs e)
    {
        if (e.OldValue is ChatViewModel oldModel)
        {
            oldModel.Messages.CollectionChanged -= Messages_CollectionChanged;
            oldModel.PropertyChanged -= ChatModel_PropertyChanged;
            oldModel.RequestComposerCaret = null;
            oldModel.RequestComposerSelection = null;
            oldModel.RequestScrollToMessage = null;
        }

        if (e.NewValue is ChatViewModel model)
        {
            model.Messages.CollectionChanged += Messages_CollectionChanged;
            model.PropertyChanged += ChatModel_PropertyChanged;
            model.AttachmentPicker = PickAttachmentFiles;
            model.ExportTargetPicker = PickExportTarget;
            model.GroupAvatarPicker = PickGroupAvatarFile;
            model.FocusComposer = FocusComposerInput;
            model.RequestComposerCaret = SetComposerCaret;
            model.RequestComposerSelection = SetComposerSelection;
            model.RequestScrollToMessage = ScrollMessageIntoView;
            _activeConversationId = model.SelectedConversation?.Id;
            ScrollToLastMessage();
        }
    }

    private void ChatModel_PropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (sender is not ChatViewModel model)
        {
            return;
        }

        if (e.PropertyName == nameof(ChatViewModel.SelectedConversation))
        {
            _activeConversationId = model.SelectedConversation?.Id;
            _pendingRestoreFraction =
                _activeConversationId is { } id && _scrollFractions.TryGetValue(id, out var fraction)
                    ? fraction
                    : -1;
        }
        else if (e.PropertyName == nameof(ChatViewModel.IsLoadingMessages)
            && !model.IsLoadingMessages
            && _pendingRestoreFraction >= 0)
        {
            var fraction = _pendingRestoreFraction;
            _pendingRestoreFraction = -1;
            Dispatcher.BeginInvoke(
                System.Windows.Threading.DispatcherPriority.Loaded,
                new Action(() => _messagesScroller?.ScrollToVerticalOffset(
                    fraction * _messagesScroller.ScrollableHeight)));
        }
        else if (e.PropertyName == nameof(ChatViewModel.IsDeleteConfirmOpen))
        {
            // UI-004: модал — фокус на безопасное действие «Отмена» (Enter сразу
            // не удаляет), при закрытии — обратно к вызвавшему элементу.
            if (model.IsDeleteConfirmOpen)
            {
                _focusBeforeDeleteConfirm = Keyboard.FocusedElement;
                Dispatcher.BeginInvoke(
                    System.Windows.Threading.DispatcherPriority.Loaded,
                    new Action(() => DeleteCancelButton.Focus()));
            }
            else
            {
                RestoreOverlayFocus(_focusBeforeDeleteConfirm);
                _focusBeforeDeleteConfirm = null;
            }
        }
        else if (e.PropertyName == nameof(ChatViewModel.IsGroupSettingsOpen))
        {
            // Немодальная панель: при открытии фокус не перехватываем, но если
            // при закрытии он остался внутри — возвращаем предсказуемо.
            if (model.IsGroupSettingsOpen)
            {
                _focusBeforeGroupSettings = Keyboard.FocusedElement;
            }
            else if (GroupSettingsPanel.IsKeyboardFocusWithin)
            {
                RestoreOverlayFocus(_focusBeforeGroupSettings);
            }

            if (!model.IsGroupSettingsOpen)
            {
                _focusBeforeGroupSettings = null;
            }
        }
    }

    // Фокус, который был до оверлея; элемент мог исчезнуть (контекстное меню,
    // удалённая строка) — тогда логичная замена: поле ввода.
    private IInputElement? _focusBeforeDeleteConfirm;
    private IInputElement? _focusBeforeGroupSettings;

    private void RestoreOverlayFocus(IInputElement? element)
    {
        if (element is not UIElement target || !target.Focus())
        {
            ComposerInput.Focus();
        }
    }

    private void OnMessagesScrollChanged(object sender, ScrollChangedEventArgs e)
    {
        if (e.OriginalSource is ScrollViewer scroller)
        {
            _messagesScroller = scroller;
        }

        if (_messagesScroller is { ScrollableHeight: > 0 } && _activeConversationId is { } id)
        {
            _scrollFractions[id] = _messagesScroller.VerticalOffset / _messagesScroller.ScrollableHeight;
        }
    }

    /// <summary>Каретка в точный индекс после вставки меншна (FocusComposer — в конец).</summary>
    private void SetComposerCaret(int caretIndex)
    {
        if (ComposerInput.Focus())
        {
            ComposerInput.CaretIndex = Math.Clamp(caretIndex, 0, ComposerInput.Text.Length);
        }
    }

    /// <summary>Выделение после markdown-обёртки (Ctrl+B/I/K): VM уже подменил
    /// текст через binding — здесь только возвращаем caret+selection.</summary>
    private void SetComposerSelection(int start, int length)
    {
        if (!ComposerInput.Focus())
        {
            return;
        }

        var clampedStart = Math.Clamp(start, 0, ComposerInput.Text.Length);
        ComposerInput.SelectionStart = clampedStart;
        ComposerInput.SelectionLength =
            Math.Clamp(length, 0, ComposerInput.Text.Length - clampedStart);
    }

    /// <summary>
    /// Фокус в поле ввода после восстановления черновика: Dispatcher откладывает
    /// до конца маршрута смены диалога — иначе фокус перехватит строка списка.
    /// </summary>
    private void FocusComposerInput() =>
        Dispatcher.BeginInvoke(() =>
        {
            if (ComposerInput.Focus())
            {
                ComposerInput.CaretIndex = ComposerInput.Text.Length;
            }
        });

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

    /// <summary>Диалог выбора фото группы — только изображения, один файл.</summary>
    private string? PickGroupAvatarFile()
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Multiselect = false,
            Title = "Фото группы",
            Filter = "Изображения (*.png;*.jpg;*.jpeg;*.gif;*.webp)|*.png;*.jpg;*.jpeg;*.gif;*.webp",
        };
        var owner = Window.GetWindow(this);
        var result = owner is null ? dialog.ShowDialog() : dialog.ShowDialog(owner);
        return result == true ? dialog.FileName : null;
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

    /// <summary>Переход к якорю (reply/pinned/search): элемент уже в списке —
    /// ScrollIntoView; BeginInvoke — после settle ленты, как у автоскролла.</summary>
    private void ScrollMessageIntoView(ChatMessageViewModel message) =>
        Dispatcher.BeginInvoke(() => MessagesList.ScrollIntoView(message));

    // ── Drag&drop файлов на чат (tg-drop): оверлей ведёт VM, пути — в
    //    AttachDroppedFilesCommand → тот же upload-пайплайн, что и «скрепка». ──

    /// <summary>Счётчик вложенных DragEnter/DragLeave: проводка курсора между
    /// дочерними элементами колонки не должна моргать оверлеем.</summary>
    private int _fileDragDepth;

    private void OnChatAreaDragEnter(object sender, DragEventArgs e)
    {
        _fileDragDepth++;
        UpdateFileDragEffects(e);
        if (e.Effects == DragDropEffects.Copy
            && DataContext is ChatViewModel model)
        {
            model.SetFileDropOverlay(true);
        }
    }

    private void OnChatAreaDragOver(object sender, DragEventArgs e) =>
        UpdateFileDragEffects(e);

    private void OnChatAreaDragLeave(object sender, DragEventArgs e)
    {
        if (--_fileDragDepth <= 0)
        {
            _fileDragDepth = 0;
            (DataContext as ChatViewModel)?.SetFileDropOverlay(false);
        }
    }

    private void OnChatAreaDrop(object sender, DragEventArgs e)
    {
        _fileDragDepth = 0;
        if (DataContext is not ChatViewModel model)
        {
            return;
        }

        model.SetFileDropOverlay(false);
        if (e.Data.GetData(DataFormats.FileDrop) is string[] { Length: > 0 } paths
            && model.AttachDroppedFilesCommand.CanExecute(paths))
        {
            model.AttachDroppedFilesCommand.Execute(paths);
            e.Handled = true;
        }
    }

    private static void UpdateFileDragEffects(DragEventArgs e)
    {
        // Курсор «копия» только над настоящими файлами — текст/прочее не принимаем.
        e.Effects = e.Data.GetDataPresent(DataFormats.FileDrop)
            ? DragDropEffects.Copy
            : DragDropEffects.None;
        e.Handled = true;
    }

    // ── Ctrl+V в composer ──

    /// <summary>
    /// Вставка до классового TextBox: файлы из Проводника (CF_HDROP) и картинка
    /// из буфера уходят в тот же upload-пайплайн; текст вставляется штатно.
    /// </summary>
    private void OnComposerPasting(object sender, DataObjectPastingEventArgs e)
    {
        if (DataContext is not ChatViewModel model)
        {
            return;
        }

        var data = e.DataObject;
        if (data.GetDataPresent(DataFormats.FileDrop)
            && data.GetData(DataFormats.FileDrop) is string[] { Length: > 0 } paths)
        {
            e.CancelCommand();
            if (model.AttachDroppedFilesCommand.CanExecute(paths))
            {
                model.AttachDroppedFilesCommand.Execute(paths);
            }

            return;
        }

        if (data.GetDataPresent(DataFormats.Bitmap))
        {
            var tempPath = SaveClipboardBitmapAsTempPng(data);
            if (tempPath is null)
            {
                // Не прочитали битмап — отпускаем штатную вставку.
                return;
            }

            e.CancelCommand();
            _ = AttachPastedImageThenCleanupAsync(model, tempPath);
        }
    }

    /// <summary>Битмап из буфера → временный PNG, который уходит как файл-вложение.</summary>
    private static string? SaveClipboardBitmapAsTempPng(IDataObject data)
    {
        try
        {
            if (data.GetData(DataFormats.Bitmap) is not BitmapSource bitmap)
            {
                return null;
            }

            var tempPath = Path.Combine(
                Path.GetTempPath(), $"hub-paste-{Guid.NewGuid():N}.png");
            var encoder = new PngBitmapEncoder();
            encoder.Frames.Add(BitmapFrame.Create(bitmap));
            using (var stream = File.Create(tempPath))
            {
                encoder.Save(stream);
            }

            return tempPath;
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>Загрузка вставленной картинки по общему пайплайну, затем
    /// удаление временного файла — AttachFilesAsync сам показывает ошибки.</summary>
    private static async Task AttachPastedImageThenCleanupAsync(
        ChatViewModel model, string tempPath)
    {
        try
        {
            await model.AttachFilesAsync([tempPath], CancellationToken.None);
        }
        finally
        {
            try
            {
                File.Delete(tempPath);
            }
            catch (Exception)
            {
                // Временник мог уйти/занят — сборку мусора оставляет ОС.
            }
        }
    }

    // PreviewKeyDown, а не KeyDown: при AcceptsReturn=True классовый
    // TextBoxBase.OnKeyDown вставляет перевод строки и помечает Enter
    // Handled раньше instance-обработчиков — KeyDown сюда не доходит.
    private void ComposerInput_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (DataContext is not ChatViewModel model)
        {
            return;
        }

        // Попап @упоминаний перехватывает клавиши как web mentionList onKeyDown:
        // ↑↓ — выбор, Enter/Tab — вставка, Esc — закрыть. Enter при открытом
        // попапе не отправляет — как в Telegram.
        if (model.IsMentionPopupOpen)
        {
            switch (e.Key)
            {
                case Key.Escape:
                    model.CloseMentionPopup();
                    e.Handled = true;
                    return;
                case Key.Up when model.MentionSuggestions.Count > 0:
                    model.MoveMentionSelection(-1);
                    e.Handled = true;
                    return;
                case Key.Down when model.MentionSuggestions.Count > 0:
                    model.MoveMentionSelection(1);
                    e.Handled = true;
                    return;
                case Key.Tab when model.MentionSuggestions.Count > 0:
                case Key.Enter when model.MentionSuggestions.Count > 0:
                    model.InsertMention(model.SelectedMentionSuggestion);
                    e.Handled = true;
                    return;
            }
        }

        // ↑ в пустом поле — правка последнего своего сообщения (tdesktop).
        if (e.Key == Key.Up
            && Keyboard.Modifiers == ModifierKeys.None
            && ComposerInput.CaretIndex == 0
            && string.IsNullOrEmpty(ComposerInput.Text))
        {
            model.BeginEditLastOwnMessage();
            e.Handled = true;
            return;
        }

        // Esc снимает контекст ответа/правки (tdesktop) — черновик не трогаем:
        // ClearComposerContext возвращает снапшот как было до правки.
        if (e.Key == Key.Escape
            && Keyboard.Modifiers == ModifierKeys.None
            && model.HasComposerContext)
        {
            model.CancelComposerContextCommand.Execute(null);
            e.Handled = true;
            return;
        }

        // Ctrl+B/I/K — markdown-обёртки выделения, как у tdesktop composer.
        if (Keyboard.Modifiers == ModifierKeys.Control)
        {
            var marker = e.Key switch
            {
                Key.B => "**",
                Key.I => "*",
                Key.K => "`",
                _ => null,
            };
            if (marker is not null)
            {
                model.ToggleComposerWrap(
                    marker, ComposerInput.SelectionStart, ComposerInput.SelectionLength);
                e.Handled = true;
                return;
            }
        }

        if (e.Key != Key.Enter || (Keyboard.Modifiers & ModifierKeys.Shift) != 0)
        {
            return;
        }

        if (model.SendCommand.CanExecute(null))
        {
            model.SendCommand.Execute(null);
        }

        e.Handled = true;
    }

    private void ComposerInput_TextChanged(object sender, TextChangedEventArgs e) =>
        QueueMentionTriggerUpdate();

    private void ComposerInput_SelectionChanged(object sender, RoutedEventArgs e) =>
        QueueMentionTriggerUpdate();

    /// <summary>
    /// Пересчёт триггера меншна после settle каретки: вставка меняет Text раньше,
    /// чем RequestComposerCaret выставит позицию — синхронный разбор прочитал бы
    /// старую каретку и переоткрыл попап на вставленном «@handle ».
    /// </summary>
    private void QueueMentionTriggerUpdate() =>
        Dispatcher.BeginInvoke(() =>
        {
            if (DataContext is ChatViewModel model)
            {
                model.UpdateMentionTrigger(ComposerInput.Text, ComposerInput.CaretIndex);
            }
        });

    /// <summary>Клик по строке подсказки — вставка меншна, как в web mentionList.</summary>
    private void MentionList_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        if (DataContext is not ChatViewModel model)
        {
            return;
        }

        var container = ItemsControl.ContainerFromElement(
            MentionList, e.OriginalSource as DependencyObject);
        if (container is ListBoxItem { DataContext: ChatGroupMemberItemViewModel candidate })
        {
            model.InsertMention(candidate);
            e.Handled = true;
        }
    }

    /// <summary>
    /// Клавиши оверлеев чата: просмотрщик — Esc/← →, модалы пересылки и
    /// удаления — Esc = «Отмена» (как в Telegram Desktop). PreviewKeyDown
    /// на корне: срабатывает и при фокусе в composer/поле поиска.
    /// </summary>
    private void ChatView_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (DataContext is not ChatViewModel model)
        {
            return;
        }

        // Навигация по диалогам (tdesktop): Alt+↑/↓ и Ctrl+PgUp/PgDn —
        // перехват на корне, до того как TextBox/список съедят стрелки.
        var direction = (e.Key, Keyboard.Modifiers) switch
        {
            (Key.Up, ModifierKeys.Alt) => -1,
            (Key.Down, ModifierKeys.Alt) => 1,
            (Key.PageUp, ModifierKeys.Control) => -1,
            (Key.PageDown, ModifierKeys.Control) => 1,
            _ => 0,
        };
        if (direction != 0)
        {
            model.SelectAdjacentConversation(direction);
            e.Handled = true;
            return;
        }

        // Ctrl+F — поиск по переписке (tdesktop): закрытая — открыть, открытая —
        // просто вернуть фокус в поле; повторное нажатие панель не закрывает.
        if (e.Key == Key.F && Keyboard.Modifiers == ModifierKeys.Control)
        {
            if (!model.IsMessageSearchOpen && model.ToggleMessageSearchCommand.CanExecute(null))
            {
                model.ToggleMessageSearchCommand.Execute(null);
            }

            if (model.IsMessageSearchOpen)
            {
                // Background-приоритет: панель только что раскрылась биндингом —
                // Normal-очередь выполнила бы Focus до её layout-прохода.
                Dispatcher.BeginInvoke(
                    System.Windows.Threading.DispatcherPriority.Background,
                    () => MessageSearchInput.Focus());
            }

            e.Handled = true;
            return;
        }

        ICommand? handled = null;
        if (model.IsDeleteConfirmOpen)
        {
            handled = e.Key == Key.Escape ? model.CancelDeleteCommand : null;
        }
        else if (model.IsForwardPanelOpen)
        {
            handled = e.Key == Key.Escape ? model.CloseForwardPanelCommand : null;
        }
        else if (model.IsMediaViewerOpen)
        {
            handled = e.Key switch
            {
                Key.Escape => model.CloseMediaViewerCommand,
                Key.Left => model.MediaViewerCanGoBack ? model.MediaViewerPrevCommand : null,
                Key.Right => model.MediaViewerCanGoForward ? model.MediaViewerNextCommand : null,
                _ => null,
            };
        }
        else if (model.IsGroupSettingsOpen)
        {
            // UI-004: Esc закрывает настройки — но только когда выше их ничего
            // нет (ветка ниже удаления/пересылки/просмотрщика).
            handled = e.Key == Key.Escape ? model.CloseGroupSettingsCommand : null;
        }
        else if (model.IsMessageSearchOpen)
        {
            // Esc закрывает панель поиска по чату (tdesktop).
            handled = e.Key == Key.Escape ? model.ToggleMessageSearchCommand : null;
        }

        if (handled?.CanExecute(null) == true)
        {
            handled.Execute(null);
            e.Handled = true;
        }
    }

    /// <summary>
    /// Клик по затемнению закрывает просмотрщик (Telegram), но только когда
    /// попали в сам фон — клик по картинке/панелям оставляет его открытым.
    /// </summary>
    private void OnMediaViewerBackdropClick(object sender, MouseButtonEventArgs e)
    {
        if (!ReferenceEquals(e.OriginalSource, MediaViewerOverlay)
            || DataContext is not ChatViewModel model)
        {
            return;
        }

        if (model.CloseMediaViewerCommand.CanExecute(null))
        {
            model.CloseMediaViewerCommand.Execute(null);
        }
    }

    /// <summary>Клик по затемнению подтверждения удаления = «Отмена» (tdesktop);
    /// сам диалог — соседний элемент, сюда попадают только клики мимо него.</summary>
    private void OnDeleteConfirmBackdropClick(object sender, MouseButtonEventArgs e)
    {
        if (DataContext is ChatViewModel model
            && model.CancelDeleteCommand.CanExecute(null))
        {
            model.CancelDeleteCommand.Execute(null);
            e.Handled = true;
        }
    }
}

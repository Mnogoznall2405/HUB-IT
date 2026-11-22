using System.Collections.Specialized;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Hub.Desktop.Native.ViewModels;
using DataFormats = System.Windows.DataFormats;
using DataObject = System.Windows.DataObject;
using DragDropEffects = System.Windows.DragDropEffects;
using DragEventArgs = System.Windows.DragEventArgs;
using IDataObject = System.Windows.IDataObject;
using IInputElement = System.Windows.IInputElement;
using ICommand = System.Windows.Input.ICommand;
using Key = System.Windows.Input.Key;
using Keyboard = System.Windows.Input.Keyboard;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using ModifierKeys = System.Windows.Input.ModifierKeys;
using MouseButtonEventArgs = System.Windows.Input.MouseButtonEventArgs;
using MouseEventArgs = System.Windows.Input.MouseEventArgs;
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
    private DispatcherOperation? _loadOlderOperation;
    private DispatcherOperation? _restoreHistoryAnchorOperation;
    private const double OlderHistoryThreshold = 160;
    private readonly DispatcherTimer _stickerHoverTimer = new();
    private bool _stickerHoverOpening;
    private bool _stickerHoverPreview;

    public ChatView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
        DataContextChanged += ChatView_DataContextChanged;
        _stickerHoverTimer.Tick += OnStickerHoverTick;
        _mediaPositionTimer.Tick += OnMediaPositionTick;
        Unloaded += (_, _) =>
        {
            _stickerHoverTimer.Stop();
            _mediaPositionTimer.Stop();
            StopViewerPlayback();
            if (_stickerHoverPreview && DataContext is ChatViewModel model)
            {
                model.CloseStickerPanelCommand.Execute(null);
            }
        };
        // Ctrl+V перехватываем до TextBox: файлы/картинка из буфера уходят
        // в upload-пайплайн, обычный текст вставляется как раньше.
        DataObject.AddPastingHandler(ComposerInput, OnComposerPasting);
        // ScrollChanged внутреннего ScrollViewer всплывает через ListBox —
        // здесь же ведём позицию активного диалога.
        MessagesList.AddHandler(
            ScrollViewer.ScrollChangedEvent,
            new ScrollChangedEventHandler(OnMessagesScrollChanged));
        // UI-002: на узком окне «Информация» уходит в оверлей поверх ленты,
        // иначе колонка 380 оставляет истории ~30px (1024−216−420−5−380).
        // Сплиттер меняет колонку без изменения общей ширины — слушаем оба.
        ChatAreaGrid.SizeChanged += (_, _) => UpdateInfoOverlayMode();
        SidebarHost.SizeChanged += (_, _) => UpdateInfoOverlayMode();
    }

    // Ширина панели «Информация» в колоночном режиме и минимально читаемая
    // лента; значение feedWouldBe не зависит от текущего режима — гистерезис
    // не нужен, оверлей не мечется на пороге.
    private const double InfoPanelWidth = 380;
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
            _stickerHoverTimer.Stop();
            _stickerHoverPreview = false;
            _focusBeforeMessageSearch = null;
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
            _stickerHoverTimer.Stop();
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
        else if (e.PropertyName == nameof(ChatViewModel.IsStickerPanelOpen) && !model.IsStickerPanelOpen)
        {
            _stickerHoverTimer.Stop();
            _stickerHoverPreview = false;
            if (StickerPanel.IsKeyboardFocusWithin)
            {
                StickerPanelButton.Focus();
            }
        }
        else if (e.PropertyName == nameof(ChatViewModel.IsMessageSearchOpen))
        {
            if (model.IsMessageSearchOpen)
            {
                _focusBeforeMessageSearch = Keyboard.FocusedElement;
                FocusMessageSearchInput(model);
            }
            else
            {
                if (MessageSearchPanel.IsKeyboardFocusWithin || Keyboard.FocusedElement is null)
                {
                    RestoreOverlayFocus(_focusBeforeMessageSearch);
                }

                _focusBeforeMessageSearch = null;
            }
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
        else if (e.PropertyName == nameof(ChatViewModel.MediaViewerMediaSource))
        {
            // UI-026: VM отдал локальный путь — играем в нужном элементе;
            // null (смена элемента/закрытие) — гасим звук детерминированно.
            ApplyViewerMediaSource(model);
        }
        else if (e.PropertyName == nameof(ChatViewModel.IsMediaViewerOpen) && !model.IsMediaViewerOpen)
        {
            StopViewerPlayback();
        }
        else if (e.PropertyName is nameof(ChatViewModel.MediaViewerIsVideo)
            or nameof(ChatViewModel.MediaViewerIsAudio)
            or nameof(ChatViewModel.MediaViewerIsUnsupported))
        {
            UpdateMediaViewerTransport(model);
        }
        else if (e.PropertyName is nameof(ChatViewModel.VoicePreviewSource)
            or nameof(ChatViewModel.IsVoicePreviewPlaying)
            or nameof(ChatViewModel.VoiceBarVisible))
        {
            ApplyVoicePreviewState(model);
        }
    }

    // Фокус, который был до оверлея; элемент мог исчезнуть (контекстное меню,
    // удалённая строка) — тогда логичная замена: поле ввода.
    private IInputElement? _focusBeforeDeleteConfirm;
    private IInputElement? _focusBeforeGroupSettings;
    private IInputElement? _focusBeforeMessageSearch;

    private void FocusMessageSearchInput(ChatViewModel model)
    {
        Dispatcher.BeginInvoke(
            System.Windows.Threading.DispatcherPriority.Background,
            new Action(() =>
            {
                if (ReferenceEquals(DataContext, model) && model.IsMessageSearchOpen)
                {
                    MessageSearchInput.Focus();
                }
            }));
    }

    private void RestoreOverlayFocus(IInputElement? element)
    {
        if (element is not UIElement target || !target.Focus())
        {
            ComposerInput.Focus();
        }
    }

    private void StickerPanelButton_MouseEnter(object sender, MouseEventArgs e)
    {
        _stickerHoverTimer.Stop();
        if (DataContext is ChatViewModel { IsStickerPanelOpen: false } && StickerPanelButton.IsEnabled)
        {
            QueueStickerHover(opening: true);
        }
    }

    private void StickerPanel_MouseEnter(object sender, MouseEventArgs e) => _stickerHoverTimer.Stop();

    private void StickerPanel_MouseLeave(object sender, MouseEventArgs e)
    {
        _stickerHoverTimer.Stop();
        if (_stickerHoverPreview)
        {
            QueueStickerHover(opening: false);
        }
    }

    private void QueueStickerHover(bool opening)
    {
        _stickerHoverOpening = opening;
        _stickerHoverTimer.Interval = TimeSpan.FromMilliseconds(opening ? 250 : 400);
        _stickerHoverTimer.Start();
    }

    private void OnStickerHoverTick(object? sender, EventArgs e)
    {
        _stickerHoverTimer.Stop();
        if (DataContext is not ChatViewModel model || !IsVisible)
        {
            return;
        }

        if (_stickerHoverOpening && !model.IsStickerPanelOpen && !model.IsAttachmentConfirmOpen
            && model.ToggleStickerPanelCommand.CanExecute(null))
        {
            _stickerHoverPreview = true;
            model.ToggleStickerPanelCommand.Execute(null);
        }
        else if (!_stickerHoverOpening && _stickerHoverPreview && !StickerPanel.IsKeyboardFocusWithin)
        {
            model.CloseStickerPanelCommand.Execute(null);
        }
    }

    private void StickerPanelButton_Click(object sender, RoutedEventArgs e)
    {
        _stickerHoverTimer.Stop();
        if (DataContext is not ChatViewModel model)
        {
            return;
        }

        if (model.IsStickerPanelOpen && !_stickerHoverPreview)
        {
            model.CloseStickerPanelCommand.Execute(null);
            return;
        }

        _stickerHoverPreview = false;
        if (!model.IsStickerPanelOpen && model.ToggleStickerPanelCommand.CanExecute(null))
        {
            model.ToggleStickerPanelCommand.Execute(null);
        }

        Dispatcher.BeginInvoke(DispatcherPriority.Loaded, new Action(() =>
        {
            if (ReferenceEquals(DataContext, model) && model.IsStickerPanelOpen)
            {
                (model.IsEmojiTab ? StickerEmojiTab : StickerPacksTab).Focus();
            }
        }));
    }

    private void OnMessagesScrollChanged(object sender, ScrollChangedEventArgs e)
    {
        if (e.OriginalSource is not ScrollViewer scroller
            || !ReferenceEquals(scroller, MessagesList.Template.FindName("HistoryScrollViewer", MessagesList)))
        {
            return;
        }

        _messagesScroller = scroller;
        if (scroller.ScrollableHeight > 0 && _activeConversationId is { } id)
        {
            _scrollFractions[id] = scroller.VerticalOffset / scroller.ScrollableHeight;
        }

        if (e.VerticalChange < 0 && e.ExtentHeightChange == 0 && e.ViewportHeightChange == 0)
        {
            QueueOlderHistory(scroller);
        }
    }

    private void MessagesList_PreviewMouseWheel(object sender, System.Windows.Input.MouseWheelEventArgs e)
    {
        if (e.Delta > 0 && _messagesScroller is { } scroller)
        {
            QueueOlderHistory(scroller);
        }
    }

    private void QueueOlderHistory(ScrollViewer scroller)
    {
        if (scroller.VerticalOffset > OlderHistoryThreshold
            || _loadOlderOperation is { Status: DispatcherOperationStatus.Pending }
            || DataContext is not ChatViewModel
                { IsLoadingMessages: false, IsLoadingOlder: false, HasOlderHistoryError: false } model
            || !model.LoadOlderCommand.CanExecute(null))
        {
            return;
        }

        var conversation = model.SelectedConversation;
        _loadOlderOperation = Dispatcher.BeginInvoke(DispatcherPriority.Background, new Action(() =>
        {
            if (IsLoaded && IsVisible && ReferenceEquals(DataContext, model)
                && ReferenceEquals(model.SelectedConversation, conversation)
                && !model.IsLoadingMessages && !model.HasOlderHistoryError
                && scroller.VerticalOffset <= OlderHistoryThreshold
                && model.LoadOlderCommand.CanExecute(null))
            {
                model.LoadOlderCommand.Execute(null);
            }
        }));
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

    /// <summary>Диалог выбора файлов для «скрепки» — view-слой, VM не тянет Win32.
    /// «media» фильтрует изображения+видео (пункт «Фото или видео»),
    /// остальное — общий «Документ» (UI-027).</summary>
    private IReadOnlyList<string> PickAttachmentFiles(string? kind)
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Multiselect = true,
            Title = kind == "media" ? "Прикрепить фото или видео" : "Прикрепить документ",
            Filter = kind == "media"
                ? "Изображения и видео|*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp;*.mp4;*.mov;*.mkv;*.webm;*.avi|Все файлы (*.*)|*.*"
                : "Все файлы (*.*)|*.*",
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
        if (e.Action == NotifyCollectionChangedAction.Add && e.NewStartingIndex == 0
            && DataContext is ChatViewModel { IsLoadingOlder: true } model
            && _messagesScroller is { } scroller
            && _restoreHistoryAnchorOperation is not { Status: DispatcherOperationStatus.Pending })
        {
            PreserveHistoryAnchor(model, scroller);
        }

        // Скроллим только при добавлении в конец: подгрузка «ранее» вверх
        // ленты не должна дёргать позицию пользователя.
        var appendedAtEnd = e.Action == NotifyCollectionChangedAction.Add
            && e.NewItems is not null
            && e.NewStartingIndex >= MessagesList.Items.Count - e.NewItems.Count;
        if (appendedAtEnd && (DataContext is ChatViewModel { IsLoadingMessages: true }
            || !ChatScrollAssist.GetIsAwayFromEnd(MessagesList)))
        {
            ScrollToLastMessage();
        }
    }

    private void PreserveHistoryAnchor(ChatViewModel model, ScrollViewer scroller)
    {
        if (scroller.Template.FindName("PART_ScrollContentPresenter", scroller) is not FrameworkElement viewport)
        {
            return;
        }

        var panel = FindHistoryPanel(viewport);
        if (panel is null)
        {
            return;
        }

        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(panel); i++)
        {
            if (VisualTreeHelper.GetChild(panel, i) is not ListBoxItem { DataContext: ChatMessageViewModel message } row)
            {
                continue;
            }

            var y = row.TranslatePoint(new System.Windows.Point(), viewport).Y;
            if (y < 0 || y >= viewport.ActualHeight)
            {
                continue;
            }

            var conversation = model.SelectedConversation;
            _restoreHistoryAnchorOperation = Dispatcher.BeginInvoke(DispatcherPriority.Loaded, new Action(() =>
            {
                if (!IsLoaded || !ReferenceEquals(DataContext, model)
                    || !ReferenceEquals(model.SelectedConversation, conversation)
                    || !MessagesList.Items.Contains(message))
                {
                    return;
                }

                if (MessagesList.ItemContainerGenerator.ContainerFromItem(message) is not ListBoxItem)
                {
                    MessagesList.ScrollIntoView(message);
                    MessagesList.UpdateLayout();
                }

                if (MessagesList.ItemContainerGenerator.ContainerFromItem(message) is ListBoxItem anchor)
                {
                    var delta = anchor.TranslatePoint(new System.Windows.Point(), viewport).Y - y;
                    if (Math.Abs(delta) >= 0.5)
                    {
                        scroller.ScrollToVerticalOffset(scroller.VerticalOffset + delta);
                    }
                }
            }));
            return;
        }
    }

    private static VirtualizingStackPanel? FindHistoryPanel(DependencyObject element)
    {
        if (element is VirtualizingStackPanel panel)
        {
            return panel;
        }

        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(element); i++)
        {
            if (FindHistoryPanel(VisualTreeHelper.GetChild(element, i)) is { } found)
            {
                return found;
            }
        }

        return null;
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
            if (model.IsMessageSearchOpen)
            {
                MessageSearchInput.Focus();
            }
            else if (model.ToggleMessageSearchCommand.CanExecute(null))
            {
                model.ToggleMessageSearchCommand.Execute(null);
            }

            e.Handled = true;
            return;
        }

        ICommand? handled = null;
        if (model.IsAttachmentConfirmOpen)
        {
            // UI-027: модал подтверждения вложений — верхний слой (ZIndex 4),
            // Esc отменяет очередь, черновик не трогается.
            handled = e.Key == Key.Escape ? model.CancelAttachmentsCommand : null;
        }
        else if (model.IsDeleteConfirmOpen)
        {
            handled = e.Key == Key.Escape ? model.CancelDeleteCommand : null;
        }
        else if (model.IsForwardPanelOpen)
        {
            handled = e.Key == Key.Escape ? model.CloseForwardPanelCommand : null;
        }
        else if (model.IsMediaViewerOpen)
        {
            // Space — пауза/продолжить (tdesktop); только когда фокус не на
            // кнопке, чтобы не спорить с её собственной обработкой Space.
            if (e.Key == Key.Space
                && (model.MediaViewerIsVideo || model.MediaViewerIsAudio)
                && Keyboard.FocusedElement is not System.Windows.Controls.Primitives.ButtonBase)
            {
                ToggleViewerPlayback();
                e.Handled = true;
                return;
            }

            handled = e.Key switch
            {
                Key.Escape => model.CloseMediaViewerCommand,
                Key.Left => model.MediaViewerCanGoBack ? model.MediaViewerPrevCommand : null,
                Key.Right => model.MediaViewerCanGoForward ? model.MediaViewerNextCommand : null,
                _ => null,
            };
        }
        else if (model.IsReportDialogOpen)
        {
            // Вложенные панели настроек по z-порядку разметки: диалог жалобы
            // (4873) > жалобы (4764) > заявки (4647) > настройки (4493).
            // Esc снимает только верхний слой — настройки и черновик живут.
            handled = e.Key == Key.Escape ? model.CancelReportCommand : null;
        }
        else if (model.IsReportsPanelOpen)
        {
            handled = e.Key == Key.Escape ? model.CloseReportsPanelCommand : null;
        }
        else if (model.IsJoinRequestsPanelOpen)
        {
            handled = e.Key == Key.Escape ? model.CloseJoinRequestsPanelCommand : null;
        }
        else if (model.IsGroupSettingsOpen)
        {
            // UI-004: Esc закрывает настройки — но только когда выше их ничего
            // нет (ветка ниже удаления/пересылки/просмотрщика/подпанелей).
            handled = e.Key == Key.Escape ? model.CloseGroupSettingsCommand : null;
        }
        else if (model.IsStickerPanelOpen)
        {
            handled = e.Key == Key.Escape ? model.CloseStickerPanelCommand : null;
        }
        else if (model.IsMessageSearchOpen)
        {
            // Esc закрывает панель поиска по чату (tdesktop).
            handled = e.Key == Key.Escape ? model.ToggleMessageSearchCommand : null;
        }
        else if (model.VoiceBarVisible)
        {
            // UI-028: Esc обрывает запись/черновик без сети — нижний слой
            // композера, оверлеи выше обрабатывают Esc раньше.
            handled = e.Key == Key.Escape ? model.CancelVoiceRecordingCommand : null;
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

    /// <summary>Клик по затемнению модала вложений = «Отмена» (UI-027, tg-send-files):
    /// очередь и подпись сбрасываются, черновик composer не затрагивается.</summary>
    private void OnAttachmentConfirmBackdropClick(object sender, MouseButtonEventArgs e)
    {
        if (DataContext is ChatViewModel model
            && model.CancelAttachmentsCommand.CanExecute(null))
        {
            model.CancelAttachmentsCommand.Execute(null);
            e.Handled = true;
        }
    }

    // ---- Встроенное воспроизведение медиа в просмотрщике (UI-026) ----

    /// <summary>Элемент, который сейчас играет: видео — с кадром, аудио — без.</summary>
    private MediaElement? _activeViewerPlayer;
    private readonly DispatcherTimer _mediaPositionTimer =
        new() { Interval = TimeSpan.FromMilliseconds(250) };
    private bool _mediaSeeking;
    private bool _mediaPlaying;

    /// <summary>VM отдал локальный файл — назначаем Source нужному элементу
    /// и стартуем; null (смена элемента/закрытие) — полная остановка.</summary>
    private void ApplyViewerMediaSource(ChatViewModel model)
    {
        StopViewerPlayback();
        if (model.MediaViewerMediaSource is not { } path)
        {
            UpdateMediaViewerTransport(model);
            return;
        }

        var player = model.MediaViewerIsVideo ? MediaViewerPlayer : MediaViewerAudioPlayer;
        _activeViewerPlayer = player;
        try
        {
            player.Source = new Uri(path);
            player.Play();
            _mediaPlaying = true;
            MediaViewerPlayPauseIcon.Data = VectorIcons.Pause;
            _mediaPositionTimer.Start();
        }
        catch (Exception)
        {
            _mediaPlaying = false;
            _activeViewerPlayer = null;
            model.MarkMediaViewerPlaybackFailed();
        }

        UpdateMediaViewerTransport(model);
    }

    /// <summary>Полная остановка обоих элементов: звука после закрытия
    /// просмотрщика или переключения элемента быть не должно (UI-026).</summary>
    private void StopViewerPlayback()
    {
        _mediaPositionTimer.Stop();
        foreach (var player in new[] { MediaViewerPlayer, MediaViewerAudioPlayer })
        {
            try
            {
                player.Stop();
                player.Source = null;
            }
            catch (Exception)
            {
            }
        }

        _activeViewerPlayer = null;
        _mediaPlaying = false;
        _mediaSeeking = false;
        MediaViewerPlayPauseIcon.Data = VectorIcons.Play;
        MediaViewerPosition.Value = 0;
        MediaViewerTimeText.Text = "0:00 / 0:00";
    }

    /// <summary>Транспорт виден только для проигрываемого элемента (video/audio).</summary>
    private void UpdateMediaViewerTransport(ChatViewModel model)
    {
        MediaViewerTransport.Visibility =
            model.MediaViewerIsVideo || model.MediaViewerIsAudio
                ? Visibility.Visible
                : Visibility.Collapsed;
        if (DataContext is ChatViewModel current
            && !current.MediaViewerIsVideo
            && !current.MediaViewerIsAudio
            && _activeViewerPlayer is not null)
        {
            // Элемент сменился на непроигрываемый — гасим звук сразу.
            StopViewerPlayback();
        }
    }

    private void OnMediaViewerPlayPauseClick(object sender, RoutedEventArgs e) =>
        ToggleViewerPlayback();

    /// <summary>Space/кнопка: пауза ↔ продолжить активный элемент.</summary>
    private void ToggleViewerPlayback()
    {
        if (_activeViewerPlayer is not { } player)
        {
            return;
        }

        if (_mediaPlaying)
        {
            player.Pause();
            _mediaPlaying = false;
            MediaViewerPlayPauseIcon.Data = VectorIcons.Play;
        }
        else
        {
            player.Play();
            _mediaPlaying = true;
            MediaViewerPlayPauseIcon.Data = VectorIcons.Pause;
        }
    }

    private void OnMediaViewerMediaOpened(object sender, RoutedEventArgs e)
    {
        if (sender is MediaElement player && player.NaturalDuration.HasTimeSpan)
        {
            MediaViewerPosition.Maximum = player.NaturalDuration.TimeSpan.TotalSeconds;
            UpdateMediaViewerTimeText(player);
        }
    }

    private void OnMediaViewerMediaEnded(object sender, RoutedEventArgs e)
    {
        if (sender is MediaElement player)
        {
            player.Stop();
            player.Position = TimeSpan.Zero;
        }

        _mediaPlaying = false;
        MediaViewerPlayPauseIcon.Data = VectorIcons.Play;
        if (ReferenceEquals(sender, _activeViewerPlayer))
        {
            _activeViewerPlayer = null;
            _mediaPositionTimer.Stop();
        }
    }

    private void OnMediaViewerMediaFailed(object sender, ExceptionRoutedEventArgs e)
    {
        if (DataContext is ChatViewModel model)
        {
            StopViewerPlayback();
            model.MarkMediaViewerPlaybackFailed();
        }
    }

    /// <summary>UI-028: превью черновика — скрытый MediaElement; смена
    /// источника или снятие флага останавливает звук детерминированно.</summary>
    private void ApplyVoicePreviewState(ChatViewModel model)
    {
        var path = model.VoicePreviewSource;
        if (path is null || !model.VoiceBarVisible)
        {
            StopVoicePreview();
            return;
        }

        var source = new Uri(path);
        if (VoicePreviewPlayer.Source != source)
        {
            try
            {
                VoicePreviewPlayer.Source = source;
            }
            catch (Exception)
            {
                StopVoicePreview();
                return;
            }
        }

        if (model.IsVoicePreviewPlaying)
        {
            VoicePreviewPlayer.Play();
        }
        else
        {
            VoicePreviewPlayer.Pause();
        }
    }

    private void StopVoicePreview()
    {
        try
        {
            VoicePreviewPlayer.Stop();
            VoicePreviewPlayer.Source = null;
        }
        catch (Exception)
        {
        }
    }

    private void OnVoicePreviewMediaEnded(object sender, RoutedEventArgs e)
    {
        VoicePreviewPlayer.Position = TimeSpan.Zero;
        (DataContext as ChatViewModel)?.NotifyVoicePreviewEnded();
    }

    private void OnVoicePreviewMediaFailed(object sender, ExceptionRoutedEventArgs e)
    {
        StopVoicePreview();
        (DataContext as ChatViewModel)?.NotifyVoicePreviewEnded();
    }

    private void OnMediaViewerSeekDown(object sender, MouseButtonEventArgs e) =>
        _mediaSeeking = true;

    private void OnMediaViewerSeekUp(object sender, MouseButtonEventArgs e)
    {
        if (_activeViewerPlayer is { } player && player.NaturalDuration.HasTimeSpan)
        {
            player.Position = TimeSpan.FromSeconds(MediaViewerPosition.Value);
        }

        _mediaSeeking = false;
        if (_activeViewerPlayer is { } active)
        {
            UpdateMediaViewerTimeText(active);
        }
    }

    private void OnMediaPositionTick(object? sender, EventArgs e)
    {
        if (_activeViewerPlayer is not { } player || _mediaSeeking
            || !player.NaturalDuration.HasTimeSpan)
        {
            return;
        }

        MediaViewerPosition.Value = player.Position.TotalSeconds;
        UpdateMediaViewerTimeText(player);
    }

    private void UpdateMediaViewerTimeText(MediaElement player)
    {
        var position = player.Position;
        var duration = player.NaturalDuration.HasTimeSpan
            ? player.NaturalDuration.TimeSpan
            : TimeSpan.Zero;
        MediaViewerTimeText.Text =
            $"{FormatPlaybackTime(position)} / {FormatPlaybackTime(duration)}";
    }

    private static string FormatPlaybackTime(TimeSpan value) =>
        value.TotalHours >= 1
            ? value.ToString(@"h\:mm\:ss")
            : value.ToString(@"m\:ss");
}

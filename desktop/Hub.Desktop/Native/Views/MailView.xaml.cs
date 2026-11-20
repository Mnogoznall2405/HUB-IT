using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Threading;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Media;
using System.Windows.Data;
using Hub.Desktop.Configuration;
using Hub.Desktop.Diagnostics;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.WebView;
using Microsoft.Web.WebView2.Core;
using Binding = System.Windows.Data.Binding;
using Button = System.Windows.Controls.Button;
using DataObject = System.Windows.DataObject;
using DragDropEffects = System.Windows.DragDropEffects;
using DragEventArgs = System.Windows.DragEventArgs;
using DrawingColor = System.Drawing.Color;
using PropertyGroupDescription = System.Windows.Data.PropertyGroupDescription;
using ICommand = System.Windows.Input.ICommand;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using ListBox = System.Windows.Controls.ListBox;
using ListBoxItem = System.Windows.Controls.ListBoxItem;
using MouseButtonEventArgs = System.Windows.Input.MouseButtonEventArgs;
using MouseButtonState = System.Windows.Input.MouseButtonState;
using MouseEventArgs = System.Windows.Input.MouseEventArgs;
using Keyboard = System.Windows.Input.Keyboard;
using ModifierKeys = System.Windows.Input.ModifierKeys;
using Point = System.Windows.Point;
using ScrollChangedEventArgs = System.Windows.Controls.ScrollChangedEventArgs;
using ScrollViewer = System.Windows.Controls.ScrollViewer;
using TextBox = System.Windows.Controls.TextBox;
using TextChangedEventArgs = System.Windows.Controls.TextChangedEventArgs;
using UserControl = System.Windows.Controls.UserControl;
using WebView2 = Microsoft.Web.WebView2.Wpf.WebView2;

namespace Hub.Desktop.Native.Views;

/// <summary>Страница «Почта»: папки, список писем и панель чтения.</summary>
public partial class MailView : UserControl
{
    public MailView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
        NativeThemeManager.EffectiveThemeChanged += OnEffectiveThemeChanged;
        // Шов выбора файлов композера живёт в code-behind (OpenFileDialog — UI);
        // заодно подписка на смену Detail для html-тела письма.
        DataContextChanged += (_, _) => WirePage(DataContext as MailViewModel);
        Loaded += (_, _) => _ = RenderMailBodyAsync();
        Unloaded += MailView_Unloaded;
        // Ctrl+F — фокус в поиск по письмам (Gmail-стандарт).
        PreviewKeyDown += MailView_PreviewKeyDown;
        // Адаптивность: компактный режим для узких окон.
        SizeChanged += MailView_SizeChanged;
    }

    private void SearchInput_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == System.Windows.Input.Key.Enter)
        {
            (DataContext as MailViewModel)?.RefreshCommand.Execute(null);
            e.Handled = true;
        }
        else if (e.Key == System.Windows.Input.Key.Escape)
        {
            // Esc в Gmail сбрасывает выдачу к полному списку — делаем так же.
            (DataContext as MailViewModel)?.ResetListFiltersCommand.Execute(null);
            e.Handled = true;
        }
    }

    /// <summary>
    /// Ctrl+F — фокус в поле поиска (Gmail-стандарт). Не перехватываем при открытом
    /// композере и во время ввода в других текстовых полях (кроме самого поиска —
    /// в нём Ctrl+F просто выделяет строку).
    /// </summary>
    private void MailView_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != System.Windows.Input.Key.F
            || Keyboard.Modifiers != ModifierKeys.Control
            || IsComposeOpen()
            || (Keyboard.FocusedElement is TextBox focusedBox
                && !ReferenceEquals(focusedBox, SearchInput)))
        {
            return;
        }

        SearchInput.Focus();
        SearchInput.SelectAll();
        e.Handled = true;
    }

    private bool IsComposeOpen() => (DataContext as MailViewModel)?.Composer is not null;

    // ---- Адаптивность: компактный режим для узких окон (Outlook mobile pattern) ----

    private bool _isCompactMode;
    private const double CompactModeThreshold = 760;

    /// <summary>
    /// При ширине страницы ниже порога папки и чтение работают попеременно:
    /// клик по письму показывает чтение, «← К списку» возвращает список.
    /// Порог — ширина страницы (окно минус навигация минус поля).
    /// </summary>
    private void MailView_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        var compact = e.NewSize.Width < CompactModeThreshold;
        if (_isCompactMode == compact)
        {
            return;
        }

        _isCompactMode = compact;
        ApplyCompactMode(compact);
    }

    private void ApplyCompactMode(bool compact)
    {
        if (compact)
        {
            // Папки и сплиттеры сворачиваются; список занимает всю ширину.
            SetFolderRailCollapsed(true);
            MailRailColumn.Width = new GridLength(0);
            MailRailColumn.MinWidth = 0;
            FolderSplitterColumn.Width = new GridLength(0);
            FolderSplitter.Width = 0;
            ListSplitterColumn.Width = new GridLength(0);
            ListSplitter.Width = 0;
            MailListColumn.MinWidth = 0;
            CompactBackButton.Visibility = Visibility.Collapsed;
            UpdateCompactReadingVisibility();
        }
        else
        {
            // Полный трёхпанельный вид.
            SetFolderRailCollapsed(false);
            MailRailColumn.Width = new GridLength(200);
            MailRailColumn.MinWidth = 180;
            FolderSplitterColumn.Width = new GridLength(6);
            FolderSplitter.Width = 6;
            ListSplitterColumn.Width = new GridLength(6);
            ListSplitter.Width = 6;
            MailListColumn.MinWidth = 280;
            MailListColumn.Width = new GridLength(340);
            MailListPanel.Visibility = Visibility.Visible;
            ReadingPaneBorder.Visibility = Visibility.Visible;
            CompactBackButton.Visibility = Visibility.Collapsed;
        }
    }

    /// <summary>
    /// Компактный режим: список ИЛИ чтение (не оба). Выбранное письмо
    /// переключает на чтение; сброс выбора возвращает список.
    /// </summary>
    private void UpdateCompactReadingVisibility()
    {
        if (!_isCompactMode)
        {
            return;
        }

        var viewModel = DataContext as MailViewModel;
        var hasSelection = viewModel?.SelectedItem is not null;
        MailListPanel.Visibility = hasSelection ? Visibility.Collapsed : Visibility.Visible;
        ReadingPaneBorder.Visibility = hasSelection ? Visibility.Visible : Visibility.Collapsed;
        MailListColumn.Width = hasSelection
            ? new GridLength(0)
            : new GridLength(1, GridUnitType.Star);
        MailReadingColumn.Width = hasSelection
            ? new GridLength(1, GridUnitType.Star)
            : new GridLength(0);
        CompactBackButton.Visibility = hasSelection ? Visibility.Visible : Visibility.Collapsed;
    }

    /// <summary>«← К списку» в компактном режиме: гасит выбор, возвращает список.</summary>
    private void CompactBackButton_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is MailViewModel viewModel)
        {
            viewModel.SelectedItem = null;
            UpdateCompactReadingVisibility();
        }
    }

    /// <summary>
    /// Del в списке писем удаляет выбранное письмо — как в Outlook/Thunderbird;
    /// срабатывает только при клавиатурном фокусе в списке, чтобы не мешать
    /// вводу в поиске или композере.
    /// </summary>
    private void MessageList_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != System.Windows.Input.Key.Delete
            || DataContext is not MailViewModel viewModel
            || viewModel.SelectedItem is not { Id.Length: > 0 } item
            || viewModel.DeleteItemCommand is not NativeAsyncCommand deleteCommand
            || !deleteCommand.CanExecute(item))
        {
            return;
        }

        _ = deleteCommand.ExecuteAsync(item);
        e.Handled = true;
    }

    /// <summary>Enter в редакторе папки = кнопка подтверждения (создать/переименовать).</summary>
    private void FolderEditorName_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == System.Windows.Input.Key.Enter)
        {
            (DataContext as MailViewModel)?.ConfirmFolderEditorCommand.Execute(null);
            e.Handled = true;
        }
        else if (e.Key == System.Windows.Input.Key.Escape)
        {
            (DataContext as MailViewModel)?.CancelFolderEditorCommand.Execute(null);
            e.Handled = true;
        }
    }

    /// <summary>Escape в оверлее заявки — то же, что «✕»/«Отмена» формы.</summary>
    private void ItRequestOverlay_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == System.Windows.Input.Key.Escape
            && DataContext is MailViewModel viewModel
            && viewModel.ItRequest?.CloseCommand.CanExecute(null) == true)
        {
            viewModel.ItRequest.CloseCommand.Execute(null);
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

    /// <summary>Kebab-меню строки письма (tree-button-more в TB): открывает меню строки.</summary>
    private void RowMoreMenuButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button button)
        {
            return;
        }

        // Контекст «Переместить в…»: строка, чей kebab открыт (команда погасит после выполнения).
        if (button.DataContext is MailListItemViewModel item && DataContext is MailViewModel viewModel)
        {
            viewModel.KebabTargetItem = item;
            ((NativeAsyncCommand)viewModel.MoveItemFromKebabCommand).RaiseCanExecuteChanged();
        }

        // Меню живёт на корне строки (тот же список, что и правый клик):
        // поднимаемся по дереву до ближайшего элемента с ContextMenu.
        var node = (DependencyObject?)button;
        while (node is not null)
        {
            if (node is FrameworkElement { ContextMenu: { } menu } element)
            {
                menu.PlacementTarget = element;
                menu.IsOpen = true;
                return;
            }

            node = VisualTreeHelper.GetParent(node);
        }
    }

    /// <summary>«Ещё ▾» в панели действий шапки письма и в командной панели: открывает компактное меню.</summary>
    private void HeaderMoreMenuButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { ContextMenu: { } menu } button)
        {
            menu.PlacementTarget = button;
            menu.IsOpen = true;
        }
    }

    // ---- Рейка папок: свернуть/развернуть (место уходит письму) ----

    /// <summary>
    /// Свернуть панель папок в тонкий рычаг 30px — чтению отдаётся её ширина.
    /// </summary>
    public void SetFolderRailCollapsed(bool collapsed)
    {
        MailRailColumn.Width = new GridLength(collapsed ? 30 : 200);
        MailRailColumn.MinWidth = collapsed ? 30 : 200;
        // Содержимое рейки скрываем целиком; рычаг разворота живёт поверх пустой колонки.
        foreach (UIElement child in MailRailContent.Children)
        {
            child.Visibility = collapsed ? Visibility.Collapsed : Visibility.Visible;
        }

        MailRailExpandButton.Visibility = collapsed ? Visibility.Visible : Visibility.Collapsed;
    }

    private void CollapseMailRailButton_Click(object sender, RoutedEventArgs e) =>
        SetFolderRailCollapsed(true);

    private void ExpandMailRailButton_Click(object sender, RoutedEventArgs e) =>
        SetFolderRailCollapsed(false);

    // ---- Drag&drop: письмо → папка (как в Thunderbird) ----

    private const string MailItemDragFormat = "HubMailItem";
    private Point? _mailDragStart;
    private MailFolderViewModel? _dropHoverFolder;
    private ScrollViewer? _messageListScrollViewer;

    /// <summary>
    /// Infinite scroll (Gmail/Outlook): при подходе к концу списка (~120px)
    /// догружаем следующую страницу через тот же LoadMoreCommand — кнопку
    /// «Показать ещё» оставляем как явный fallback доступности.
    /// </summary>
    private void MessageList_Loaded(object sender, RoutedEventArgs e)
    {
        if (sender is not ListBox list || VisualChild<ScrollViewer>(list) is not { } viewer)
        {
            return;
        }

        if (ReferenceEquals(_messageListScrollViewer, viewer))
        {
            return;
        }

        if (_messageListScrollViewer is { } previous)
        {
            previous.ScrollChanged -= OnMessageListScrollChanged;
        }

        _messageListScrollViewer = viewer;
        viewer.ScrollChanged += OnMessageListScrollChanged;
    }

    private void OnMessageListScrollChanged(object? sender, ScrollChangedEventArgs e)
    {
        if (e.ExtentHeight - (e.VerticalOffset + e.ViewportHeight) > 120
            || DataContext is not MailViewModel { HasMore: true } viewModel
            || viewModel.LoadMoreCommand is not { } loadMore
            || !loadMore.CanExecute(null))
        {
            return;
        }

        loadMore.Execute(null);
    }

    /// <summary>Первый потомок нужного типа в визуальном дереве (BFS).</summary>
    private static T? VisualChild<T>(DependencyObject? node)
        where T : DependencyObject
    {
        if (node is null)
        {
            return null;
        }

        var queue = new Queue<DependencyObject>();
        queue.Enqueue(node);
        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(current); i++)
            {
                var child = VisualTreeHelper.GetChild(current, i);
                if (child is T typed)
                {
                    return typed;
                }

                queue.Enqueue(child);
            }
        }

        return null;
    }

    /// <summary>Стартовый фикс точки нажатия: таскание начинается после системного порога.</summary>
    private void MessageList_PreviewMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        _mailDragStart = e.GetPosition(null);
    }

    private void MessageList_PreviewMouseMove(object sender, MouseEventArgs e)
    {
        if (_mailDragStart is not { } start || e.LeftButton != MouseButtonState.Pressed)
        {
            return;
        }

        var position = e.GetPosition(null);
        if (Math.Abs(position.X - start.X) < SystemParameters.MinimumHorizontalDragDistance
            && Math.Abs(position.Y - start.Y) < SystemParameters.MinimumVerticalDragDistance)
        {
            return;
        }

        _mailDragStart = null;
        if (sender is not ListBox list
            || VisualAncestor<ListBoxItem>(e.OriginalSource as DependencyObject) is not { } item)
        {
            return;
        }

        var message = list.ItemContainerGenerator.ItemFromContainer(item) as MailListItemViewModel;
        if (message is not { Id.Length: > 0 })
        {
            return;
        }

        DragDrop.DoDragDrop(item, new DataObject(MailItemDragFormat, message), DragDropEffects.Move);
    }

    private void FolderList_DragOver(object sender, DragEventArgs e)
    {
        var canDrop = e.Data.GetDataPresent(MailItemDragFormat);
        e.Effects = canDrop ? DragDropEffects.Move : DragDropEffects.None;
        e.Handled = true;
        if (!canDrop || sender is not ListBox list)
        {
            return;
        }

        // Подсветка папки под курсором (TB выделяет цель переноса).
        var folder = FolderFromDropPoint(list, e);
        if (!ReferenceEquals(_dropHoverFolder, folder))
        {
            if (_dropHoverFolder is { } previous)
            {
                previous.IsDropTarget = false;
            }

            _dropHoverFolder = folder;
            if (folder is not null)
            {
                folder.IsDropTarget = true;
            }
        }
    }

    private void FolderList_DragLeave(object sender, DragEventArgs e)
    {
        ClearDropHover();
    }

    private async void FolderList_Drop(object sender, DragEventArgs e)
    {
        if (e.Data.GetData(MailItemDragFormat) is not MailListItemViewModel message
            || sender is not ListBox list
            || VisualAncestor<ListBoxItem>(e.OriginalSource as DependencyObject) is not { } container)
        {
            ClearDropHover();
            return;
        }

        var folder = list.ItemContainerGenerator.ItemFromContainer(container) as MailFolderViewModel;
        if (folder is not { Id.Length: > 0 }
            || string.Equals(folder.Id, message.Folder, StringComparison.Ordinal)
            || DataContext is not MailViewModel viewModel)
        {
            ClearDropHover();
            return;
        }

        e.Handled = true;
        ClearDropHover();
        await viewModel.MoveItemToFolderSafelyAsync(message, folder.Id, CancellationToken.None);
    }

    private MailFolderViewModel? FolderFromDropPoint(ListBox list, DragEventArgs e)
    {
        if (VisualAncestor<ListBoxItem>(e.OriginalSource as DependencyObject) is not { } container)
        {
            return null;
        }

        return list.ItemContainerGenerator.ItemFromContainer(container) as MailFolderViewModel;
    }

    private void ClearDropHover()
    {
        if (_dropHoverFolder is { } folder)
        {
            folder.IsDropTarget = false;
            _dropHoverFolder = null;
        }
    }

    /// <summary>Подъём по визуальному дереву до контейнера строки (hit-тест drop-цели).</summary>
    private static T? VisualAncestor<T>(DependencyObject? node)
        where T : DependencyObject
    {
        while (node is not null)
        {
            if (node is T typed)
            {
                return typed;
            }

            node = VisualTreeHelper.GetParent(node);
        }

        return null;
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

    // ---- HTML-тело письма (изолированный WebView2-ридер) ----

    private MailViewModel? _page;
    private MailDetailViewModel? _detail;
    private WebView2? _mailBodyWebView;
    private DesktopWebViewEnvironmentProvider? _mailBodyEnvironment;
    private Task<bool>? _mailBodyInitTask;
    private int _mailBodyRenderEpoch;
    private bool _mailBodyUnavailable;
    private bool _mailBodyDisposed;

    private void MailView_Unloaded(object sender, RoutedEventArgs e)
    {
        // Страница пересоздаётся DataTemplate при каждой навигации: отписываемся
        // и гасим браузер письма. Если WPF вернёт эту же view в дерево — html
        // останется выключенным (dispose'd WebView2 не переинициализируется),
        // письмо читается через текстовый fallback.
        _mailBodyRenderEpoch++;
        _mailBodyUnavailable = true;
        _mailBodyDisposed = true;
        NativeThemeManager.EffectiveThemeChanged -= OnEffectiveThemeChanged;
        if (_messageListScrollViewer is { } mailScroll)
        {
            mailScroll.ScrollChanged -= OnMessageListScrollChanged;
            _messageListScrollViewer = null;
        }

        WirePage(null);
        _mailBodyWebView?.Dispose();
        _mailBodyWebView = null;
    }

    private void WirePage(MailViewModel? viewModel)
    {
        if (_page is not null)
        {
            _page.PropertyChanged -= OnPagePropertyChanged;
            _page.PropertyChanged -= OnCompactSelectionChanged;
        }

        _page = viewModel;
        WireDetail(null);
        if (viewModel is not null)
        {
            viewModel.ComposeFilePicker = PickComposeFiles;
            viewModel.PropertyChanged += OnPagePropertyChanged;
            // Outlook-группировка списка писем по датам («Сегодня/Вчера/…»).
            EnableMessageDateGrouping(viewModel);
            WireDetail(viewModel.Detail);
            // Компактный режим: выбор письма переключает панель.
            viewModel.PropertyChanged += OnCompactSelectionChanged;
        }

        _ = RenderMailBodyAsync();
    }

    /// <summary>Компактный режим: при выборе/сбросе письма переключаем панели.</summary>
    private void OnCompactSelectionChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(MailViewModel.SelectedItem))
        {
            UpdateCompactReadingVisibility();
        }
    }

    private ICollectionView? _messageGroupView;

    /// <summary>
    /// Группировка списка писем по датам (Outlook): ключ «0|Сегодня» сортирует
    /// группы хронологически, заголовок отрезает префикс. Представление —
    /// дефолтное для ObservableCollection (жило бы и в тестах).
    /// </summary>
    private void EnableMessageDateGrouping(MailViewModel? viewModel)
    {
        if (_messageGroupView is { } previous)
        {
            previous.GroupDescriptions.Clear();
            _messageGroupView = null;
        }

        if (viewModel is null)
        {
            return;
        }

        var view = System.Windows.Data.CollectionViewSource.GetDefaultView(viewModel.Items);
        if (view is not null
            && view.GroupDescriptions.OfType<PropertyGroupDescription>()
                .All(description => description.PropertyName != nameof(MailListItemViewModel.DateGroup)))
        {
            view.GroupDescriptions.Add(
                new PropertyGroupDescription(nameof(MailListItemViewModel.DateGroup)));
        }

        _messageGroupView = view;
    }

    private void OnPagePropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is "" or nameof(MailViewModel.Detail))
        {
            WireDetail(_page?.Detail);
            _ = RenderMailBodyAsync();
        }
    }

    private void WireDetail(MailDetailViewModel? detail)
    {
        if (ReferenceEquals(_detail, detail))
        {
            return;
        }

        if (_detail is not null)
        {
            _detail.PropertyChanged -= OnDetailPropertyChanged;
        }

        _detail = detail;
        if (detail is not null)
        {
            detail.PropertyChanged += OnDetailPropertyChanged;
        }
    }

    private void OnDetailPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        // Detail.Update() при загрузке другого письма бросает PropertyName="".
        if (e.PropertyName is "" or nameof(MailDetailViewModel.BodyHtml))
        {
            _ = RenderMailBodyAsync();
        }
    }

    /// <summary>Смена темы: цвета вшиты в документ-обёртку — перевыпускаем NavigateToString.</summary>
    private void OnEffectiveThemeChanged(object? sender, EventArgs e) =>
        _ = RenderMailBodyAsync();

    /// <summary>
    /// Ленивый рендер html-тела: инициализация WebView2 только при реальном
    /// открытии письма с body_html; любой сбой (нет рантайма, STA-харнес,
    /// упавший браузерный процесс) — текстовый fallback под слоем WebView2.
    /// </summary>
    private async Task RenderMailBodyAsync()
    {
        if (_mailBodyDisposed)
        {
            return;
        }

        var epoch = ++_mailBodyRenderEpoch;
        var detail = _page?.Detail;
        if (detail is not { HasBodyHtml: true } || _mailBodyUnavailable || !IsLoaded
            || !IsMailHtmlRuntimeHost)
        {
            HideMailHtmlBody();
            return;
        }

        if (!await EnsureMailBodyCoreAsync() || epoch != _mailBodyRenderEpoch || !IsLoaded)
        {
            return;
        }

        detail = _page?.Detail;
        if (detail is not { HasBodyHtml: true } || _mailBodyWebView is not { CoreWebView2: { } core })
        {
            HideMailHtmlBody();
            return;
        }

        // Тело письма — всегда белый «лист» с тёмным текстом (поведение Outlook/TB):
        // корпоративные письма пишутся под белый фон, и их собственные
        // color:black на тёмной подложке превращали текст в невидимый.
        _mailBodyWebView.DefaultBackgroundColor = DrawingColor.White;
        core.NavigateToString(MailHtmlDocument.Wrap(detail.BodyHtml, isDark: false));
    }

    /// <summary>Html-слой прячем только если он вообще был создан; под ним текстовый fallback.</summary>
    private void HideMailHtmlBody()
    {
        if (_mailBodyWebView is { } webView)
        {
            webView.Visibility = Visibility.Collapsed;
        }
    }

    /// <summary>
    /// Html-ридер только в реальном приложении: в STA-харнессе (NativeScreenshots —
    /// голый Application поверх offscreen-окна) WebView2 валит весь процесс в
    /// HwndSubclass при разборке, поэтому там всегда текстовый fallback.
    /// </summary>
    private static bool IsMailHtmlRuntimeHost => System.Windows.Application.Current is App;

    /// <summary>Один in-flight init на view: параллельный рендер ждёт тот же Task.</summary>
    private Task<bool> EnsureMailBodyCoreAsync() =>
        _mailBodyWebView?.CoreWebView2 is not null
            ? Task.FromResult(true)
            : _mailBodyInitTask ??= EnsureMailBodyCoreSlowAsync();

    /// <summary>
    /// WebView2 (HwndHost) создаётся только здесь — после гейта IsMailHtmlRuntimeHost.
    /// Объявленный в XAML элемент цепляется к родительскому hwnd ещё до layout-прохода
    /// и в STA-харнессе тестов (голый Application поверх offscreen-окна) роняет весь
    /// процесс в HwndSubclass при разборке окна, поэтому в разметке его нет.
    /// </summary>
    private WebView2 EnsureMailBodyWebView()
    {
        if (_mailBodyWebView is { } existing)
        {
            return existing;
        }

        var webView = new WebView2 { Visibility = Visibility.Collapsed };
        webView.SetBinding(HeightProperty, new Binding(nameof(ScrollViewer.ViewportHeight))
        {
            Source = DetailScrollViewer,
        });
        AutomationProperties.SetName(webView, "HTML-содержимое письма");
        MailBodyHost.Children.Add(webView);
        _mailBodyWebView = webView;
        return webView;
    }

    private async Task<bool> EnsureMailBodyCoreSlowAsync()
    {
        var webView = EnsureMailBodyWebView();
        // HwndHost создаёт HWND на layout-проходе: показываем элемент и прогоняем
        // layout перед Ensure — иначе инициализация может ждать валидный hwnd.
        webView.Visibility = Visibility.Visible;
        // Письмо рендерится на белом «листе» независимо от темы шелла — см. RenderMailBodyAsync.
        webView.DefaultBackgroundColor = DrawingColor.White;
        webView.UpdateLayout();
        try
        {
            _mailBodyEnvironment ??= new DesktopWebViewEnvironmentProvider(
                DesktopPaths.MailUserDataFolder);
            var environment = await _mailBodyEnvironment.GetAsync();
            await webView.EnsureCoreWebView2Async(environment);
            if (webView.CoreWebView2 is { } core)
            {
                ConfigureMailBodyCore(core);
            }

            return true;
        }
        catch (Exception exception)
        {
            _mailBodyUnavailable = true;
            // Полуинициализированный HwndHost убираем из дерева совсем.
            MailBodyHost.Children.Remove(webView);
            _mailBodyWebView = null;
            _mailBodyInitTask = null;
            webView.Dispose();
            DesktopLog.Error("Mail body WebView2 initialization failed", exception);
            return false;
        }
    }

    /// <summary>Письмо — недоверенный контент: без скриптов, меню, devtools и мостов.</summary>
    private void ConfigureMailBodyCore(CoreWebView2 core)
    {
        var settings = core.Settings;
        settings.IsScriptEnabled = false;
        settings.AreDefaultScriptDialogsEnabled = false;
        settings.AreDefaultContextMenusEnabled = false;
        settings.AreDevToolsEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.IsZoomControlEnabled = false;
        settings.AreHostObjectsAllowed = false;
        settings.IsWebMessageEnabled = false;
        settings.IsGeneralAutofillEnabled = false;
        settings.IsPasswordAutosaveEnabled = false;
        core.NavigationStarting += MailBody_NavigationStarting;
        core.NewWindowRequested += MailBody_NewWindowRequested;
        core.ProcessFailed += MailBody_ProcessFailed;
    }

    private void MailBody_NavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        // Документ смонтирован через NavigateToString (about:blank): переход — это
        // клик по ссылке или сабмит формы письма. about:-якоря внутри документа
        // пропускаем, http(s)/mailto уходят во внешний обработчик ОС, прочее — стоп.
        if (e.Uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        e.Cancel = true;
        TryOpenMailLinkExternally(e.Uri);
    }

    private void MailBody_NewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        // target=_blank из письма — тоже наружу, а не в отдельное окно ридера.
        e.Handled = true;
        TryOpenMailLinkExternally(e.Uri);
    }

    private void MailBody_ProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
    {
        // Браузерный процесс умер — до перезахода на страницу текстовый fallback.
        _mailBodyUnavailable = true;
        HideMailHtmlBody();
        DesktopLog.Warning($"Mail body WebView2 process failed: {e.ProcessFailedKind}");
    }

    private static void TryOpenMailLinkExternally(string? rawUri)
    {
        if (!Uri.TryCreate(rawUri, UriKind.Absolute, out var uri)
            || !uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            && !uri.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
            && !uri.Scheme.Equals(Uri.UriSchemeMailto, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Failed to open a mail link in the system handler", exception);
        }
    }
}

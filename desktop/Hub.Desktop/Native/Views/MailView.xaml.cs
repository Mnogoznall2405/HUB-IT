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
using Grid = System.Windows.Controls.Grid;
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
using Panel = System.Windows.Controls.Panel;
using Point = System.Windows.Point;
using ScrollChangedEventArgs = System.Windows.Controls.ScrollChangedEventArgs;
using SelectionChangedEventArgs = System.Windows.Controls.SelectionChangedEventArgs;
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
        // Пользовательские ширины панелей и свёртка рейки — до первого кадра.
        ApplySavedMailPanePreferences();
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
        // Esc закрывает drawer папок (компактный режим) независимо от фокуса:
        // раньше оверлей закрывался только шевроном или выбором папки.
        if (e.Key == System.Windows.Input.Key.Escape && _railOverlayOpen)
        {
            SetRailOverlayOpen(false);
            e.Handled = true;
            return;
        }

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
    private bool _isRailAutoCollapsed;
    private const double CompactModeThreshold = 760;

    /// <summary>
    /// Между 760 и 920 рейка папок авто-сворачивается в рычаг: трёхпанельный вид
    /// сохраняется, но чтению отдаётся ширина рейки. Служебная свёртка не пишет HKCU.
    /// </summary>
    private const double NarrowRailThreshold = 920;

    /// <summary>
    /// При ширине страницы ниже порога папки и чтение работают попеременно:
    /// клик по письму показывает чтение, «← К списку» возвращает список.
    /// Порог — ширина страницы (окно минус навигация минус поля).
    /// </summary>
    private void MailView_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        var compact = e.NewSize.Width < CompactModeThreshold;
        var autoCollapseRail = e.NewSize.Width < NarrowRailThreshold;
        if (_isCompactMode == compact && _isRailAutoCollapsed == autoCollapseRail)
        {
            return;
        }

        _isCompactMode = compact;
        _isRailAutoCollapsed = autoCollapseRail;
        ApplyCompactMode(compact);
    }

    private void ApplyCompactMode(bool compact)
    {
        if (compact)
        {
            // Папки сворачиваются в рычаг 30px — иначе на узком окне к дереву
            // папок не было бы доступа вообще. Разворот открывает рейку оверлеем
            // поверх списка (drawer), чтобы не вытеснять контент.
            // Служебная свёртка не трогает сохранённый пользовательский выбор.
            SetRailOverlayOpen(false);
            ApplyFolderRailVisual(true);
            FolderSplitterColumn.Width = new GridLength(0);
            FolderSplitter.Width = 0;
            FolderSplitter.Visibility = Visibility.Collapsed;
            ListSplitterColumn.Width = new GridLength(0);
            ListSplitter.Width = 0;
            ListSplitter.Visibility = Visibility.Collapsed;
            MailListColumn.MinWidth = 0;
            CompactBackButton.Visibility = Visibility.Collapsed;
            UpdateCompactReadingVisibility();
        }
        else
        {
            // Полный трёхпанельный вид — в сохранённых пользователем размерах.
            // При _isRailAutoCollapsed рейка визуально свёрнута (рычаг разворота
            // остаётся), сплиттер папок прячем — он не к чему при ширине 30.
            SetRailOverlayOpen(false);
            var railCollapsed = _folderPaneCollapsed || _isRailAutoCollapsed;
            ApplyFolderRailVisual(railCollapsed);
            FolderSplitterColumn.Width = railCollapsed ? new GridLength(0) : new GridLength(6);
            FolderSplitter.Width = railCollapsed ? 0 : 6;
            FolderSplitter.Visibility = railCollapsed ? Visibility.Collapsed : Visibility.Visible;
            ListSplitterColumn.Width = new GridLength(6);
            ListSplitter.Width = 6;
            ListSplitter.Visibility = Visibility.Visible;
            MailListColumn.MinWidth = 280;
            MailListColumn.Width = new GridLength(_listPaneWidth);
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
        // Открытый композер тоже занимает колонку чтения — иначе «Новое письмо»
        // в компактном режиме рисовалось в колонке нулевой ширины за краем окна.
        var hasSelection = viewModel?.SelectedItem is not null || viewModel?.Composer is not null;
        SetRailOverlayOpen(false);
        MailListPanel.Visibility = hasSelection ? Visibility.Collapsed : Visibility.Visible;
        ReadingPaneBorder.Visibility = hasSelection ? Visibility.Visible : Visibility.Collapsed;
        MailListColumn.Width = hasSelection
            ? new GridLength(0)
            : new GridLength(1, GridUnitType.Star);
        MailReadingColumn.Width = hasSelection
            ? new GridLength(1, GridUnitType.Star)
            : new GridLength(0);
        // «К списку» — только при открытом письме: у композера свой крестик,
        // и сброс выбора при открытом композере не должен прятать его панель.
        CompactBackButton.Visibility = viewModel?.SelectedItem is not null
            ? Visibility.Visible
            : Visibility.Collapsed;
    }

    /// <summary>
    /// Узкая панель чтения (~&lt;300): дата перемещается под имя отправителя,
    /// иначе имя схлопывалось до одной буквы («К…») — аватар+дата съедали строку.
    /// </summary>
    private bool _senderHeaderNarrow;

    /// <summary>
    /// «Кому:» разворачивается кликом (Outlook-паттерн): длинный список
    /// получателей обрезается эллипсисом, клик показывает всех с переносом.
    /// Состояние сбрасывается при смене письма.
    /// </summary>
    private bool _toRecipientsExpanded;

    private void DetailToExpand_Click(object sender, RoutedEventArgs e)
    {
        _toRecipientsExpanded = !_toRecipientsExpanded;
        DetailToTextBlock.TextWrapping = _toRecipientsExpanded ? TextWrapping.Wrap : TextWrapping.NoWrap;
        DetailToTextBlock.TextTrimming = _toRecipientsExpanded ? TextTrimming.None : TextTrimming.CharacterEllipsis;
        DetailToExpandButton.SetValue(
            System.Windows.Automation.AutomationProperties.NameProperty,
            _toRecipientsExpanded ? "Свернуть список получателей письма" : "Развернуть список получателей письма");
    }

    private void ResetToRecipientsExpanded()
    {
        _toRecipientsExpanded = false;
        DetailToTextBlock.TextWrapping = TextWrapping.NoWrap;
        DetailToTextBlock.TextTrimming = TextTrimming.CharacterEllipsis;
        DetailToExpandButton.SetValue(
            System.Windows.Automation.AutomationProperties.NameProperty,
            "Развернуть список получателей письма");
    }

    private void DetailSenderGrid_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        var narrow = e.NewSize.Width < 300;
        if (_senderHeaderNarrow == narrow)
        {
            return;
        }

        _senderHeaderNarrow = narrow;
        Grid.SetRow(DetailDateText, narrow ? 1 : 0);
        Grid.SetColumn(DetailDateText, narrow ? 1 : 2);
        DetailDateText.Margin = narrow ? new Thickness(0, 3, 0, 0) : new Thickness(12, 0, 0, 0);
    }

    /// <summary>На узком окне поиск+скоуп+обновление уходят на вторую строку —
    /// группы кнопок остаются в первой, иначе поле налезает на «Ещё»/«Все папки».
    /// Порог = ширина Auto-групп (~650 при 96 DPI: Создание+Сообщения+скоуп+
    /// обновление) + MinWidth поля 220 + запас на локаль/DPI.</summary>
    private const double ToolbarWrapThreshold = 880;
    private bool _toolbarWrapped;

    private void MailToolbarGrid_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        var wrap = e.NewSize.Width < ToolbarWrapThreshold;
        if (wrap == _toolbarWrapped)
        {
            return;
        }

        _toolbarWrapped = wrap;
        if (wrap)
        {
            ToolbarSecondRow.Height = GridLength.Auto;
            Grid.SetRow(ToolbarSearchBox, 1);
            Grid.SetColumn(ToolbarSearchBox, 0);
            Grid.SetColumnSpan(ToolbarSearchBox, 3);
            ToolbarSearchBox.Margin = new Thickness(0, 6, 0, 0);
            Grid.SetRow(ToolbarScopeChip, 1);
            Grid.SetColumn(ToolbarScopeChip, 3);
            ToolbarScopeChip.Margin = new Thickness(6, 6, 0, 0);
            Grid.SetRow(ToolbarRefreshButton, 1);
            Grid.SetColumn(ToolbarRefreshButton, 4);
            ToolbarRefreshButton.Margin = new Thickness(8, 6, 0, 0);
        }
        else
        {
            ToolbarSecondRow.Height = new GridLength(0);
            Grid.SetRow(ToolbarSearchBox, 0);
            Grid.SetColumn(ToolbarSearchBox, 2);
            Grid.SetColumnSpan(ToolbarSearchBox, 1);
            ToolbarSearchBox.Margin = new Thickness(0);
            Grid.SetRow(ToolbarScopeChip, 0);
            Grid.SetColumn(ToolbarScopeChip, 3);
            ToolbarScopeChip.Margin = new Thickness(6, 0, 0, 0);
            Grid.SetRow(ToolbarRefreshButton, 0);
            Grid.SetColumn(ToolbarRefreshButton, 4);
            ToolbarRefreshButton.Margin = new Thickness(8, 0, 0, 0);
        }
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

    // ---- Контекстное меню строки: цель для «Переместить в…» ----

    /// <summary>
    /// Правый клик по строке открывает меню без установки KebabTargetItem —
    /// «Переместить в…» биндился к устаревшей цели (лишь kebab выставлял её):
    /// пункт был.disabled без kebab и мог переместить ЧУЖОЕ письмо после
    /// закрытого kebab-меню. Теперь цель = строка, меню открытое; закрытие
    /// (любое: kebab или правый клик) цель снимает.
    /// </summary>
    private void RowContextMenu_Opening(object sender, System.Windows.Controls.ContextMenuEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: MailListItemViewModel item }
            && DataContext is MailViewModel viewModel)
        {
            viewModel.KebabTargetItem = item;
            ((NativeAsyncCommand)viewModel.MoveItemFromKebabCommand).RaiseCanExecuteChanged();
        }
    }

    /// <summary>Меню строки закрыто без действия — цель больше не нужна.</summary>
    private void RowContextMenu_Closing(object sender, System.Windows.Controls.ContextMenuEventArgs e) =>
        ClearKebabTarget();

    private void ClearKebabTarget()
    {
        if (DataContext is MailViewModel viewModel && viewModel.KebabTargetItem is not null)
        {
            viewModel.KebabTargetItem = null;
            ((NativeAsyncCommand)viewModel.MoveItemFromKebabCommand).RaiseCanExecuteChanged();
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
                // Программное открытие идёт мимо ContextMenuService — Closing-
                // событие строки может не подняться; цель гасим по Closed меню.
                menu.Closed -= KebabMenu_Closed;
                menu.Closed += KebabMenu_Closed;
                return;
            }

            node = VisualTreeHelper.GetParent(node);
        }
    }

    /// <summary>Меню строки (kebab-путь) закрыто — цель «Переместить в…» снимается.</summary>
    private void KebabMenu_Closed(object? sender, RoutedEventArgs e) => ClearKebabTarget();

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

    /// <summary>Ширины панелей и свёртка рейки переживают перезапуск (HKCU, как меню шелла).</summary>
    private const string PreferencesKeyPath = @"Software\HUB-IT\Desktop";
    private const string FolderPaneWidthValueName = "MailFolderPaneWidth";
    private const string ListPaneWidthValueName = "MailListPaneWidth";
    private const string FolderPaneCollapsedValueName = "MailFolderPaneCollapsed";
    private const double DefaultFolderPaneWidth = 200;
    private const double DefaultListPaneWidth = 340;

    private double _folderPaneWidth = DefaultFolderPaneWidth;
    private double _listPaneWidth = DefaultListPaneWidth;
    private bool _folderPaneCollapsed;

    /// <summary>
    /// Свернуть панель папок в тонкий рычаг 30px — чтению отдаётся её ширина.
    /// persist=false — служебные свёртки (компактный режим) не затирают
    /// пользовательский выбор в HKCU.
    /// </summary>
    public void SetFolderRailCollapsed(bool collapsed) => SetFolderRailCollapsed(collapsed, persist: true);

    private void SetFolderRailCollapsed(bool collapsed, bool persist)
    {
        _folderPaneCollapsed = collapsed;
        ApplyFolderRailVisual(collapsed);
        if (!_isCompactMode)
        {
            // Сплиттер папок мёртв при свёрнутой рейке (колонка 30px) — прячем
            // и из визуала, и из Tab-обхода (Focusable у него остаётся, но
            // нулевой невидимый элемент больше не ловит фокус и стрелки).
            FolderSplitterColumn.Width = collapsed ? new GridLength(0) : new GridLength(6);
            FolderSplitter.Width = collapsed ? 0 : 6;
            FolderSplitter.Visibility = collapsed ? Visibility.Collapsed : Visibility.Visible;
        }

        if (persist)
        {
            WriteMailPanePreferences();
        }
    }

    /// <summary>
    /// Визуальная свёртка рейки без записи предпочтения — используется и
    /// пользовательской кнопкой, и компактным режимом (тот не затирает выбор).
    /// </summary>
    private void ApplyFolderRailVisual(bool collapsed)
    {
        MailRailColumn.Width = new GridLength(collapsed ? 30 : _folderPaneWidth);
        MailRailColumn.MinWidth = collapsed ? 30 : 180;
        // Прячем контейнер целиком — перебор детей с прямым присваиванием Visibility
        // затирал их биндинги (редактор папок оставался висеть после разворота).
        MailRailContent.Visibility = collapsed ? Visibility.Collapsed : Visibility.Visible;
        MailRailExpandButton.Visibility = collapsed ? Visibility.Visible : Visibility.Collapsed;
    }

    private void CollapseMailRailButton_Click(object sender, RoutedEventArgs e)
    {
        if (_railOverlayOpen)
        {
            SetRailOverlayOpen(false);
            return;
        }

        _folderPaneWidth = MailRailColumn.ActualWidth > 40
            ? MailRailColumn.ActualWidth
            : _folderPaneWidth;
        SetFolderRailCollapsed(true);
    }

    private void ExpandMailRailButton_Click(object sender, RoutedEventArgs e)
    {
        if (_isCompactMode)
        {
            SetRailOverlayOpen(true);
            return;
        }

        SetFolderRailCollapsed(false);
    }

    private bool _railOverlayOpen;

    /// <summary>
    /// Компактный режим: рычаг открывает рейку папок оверлеем поверх списка
    /// (drawer) — колонка 30px не может вместить дерево, а трёхпанельная
    /// раскладка на <760 поглотила бы список. Выбор папки или переход
    /// к чтению закрывает оверлей.
    /// </summary>
    private void SetRailOverlayOpen(bool open)
    {
        if (_railOverlayOpen == open)
        {
            return;
        }

        _railOverlayOpen = open;
        if (open)
        {
            Grid.SetColumnSpan(MailRailContent, 3);
            MailRailContent.HorizontalAlignment = System.Windows.HorizontalAlignment.Left;
            MailRailContent.Width = Math.Max(_folderPaneWidth, 200);
            Panel.SetZIndex(MailRailContent, 10);
            MailRailContent.Background = (System.Windows.Media.Brush)FindResource("HubSurfaceAltBrush");
            MailRailContent.Effect = new System.Windows.Media.Effects.DropShadowEffect
            {
                Direction = 270,
                BlurRadius = 14,
                ShadowDepth = 0,
                Opacity = 0.45
            };
            MailRailContent.Visibility = Visibility.Visible;
        }
        else
        {
            MailRailContent.ClearValue(Grid.ColumnSpanProperty);
            MailRailContent.ClearValue(FrameworkElement.HorizontalAlignmentProperty);
            MailRailContent.ClearValue(FrameworkElement.WidthProperty);
            MailRailContent.ClearValue(Panel.ZIndexProperty);
            MailRailContent.ClearValue(Panel.BackgroundProperty);
            MailRailContent.ClearValue(UIElement.EffectProperty);
            if (_isCompactMode || _folderPaneCollapsed || _isRailAutoCollapsed)
            {
                MailRailContent.Visibility = Visibility.Collapsed;
            }
        }
    }

    /// <summary>Выбор папки в оверлее компактного режима закрывает drawer.</summary>
    private void MailFolderList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_railOverlayOpen)
        {
            SetRailOverlayOpen(false);
        }
    }

    // Сплиттеры: ширины уходят в HKCU при отпускании — перетаскивание без «твика».

    private void FolderSplitter_DragCompleted(object sender, System.Windows.Controls.Primitives.DragCompletedEventArgs e)
    {
        if (!_folderPaneCollapsed && MailRailColumn.ActualWidth >= 30)
        {
            _folderPaneWidth = MailRailColumn.ActualWidth;
            WriteMailPanePreferences();
        }
    }

    private void ListSplitter_DragCompleted(object sender, System.Windows.Controls.Primitives.DragCompletedEventArgs e)
    {
        if (MailListColumn.ActualWidth >= 30)
        {
            _listPaneWidth = MailListColumn.ActualWidth;
            WriteMailPanePreferences();
        }
    }

    // Двойной клик по разделителю — сброс ширины к стандартной (как в Outlook).

    private void FolderSplitter_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (_folderPaneCollapsed)
        {
            return;
        }
        _folderPaneWidth = DefaultFolderPaneWidth;
        MailRailColumn.Width = new GridLength(_folderPaneWidth);
        WriteMailPanePreferences();
    }

    private void ListSplitter_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        _listPaneWidth = DefaultListPaneWidth;
        MailListColumn.Width = new GridLength(_listPaneWidth);
        WriteMailPanePreferences();
    }

    /// <summary>Чтение сохранённых ширин/свёртки до первого кадра (как NavigationCollapsed у шелла).</summary>
    private void ApplySavedMailPanePreferences()
    {
        var (folderWidth, listWidth, collapsed) = ReadMailPanePreferences();
        _folderPaneWidth = folderWidth;
        _listPaneWidth = listWidth;
        MailListColumn.Width = new GridLength(listWidth);
        if (collapsed)
        {
            SetFolderRailCollapsed(collapsed: true, persist: false);
        }
        else
        {
            MailRailColumn.Width = new GridLength(folderWidth);
        }
    }

    private static (double FolderWidth, double ListWidth, bool Collapsed) ReadMailPanePreferences()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(PreferencesKeyPath);
            var folder = key?.GetValue(FolderPaneWidthValueName) is int storedFolder
                ? Math.Clamp(storedFolder, 160, 600)
                : DefaultFolderPaneWidth;
            var list = key?.GetValue(ListPaneWidthValueName) is int storedList
                ? Math.Clamp(storedList, 260, 900)
                : DefaultListPaneWidth;
            var collapsed = key?.GetValue(FolderPaneCollapsedValueName) is int storedCollapsed
                && storedCollapsed == 1;
            return (folder, list, collapsed);
        }
        catch
        {
            return (DefaultFolderPaneWidth, DefaultListPaneWidth, false);
        }
    }

    private void WriteMailPanePreferences()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(PreferencesKeyPath);
            key?.SetValue(FolderPaneWidthValueName, (int)Math.Round(_folderPaneWidth), Microsoft.Win32.RegistryValueKind.DWord);
            key?.SetValue(ListPaneWidthValueName, (int)Math.Round(_listPaneWidth), Microsoft.Win32.RegistryValueKind.DWord);
            key?.SetValue(FolderPaneCollapsedValueName, _folderPaneCollapsed ? 1 : 0, Microsoft.Win32.RegistryValueKind.DWord);
        }
        catch
        {
            // Настройка необязательна: молча продолжаем с состоянием сессии.
        }
    }

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
            _page.Items.CollectionChanged -= OnItemsResetScrollTop;
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
            // Смена папки/фильтра/поиска (Clear+Add → Reset) — скролл списка в начало;
            // догрузка порций идёт чистым Add и позицию не трогает.
            viewModel.Items.CollectionChanged += OnItemsResetScrollTop;
        }

        _ = RenderMailBodyAsync();
    }

    /// <summary>Reset коллекции писем (новая папка/фильтр/поиск) — возвращаем список к первому письму.</summary>
    private void OnItemsResetScrollTop(object? sender, System.Collections.Specialized.NotifyCollectionChangedEventArgs e)
    {
        if (e.Action == System.Collections.Specialized.NotifyCollectionChangedAction.Reset)
        {
            _messageListScrollViewer?.ScrollToTop();
        }
    }

    /// <summary>Компактный режим: при выборе/сбросе письма и открытии композера переключаем панели.</summary>
    private void OnCompactSelectionChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(MailViewModel.SelectedItem)
            or nameof(MailViewModel.Composer)
            or nameof(MailViewModel.IsComposeOpen))
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
        ResetToRecipientsExpanded();
        ResetDetailScroll();
        if (detail is not null)
        {
            detail.PropertyChanged += OnDetailPropertyChanged;
        }
    }

    /// <summary>Смена письма — шапка деталей и фолбэк-тело начинаются сверху,
    /// как список при смене папки (ScrollViewer позицию сохраняет).</summary>
    private void ResetDetailScroll()
    {
        DetailScrollViewer.ScrollToTop();
        PlainBodyViewer.ScrollToTop();
    }

    private void OnDetailPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        // Detail.Update() при загрузке другого письма бросает PropertyName="".
        if (e.PropertyName is "")
        {
            // Тот же MailDetailViewModel переиспользуется — состояние «Кому»
            // развёрнуто не должно протекать в следующее письмо.
            ResetToRecipientsExpanded();
            ResetDetailScroll();
            _ = RenderMailBodyAsync();
        }
        else if (e.PropertyName is nameof(MailDetailViewModel.BodyHtml))
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

        if (!await EnsureMailBodyCoreAsync())
        {
            // Init упал (нет рантайма, профиль занят): html-слоя не будет —
            // показываем текстовый fallback, иначе тело этого письма пусто
            // до смены письма (ранние рендеры спрятали PlainBodyViewer).
            HideMailHtmlBody();
            return;
        }

        if (epoch != _mailBodyRenderEpoch || !IsLoaded)
        {
            return;
        }

        detail = _page?.Detail;
        if (detail is not { HasBodyHtml: true } || _mailBodyWebView is not { CoreWebView2: { } core })
        {
            HideMailHtmlBody();
            return;
        }

        // DefaultBackgroundColor = поверхность панели чтения (тёмная в тёмной теме,
        // белая в светлой). Белый «лист» письма рисует сам HTML-документ (body).
        // Раньше стоял жёсткий White → ниже короткого письма оставался
        // гигантский белый прямоугольник (P0-дефект).
        _mailBodyWebView.DefaultBackgroundColor = NativeThemeManager.EffectiveMode == "dark"
            ? DrawingColor.FromArgb(0x24, 0x28, 0x2F)
            : DrawingColor.White;
        core.NavigateToString(MailHtmlDocument.Wrap(detail.BodyHtml, isDark: false));
        UpdateMailBodyVisibility(htmlRendered: true);
    }

    /// <summary>Html-слой прячем; без него читатель видит текстовый fallback.</summary>
    private void HideMailHtmlBody() => UpdateMailBodyVisibility(htmlRendered: false);

    /// <summary>
    /// Видимость слоёв тела: текстовый ScrollViewer — когда html нет вообще
    /// ИЛИ когда WebView2 не смог/не должен рендерить (нет рантайма, STA-харнесс,
    /// упавший браузерный процесс). Пустого белого поля быть не должно.
    /// </summary>
    private void UpdateMailBodyVisibility(bool htmlRendered)
    {
        var detail = _page?.Detail;
        var showPlain = detail is { } current
            && (current.ShowPlainTextBody || (current.HasAnyBody && !htmlRendered));
        PlainBodyViewer.Visibility = showPlain ? Visibility.Visible : Visibility.Collapsed;
        if (_mailBodyWebView is { } webView)
        {
            webView.Visibility = htmlRendered ? Visibility.Visible : Visibility.Collapsed;
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

        // Размер задаёт строка Grid (Row=*, вне ScrollViewer — HWND клипается
        // границами строки). Привязки Height к чужому вьюпорту здесь нет:
        // она давала WebView2 высоту шапки вместо высоты области тела.
        var webView = new WebView2 { Visibility = Visibility.Collapsed };
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
        // DefaultBackgroundColor = поверхность чтения (см. RenderMailBodyAsync):
        // белый «лист» рисует сам HTML, подложка совпадает с панелью.
        webView.DefaultBackgroundColor = NativeThemeManager.EffectiveMode == "dark"
            ? DrawingColor.FromArgb(0x24, 0x28, 0x2F)
            : DrawingColor.White;
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
        // F5/Ctrl+F/Ctrl+P внутри тела письма не должны уходить в браузер —
        // ускорители WebView2 отключены, клавиши остаются за шеллом.
        settings.AreBrowserAcceleratorKeysEnabled = false;
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

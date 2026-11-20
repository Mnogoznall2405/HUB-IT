using System.Collections.Specialized;
using System.Windows;
using System.Windows.Controls;
using Binding = System.Windows.Data.Binding;
using Hub.Desktop.Native.ViewModels;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Страница «Доступы»: матрица доступа AD (учётки × папки) — read-only.
/// Колонки DataGrid строятся по MatrixGroups: 0 — учётка, дальше — по одной
/// на группу; ячейка показывает R/W/F/+ или «·» (нет доступа). Клик по ячейке
/// колонки-группы открывает карточку с участниками.
/// </summary>
public partial class GroupsAccessView : UserControl
{
    private GroupsAccessViewModel? _viewModel;

    public GroupsAccessView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
        DataContextChanged += GroupsAccessView_DataContextChanged;
    }

    private void GroupsAccessView_DataContextChanged(object sender, DependencyPropertyChangedEventArgs e)
    {
        if (e.OldValue is GroupsAccessViewModel oldModel)
        {
            oldModel.MatrixGroups.CollectionChanged -= MatrixGroups_CollectionChanged;
        }

        _viewModel = e.NewValue as GroupsAccessViewModel;
        if (_viewModel is not null)
        {
            _viewModel.MatrixGroups.CollectionChanged += MatrixGroups_CollectionChanged;
            RebuildColumns();
        }
        else
        {
            MatrixGrid.Columns.Clear();
        }
    }

    /// <summary>Пересобрать колонки при замене выборки групп (Clear+Add → Reset).</summary>
    private void MatrixGroups_CollectionChanged(object? sender, NotifyCollectionChangedEventArgs e)
        => RebuildColumns();

    private void RebuildColumns()
    {
        var model = _viewModel;
        if (model is null)
        {
            return;
        }

        MatrixGrid.Columns.Clear();
        MatrixGrid.Columns.Add(new DataGridTextColumn
        {
            Header = "Учётка",
            Binding = new Binding(nameof(GroupsAccessMatrixRowViewModel.UserText)),
            MinWidth = 160,
            Width = new DataGridLength(200),
            ElementStyle = BuildUserCellStyle(),
        });

        for (var index = 0; index < model.MatrixGroups.Count; index++)
        {
            var group = model.MatrixGroups[index];
            MatrixGrid.Columns.Add(new DataGridTextColumn
            {
                // Header — вся модель группы: шаблон GroupHeaderTemplate
                // показывает метку папки и уровень, tooltip — путь и DN.
                Header = group,
                HeaderTemplate = (DataTemplate)Resources["GroupHeaderTemplate"],
                Binding = new Binding(
                    $"{nameof(GroupsAccessMatrixRowViewModel.Cells)}[{index}]."
                        + nameof(GroupsAccessMatrixCell.Mark)),
                MinWidth = 52,
                Width = new DataGridLength(1, DataGridLengthUnitType.Auto),
                ElementStyle = BuildCellStyle(index),
            });
        }
    }

    /// <summary>Стиль ячейки группы i: метка по центру, тон по Cells[i].Tone, tooltip — Label.</summary>
    private Style BuildCellStyle(int index)
    {
        var tonePath = $"{nameof(GroupsAccessMatrixRowViewModel.Cells)}[{index}]."
            + nameof(GroupsAccessMatrixCell.Tone);
        var style = new Style(typeof(TextBlock));
        style.Setters.Add(new Setter(
            FrameworkElement.HorizontalAlignmentProperty,
            System.Windows.HorizontalAlignment.Center));
        style.Setters.Add(new Setter(TextBlock.FontSizeProperty, 12.0));
        style.Setters.Add(new Setter(TextBlock.FontWeightProperty, FontWeights.SemiBold));
        // DynamicResourceExtension (не FindResource): кисти палитры подменяются
        // при смене темы на лету — статическая кисть залипла бы на старой теме.
        style.Setters.Add(new Setter(
            TextBlock.ForegroundProperty, new DynamicResourceExtension("HubTextSecondaryBrush")));
        style.Setters.Add(new Setter(
            FrameworkElement.ToolTipProperty,
            new Binding(
                $"{nameof(GroupsAccessMatrixRowViewModel.Cells)}[{index}]."
                    + nameof(GroupsAccessMatrixCell.Label))));
        style.Triggers.Add(new DataTrigger
        {
            Binding = new Binding(tonePath),
            Value = "info",
            Setters = { new Setter(TextBlock.ForegroundProperty, new DynamicResourceExtension("HubAccentBrush")) },
        });
        style.Triggers.Add(new DataTrigger
        {
            Binding = new Binding(tonePath),
            Value = "warning",
            Setters = { new Setter(TextBlock.ForegroundProperty, new DynamicResourceExtension("HubWarningBrush")) },
        });
        style.Triggers.Add(new DataTrigger
        {
            Binding = new Binding(tonePath),
            Value = "error",
            Setters = { new Setter(TextBlock.ForegroundProperty, new DynamicResourceExtension("HubErrorTextBrush")) },
        });
        style.Triggers.Add(new DataTrigger
        {
            Binding = new Binding(tonePath),
            Value = "muted",
            Setters = { new Setter(TextBlock.ForegroundProperty, new DynamicResourceExtension("HubBorderBrush")) },
        });
        return style;
    }

    /// <summary>Стиль колонки учётки: подсказка — логин (display_name уходит в текст).</summary>
    private Style BuildUserCellStyle()
    {
        var style = new Style(typeof(TextBlock));
        style.Setters.Add(new Setter(TextBlock.FontSizeProperty, 12.0));
        style.Setters.Add(new Setter(TextBlock.TextTrimmingProperty, TextTrimming.CharacterEllipsis));
        style.Setters.Add(new Setter(
            FrameworkElement.ToolTipProperty,
            new Binding(nameof(GroupsAccessMatrixRowViewModel.Login))));
        return style;
    }

    /// <summary>Клик по ячейке → выбор строки-учётки и колонки-группы в модели.</summary>
    private void MatrixGrid_CurrentCellChanged(object? sender, EventArgs e)
    {
        var model = _viewModel;
        if (model is null)
        {
            return;
        }

        var cell = MatrixGrid.CurrentCell;
        var row = cell.Item as GroupsAccessMatrixRowViewModel;
        var columnIndex = cell.Column is null ? -1 : MatrixGrid.Columns.IndexOf(cell.Column);
        // Колонка 0 — учётка; её клик снимает выбор группы.
        model.SelectMatrixCell(row, columnIndex - 1);
    }
}

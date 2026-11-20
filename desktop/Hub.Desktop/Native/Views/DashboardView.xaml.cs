using Hub.Desktop.Native.ViewModels;
using Key = System.Windows.Input.Key;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Главная страница шелла: сводка, ближайшие задачи, новости, отсутствующие.
/// Диалог «Предложить улучшение HUB» — модальный оверлей поверх страницы
/// (Esc = «Закрыть», фокус при открытии — на заголовке формы).
/// </summary>
public partial class DashboardView : UserControl
{
    public DashboardView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }

    /// <summary>Esc в оверлее предложения — то же, что «✕»/«Закрыть» диалога.</summary>
    private void FeedbackOverlay_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape
            && DataContext is DashboardViewModel viewModel
            && viewModel.Feedback?.CloseCommand.CanExecute(null) == true)
        {
            viewModel.Feedback.CloseCommand.Execute(null);
            e.Handled = true;
        }
    }

    /// <summary>При открытии оверлея фокус — на первом поле формы (как в веб-диалоге).</summary>
    private void FeedbackOverlay_IsVisibleChanged(
        object sender,
        System.Windows.DependencyPropertyChangedEventArgs e)
    {
        if (e.NewValue is System.Windows.Visibility.Visible)
        {
            FeedbackTitleInput.Focus();
        }
    }
}

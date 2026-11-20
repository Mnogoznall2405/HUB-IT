using Hub.Desktop.Native.ViewModels;
using Key = System.Windows.Input.Key;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Страница «Отсутствия»: кто отсутствует на день или за неделю (HUB + ЗУП).
/// Диалог ручной записи — модальный оверлей поверх списка (Esc = Отмена).
/// </summary>
public partial class AbsencesView : UserControl
{
    public AbsencesView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }

    /// <summary>Esc в оверлее редактора — закрытие диалога (как ✕/Отмена).</summary>
    private void AbsenceEditorOverlay_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Escape
            || DataContext is not AbsencesViewModel model
            || model.Editor is null)
        {
            return;
        }

        model.Editor.CloseCommand.Execute(null);
        e.Handled = true;
    }
}

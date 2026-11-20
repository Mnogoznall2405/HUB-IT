using System.Windows.Input;
using Hub.Desktop.Native.ViewModels;
using Key = System.Windows.Input.Key;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Страница «VCS»: список терминалов ВКС с кнопкой «Подключиться»
/// (запуск внешнего VNC-клиента через системный обработчик vnc://).
/// При праве vcs.manage — добавление/правка/armed-удаление терминалов,
/// порядок ↑/↓ и диалоги «Пароль VNC»/«Информация» (Esc = Отмена).
/// </summary>
public partial class VcsView : UserControl
{
    public VcsView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }

    /// <summary>Esc в оверлее редактора терминала — закрытие диалога (как ✕/Отмена).</summary>
    private void EditorOverlay_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Escape
            || DataContext is not VcsViewModel model
            || model.Editor is null)
        {
            return;
        }

        ExecuteIfAble(model.Editor.CloseCommand);
        e.Handled = true;
    }

    /// <summary>Esc в оверлее «Пароль VNC» — закрытие диалога (как ✕/Отмена).</summary>
    private void ConfigOverlay_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Escape || DataContext is not VcsViewModel model)
        {
            return;
        }

        ExecuteIfAble(model.CloseConfigCommand);
        e.Handled = true;
    }

    /// <summary>Esc в оверлее «Информация» — закрытие диалога (как ✕/Отмена).</summary>
    private void InfoOverlay_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Escape || DataContext is not VcsViewModel model)
        {
            return;
        }

        ExecuteIfAble(model.CloseInfoCommand);
        e.Handled = true;
    }

    /// <summary>Команда диалога исполняется только если разрешена (busy — закрытие заблокировано).</summary>
    private static void ExecuteIfAble(ICommand command)
    {
        if (command.CanExecute(null))
        {
            command.Execute(null);
        }
    }
}

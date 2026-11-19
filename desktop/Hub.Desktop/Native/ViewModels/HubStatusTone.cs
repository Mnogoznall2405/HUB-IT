namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Ключи тонов статусных акцентов: VM отдаёт строку-тон вместо замороженной
/// кисти, а разметка красит элемент палитровой кистью через DataTrigger
/// на views:HubTone.Value (стили HubTone* в HubTheme.xaml) — DynamicResource
/// перекрашивает акценты при смене темы, замороженные Brush этого не умели.
/// </summary>
public static class HubStatusTone
{
    /// <summary>Новый/инфо — голубой (HubStatusNewBrush).</summary>
    public const string Info = "info";

    /// <summary>В работе/предупреждение — янтарный (HubStatusInProgressBrush).</summary>
    public const string Warning = "warning";

    /// <summary>На проверке — фиолетовый (HubStatusReviewBrush).</summary>
    public const string Review = "review";

    /// <summary>Выполнено/в сети — зелёный (HubStatusDoneBrush).</summary>
    public const string Success = "success";

    /// <summary>Просрочено/срочно/ошибка — красный (HubStatusOverdueBrush).</summary>
    public const string Danger = "danger";

    /// <summary>Без статуса/офлайн — приглушённый (HubTextSecondaryBrush).</summary>
    public const string Muted = "muted";
}

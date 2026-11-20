using System.Collections.ObjectModel;
using System.Globalization;
using System.Text.Json;
using System.Windows.Input;
using System.Windows.Media;
using Hub.Desktop.Native.Api;
using Brush = System.Windows.Media.Brush;
using Color = System.Windows.Media.Color;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Форматтеры страницы «DLP-мониторинг» — порт utils.js из веб-компонентов dlp/
/// (formatDuration, channel labels, минуты→HH:MM). Время бакетов — локальное
/// для филиала: клиент его не сдвигает, только форматирует.
/// </summary>
internal static class DlpFormat
{
    /// <summary>Метки каналов файлового журнала — CHANNEL_LABELS из dlp/utils.js.</summary>
    public static string ChannelLabel(string? channel) => channel switch
    {
        "usb" => "USB",
        "telegram" => "Telegram",
        "max" => "MAX",
        "browser" => "Браузер",
        "deleted" => "Удалено",
        "internal" => "Внутреннее",
        "mail" => "Почта",
        _ => string.IsNullOrWhiteSpace(channel) ? "—" : channel!,
    };

    /// <summary>Метки категорий визитов — category_meta веба.</summary>
    public static string CategoryLabel(string? category) => category switch
    {
        "internal" => "Внутреннее",
        "work" => "Работа",
        "mail" => "Почта",
        "search" => "Поиск",
        "maps" => "Карты",
        "shopping" => "Покупки",
        "social" => "Соцсети",
        "im" => "Мессенджеры",
        "news" => "Новости",
        "entertainment" => "Развлечения",
        _ => string.IsNullOrWhiteSpace(category) ? "Прочее" : category!,
    };

    /// <summary>Длительность «N ч N мин» / «N мин» / «N сек».</summary>
    public static string Duration(double? seconds)
    {
        if (seconds is null || seconds <= 0)
        {
            return "0 сек";
        }

        var total = TimeSpan.FromSeconds(seconds.Value);
        if (total.TotalHours >= 1)
        {
            return $"{(int)total.TotalHours} ч {total.Minutes} мин";
        }

        return total.TotalMinutes >= 1
            ? $"{(int)total.TotalMinutes} мин"
            : $"{Math.Max(1, (int)Math.Round(total.TotalSeconds))} сек";
    }

    public static string Bytes(long? bytes)
    {
        if (bytes is null or <= 0)
        {
            return "0";
        }

        string[] units = ["Б", "КБ", "МБ", "ГБ"];
        double value = bytes.Value;
        var unit = 0;
        while (value >= 1024 && unit < units.Length - 1)
        {
            value /= 1024;
            unit++;
        }

        return $"{value:0.#} {units[unit]}";
    }

    /// <summary>Минуты от полуночи → «HH:MM» (график работы).</summary>
    public static string MinToHm(int? minutes)
    {
        if (minutes is null)
        {
            return "—";
        }

        var m = Math.Clamp(minutes.Value, 0, 24 * 60 - 1);
        return $"{m / 60:D2}:{m % 60:D2}";
    }

    /// <summary>«HH:MM»/«H:MM» → минуты от полуночи; null — распарсить не вышло.</summary>
    public static int? ParseHm(string? text)
    {
        var parts = (text ?? string.Empty).Trim().Split(':');
        if (parts.Length != 2
            || !int.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out var h)
            || !int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var m)
            || h is < 0 or > 23
            || m is < 0 or > 59)
        {
            return null;
        }

        return h * 60 + m;
    }

    /// <summary>epoch-секунды → «HH:mm» сегодня или «dd.MM HH:mm».</summary>
    public static string Ts(long? epochSeconds)
    {
        if (epochSeconds is null or <= 0)
        {
            return "—";
        }

        var local = DateTimeOffset.FromUnixTimeSeconds(epochSeconds.Value).LocalDateTime;
        return local.Date == DateTime.Today
            ? local.ToString("HH:mm", CultureInfo.InvariantCulture)
            : local.ToString("dd.MM HH:mm", CultureInfo.InvariantCulture);
    }

    /// <summary>branch_no из JSON может быть числом или строкой — показываем как есть.</summary>
    public static string BranchNo(JsonElement? element)
    {
        if (element is null)
        {
            return string.Empty;
        }

        var raw = element.Value;
        return raw.ValueKind switch
        {
            JsonValueKind.Number => raw.ToString(),
            JsonValueKind.String => raw.GetString() ?? string.Empty,
            _ => string.Empty,
        };
    }

    /// <summary>Маска дней недели → «Пн Вт Ср Чт Пт» (бит 0 — понедельник).</summary>
    public static string Workdays(int mask)
    {
        string[] names = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
        var active = Enumerable.Range(0, 7)
            .Where(i => (mask & (1 << i)) != 0)
            .Select(i => names[i]);
        return string.Join(" ", active);
    }
}

/// <summary>Строка списка ПК слева — статистика файлов/визитов за окно.</summary>
public sealed class DlpHostItemViewModel : ObservableObject
{
    private bool _isSelected;

    public DlpHostItemViewModel(HubDlpHost row)
    {
        ComputerName = row.ComputerName?.Trim() ?? string.Empty;
        var user = !string.IsNullOrWhiteSpace(row.UserFullName)
            ? row.UserFullName!.Trim()
            : row.Login ?? row.UserLogin ?? row.WindowsUser ?? string.Empty;
        UserText = string.IsNullOrWhiteSpace(user) ? "—" : user;
        var branchNo = DlpFormat.BranchNo(row.BranchNo);
        BranchName = row.BranchName ?? string.Empty;
        BranchText = string.IsNullOrWhiteSpace(row.BranchName)
            ? "Филиал не определён"
            : string.IsNullOrWhiteSpace(branchNo) ? row.BranchName! : $"{row.BranchName} №{branchNo}";
        LastSeenText = "Активность: " + DlpFormat.Ts(row.LastTs);
        // Статистика «файлы·usb·tg·max·визиты» — compact chips в строке списка.
        StatsText = string.Join(
            " · ",
            $"файлы {row.FileEvents}",
            $"usb {row.UsbEvents}",
            $"tg {row.TelegramEvents}",
            $"max {row.MaxEvents}",
            $"визиты {row.Visits}");
    }

    public string ComputerName { get; }
    public string UserText { get; }
    public string BranchName { get; }
    public string BranchText { get; }
    public string LastSeenText { get; }
    public string StatsText { get; }

    /// <summary>Подсветка выбранной строки списка (двусторонняя синхронизация).</summary>
    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }
}

/// <summary>Строка «требует внимания» — хост + метрика группы.</summary>
public sealed class DlpAttentionRowViewModel
{
    public DlpAttentionRowViewModel(HubDlpAttentionHost row, string metric)
    {
        ComputerName = row.ComputerName?.Trim() ?? string.Empty;
        var name = !string.IsNullOrWhiteSpace(row.UserFullName)
            ? row.UserFullName!.Trim()
            : ComputerName;
        Title = name;
        Subtitle = string.IsNullOrWhiteSpace(row.BranchName) ? ComputerName : row.BranchName!;
        MetricText = metric;
    }

    public string ComputerName { get; }
    public string Title { get; }
    public string Subtitle { get; }
    public string MetricText { get; }
}

/// <summary>Одна из 4 групп «требует внимания»: развлечения/простой/USB/мессенджеры.</summary>
public sealed class DlpAttentionGroupViewModel
{
    public DlpAttentionGroupViewModel(string title, IEnumerable<DlpAttentionRowViewModel> rows)
    {
        Title = title;
        Items = rows.ToList();
    }

    public string Title { get; }
    public IReadOnlyList<DlpAttentionRowViewModel> Items { get; }
    public bool HasItems => Items.Count > 0;
}

/// <summary>Ячейка 5-минутной шкалы дня (288 ячеек, цвет = доминирующее состояние).</summary>
public sealed class DlpBucketCellViewModel
{
    // Кисти статичны и заморожены: ячейки в юнит-тестах создаются на потоках
    // пула, а замороженный Freezable — валидный DependencySource на любом потоке
    // (иначе первый биндинг на STA падает с «DependencySource в том же потоке»).
    private static readonly Brush ActiveBrush = FrozenBrush(0x2E, 0x7D, 0x32);
    private static readonly Brush PassiveBrush = FrozenBrush(0x90, 0xCA, 0xF9);
    private static readonly Brush AwayBrush = FrozenBrush(0xED, 0x6C, 0x02);
    private static readonly Brush LockedBrush = FrozenBrush(0x75, 0x75, 0x75);
    private static readonly Brush BreakBrush = FrozenBrush(0x02, 0x88, 0xD1);
    private static readonly Brush OffshiftBrush = FrozenBrush(0x90, 0xA4, 0xAE);
    private static readonly Brush EmptyBrush = FrozenBrush(0x60, 0x60, 0x60, 0.35);

    private static Brush FrozenBrush(byte r, byte g, byte b, double opacity = 1.0)
    {
        var brush = new SolidColorBrush(Color.FromRgb(r, g, b)) { Opacity = opacity };
        brush.Freeze();
        return brush;
    }

    public DlpBucketCellViewModel(int minuteOfDay, string label, string tooltip, Brush fill)
    {
        MinuteOfDay = minuteOfDay;
        TimeText = $"{minuteOfDay / 60:D2}:{minuteOfDay % 60:D2}";
        StateLabel = label;
        TooltipText = tooltip;
        Fill = fill;
    }

    public int MinuteOfDay { get; }
    public string TimeText { get; }
    public string StateLabel { get; }
    public string TooltipText { get; }
    public Brush Fill { get; }

    public static DlpBucketCellViewModel Empty(int minuteOfDay) =>
        new(minuteOfDay, "нет данных", $"{minuteOfDay / 60:D2}:{minuteOfDay % 60:D2} — нет данных", EmptyBrush);

    /// <summary>Доминирующее состояние бакета + метка зоны графика.</summary>
    public static DlpBucketCellViewModel FromBucket(HubDlpActivityBucket bucket)
    {
        var minute = 0;
        if (DateTimeOffset.TryParse(
                bucket.BucketStart,
                CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None,
                out var parsed))
        {
            minute = parsed.Hour * 60 + parsed.Minute;
        }

        var (label, fill) = DominantState(bucket);
        var zone = bucket.Zone switch
        {
            "lunch" => "обед",
            "off" => "вне смены",
            _ => "смена",
        };
        var tooltip = $"{minute / 60:D2}:{minute % 60:D2} — {label} ({zone})"
            + (string.IsNullOrWhiteSpace(bucket.App) ? string.Empty : $", {bucket.App}");
        return new DlpBucketCellViewModel(minute, label, tooltip, fill);
    }

    private static (string Label, Brush Fill) DominantState(HubDlpActivityBucket bucket)
    {
        if (bucket.ActiveSec > 0)
        {
            return bucket.Zone == "off" ? ("ввод вне смены", AwayBrush) : ("активен", ActiveBrush);
        }

        if (bucket.BreakSec > 0)
        {
            return ("обед", BreakBrush);
        }

        if (bucket.OffshiftSec > 0)
        {
            return ("вне смены", OffshiftBrush);
        }

        if (bucket.AwaySec >= bucket.PassiveSec && bucket.AwaySec >= bucket.LockedSec && bucket.AwaySec > 0)
        {
            return ("отошёл", AwayBrush);
        }

        if (bucket.LockedSec >= bucket.PassiveSec && bucket.LockedSec > 0)
        {
            return ("блокировка", LockedBrush);
        }

        return bucket.PassiveSec > 0 ? ("пауза", PassiveBrush) : ("нет данных", EmptyBrush);
    }
}

/// <summary>Непрерывный участок одинакового состояния в дневной ленте.</summary>
public sealed class DlpRunViewModel
{
    public DlpRunViewModel(string range, string state, string? app, double seconds)
    {
        RangeText = range;
        StateText = state;
        AppText = app ?? string.Empty;
        DurationText = DlpFormat.Duration(seconds);
    }

    public string RangeText { get; }
    public string StateText { get; }
    public string AppText { get; }
    public string DurationText { get; }
}

/// <summary>Приложение из apps_top с длительностью.</summary>
public sealed class DlpAppChipViewModel
{
    public DlpAppChipViewModel(HubDlpAppTop row)
    {
        Name = string.IsNullOrWhiteSpace(row.App) ? "—" : row.App!;
        DurationText = DlpFormat.Duration(row.Sec);
    }

    public string Name { get; }
    public string DurationText { get; }
}

/// <summary>Строка вкладки «Файлы» (fs-egress group=1).</summary>
public sealed class DlpFileEventViewModel
{
    public DlpFileEventViewModel(HubFsEgressEvent row)
    {
        TimeText = DlpFormat.Ts(row.Ts);
        ChannelText = DlpFormat.ChannelLabel(row.Channel);
        FileName = string.IsNullOrWhiteSpace(row.FileName) ? "—" : row.FileName!;
        SizeText = DlpFormat.Bytes(row.Size);
        CountText = row.Count is > 1 ? $"×{row.Count}" : string.Empty;
        StateText = row.SendState switch
        {
            "sent" => "отправлено",
            "skipped" => "пропущено",
            _ => string.Empty,
        };
    }

    public string TimeText { get; }
    public string ChannelText { get; }
    public string FileName { get; }
    public string SizeText { get; }
    public string CountText { get; }
    public string StateText { get; }
}

/// <summary>Сообщение диалога Telegram/MAX.</summary>
public sealed class DlpMessageViewModel
{
    public DlpMessageViewModel(HubDlpChatMessage row)
    {
        DirectionMark = row.Direction == "out" ? "→" : row.Direction == "in" ? "←" : "·";
        var sender = string.IsNullOrWhiteSpace(row.Sender) ? string.Empty : row.Sender!.Trim();
        SenderText = string.IsNullOrWhiteSpace(sender) ? DirectionMark : $"{DirectionMark} {sender}";
        TimeText = row.Time ?? string.Empty;
        var text = !string.IsNullOrWhiteSpace(row.Text) ? row.Text! : row.Media ?? string.Empty;
        Text = string.IsNullOrWhiteSpace(text) ? "(медиа/пусто)" : text;
    }

    public string DirectionMark { get; }
    public string SenderText { get; }
    public string TimeText { get; }
    public string Text { get; }
}

/// <summary>Диалог Telegram/MAX с последними сообщениями.</summary>
public sealed class DlpChatViewModel
{
    public DlpChatViewModel(HubDlpChat row)
    {
        ChatName = string.IsNullOrWhiteSpace(row.ChatName) ? row.ChatId ?? "Чат" : row.ChatName!;
        UpdatedText = "Обновлён: " + (row.UpdatedAt is > 0 ? DlpFormat.Ts(row.UpdatedAt) : "—");
        // Последние сообщения диалога (агент хранит хвост) — до 15 на карточку.
        Messages = (row.Messages ?? Array.Empty<HubDlpChatMessage>())
            .TakeLast(15)
            .Select(message => new DlpMessageViewModel(message))
            .ToList();
        CountText = $"сообщений: {row.Messages?.Count ?? 0}"
            + (row.Screenshots?.Count > 0 ? $" · скриншоты: {row.Screenshots.Count}" : string.Empty);
    }

    public string ChatName { get; }
    public string UpdatedText { get; }
    public string CountText { get; }
    public IReadOnlyList<DlpMessageViewModel> Messages { get; }
}

/// <summary>Строка вкладки «Браузер» — визит с категорией и dwell.</summary>
public sealed class DlpVisitViewModel
{
    public DlpVisitViewModel(HubBrowserVisit row)
    {
        var time = "—";
        if (!string.IsNullOrWhiteSpace(row.VisitedAt)
            && DateTimeOffset.TryParse(row.VisitedAt, CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var parsed))
        {
            var local = parsed.LocalDateTime;
            time = local.Date == DateTime.Today
                ? local.ToString("HH:mm", CultureInfo.InvariantCulture)
                : local.ToString("dd.MM HH:mm", CultureInfo.InvariantCulture);
        }

        TimeText = time;
        TitleText = string.IsNullOrWhiteSpace(row.Title) ? row.Domain ?? row.Url ?? "—" : row.Title!;
        UrlText = row.Url ?? string.Empty;
        var dwell = row.DwellSec is > 0 ? DlpFormat.Duration(row.DwellSec) : string.Empty;
        DwellText = row.Merged && row.Count > 1 ? $"{dwell} · ×{row.Count}" : dwell;
        CategoryText = DlpFormat.CategoryLabel(row.CategoryDisplay ?? row.Category);
        var idle = row.IdleSec is > 0 ? $" · бездействие {DlpFormat.Duration(row.IdleSec)}" : string.Empty;
        MetaText = $"{row.Browser ?? "?"} · {row.Profile ?? "?"}{idle}"
            + (string.IsNullOrWhiteSpace(row.ScreenshotFile) ? string.Empty : " · 📷");
    }

    public string TimeText { get; }
    public string TitleText { get; }
    public string UrlText { get; }
    public string DwellText { get; }
    public string CategoryText { get; }
    public string MetaText { get; }
}

/// <summary>Строка таблицы графиков работы филиалов.</summary>
public sealed class DlpScheduleItemViewModel : ObservableObject
{
    private bool _deleteArmed;

    public DlpScheduleItemViewModel(string branchName, HubDlpWorkSchedule? row)
    {
        BranchName = branchName;
        HasSchedule = row is not null;
        var work = $"{DlpFormat.MinToHm(row?.WorkStartMin ?? 9 * 60)}–{DlpFormat.MinToHm(row?.WorkEndMin ?? 18 * 60)}";
        WorkText = row is null ? $"{work} (по умолчанию)" : work;
        LunchText = row?.LunchStartMin is int lunchStart && row.LunchEndMin is int lunchEnd
            ? $"{DlpFormat.MinToHm(lunchStart)}–{DlpFormat.MinToHm(lunchEnd)}"
            : "без обеда";
        OffsetText = row is null ? "+0 мин" : $"+{row.TzOffsetMinutes} мин";
        DaysText = DlpFormat.Workdays(row?.WorkdaysMask ?? 31);
        UpdatedText = row is null || string.IsNullOrWhiteSpace(row.UpdatedAt)
            ? string.Empty
            : $"обновлён {row.UpdatedAt} · {row.UpdatedBy}";
        Row = row;
    }

    public string BranchName { get; }
    public HubDlpWorkSchedule? Row { get; }
    public bool HasSchedule { get; }
    public string WorkText { get; }
    public string LunchText { get; }
    public string OffsetText { get; }
    public string DaysText { get; }
    public string UpdatedText { get; }

    /// <summary>Armed-удаление: первое нажатие спрашивает, второе шлёт DELETE.</summary>
    public string DeleteText => _deleteArmed ? "Сбросить?" : "Сбросить";

    public bool ArmDelete()
    {
        if (_deleteArmed)
        {
            return true;
        }

        _deleteArmed = true;
        OnPropertyChanged(nameof(DeleteText));
        return false;
    }

    public void DisarmDelete()
    {
        if (_deleteArmed)
        {
            _deleteArmed = false;
            OnPropertyChanged(nameof(DeleteText));
        }
    }
}

/// <summary>
/// Черновик редактора графика: интервалы текстом «HH:MM», дни — чекбоксами.
/// Значения по умолчанию — как в веб-форме (09:00–18:00, обед 13:00–13:45, маска 31).
/// </summary>
public sealed class DlpScheduleEditorViewModel : ObservableObject
{
    private string _workStartText;
    private string _workEndText;
    private bool _lunchEnabled;
    private string _lunchStartText;
    private string _lunchEndText;
    private string _offsetText;
    private bool _mon, _tue, _wed, _thu, _fri, _sat, _sun;

    public DlpScheduleEditorViewModel(string branchName, HubDlpWorkSchedule? row)
    {
        BranchName = branchName;
        IsNew = row is null;
        _workStartText = DlpFormat.MinToHm(row?.WorkStartMin ?? 9 * 60);
        _workEndText = DlpFormat.MinToHm(row?.WorkEndMin ?? 18 * 60);
        _lunchEnabled = row?.LunchStartMin is not null && row.LunchEndMin is not null;
        _lunchStartText = DlpFormat.MinToHm(row?.LunchStartMin ?? 13 * 60);
        _lunchEndText = DlpFormat.MinToHm(row?.LunchEndMin ?? 13 * 60 + 45);
        _offsetText = (row?.TzOffsetMinutes ?? 0).ToString(CultureInfo.InvariantCulture);
        var mask = row?.WorkdaysMask ?? 31;
        _mon = (mask & 1) != 0;
        _tue = (mask & 2) != 0;
        _wed = (mask & 4) != 0;
        _thu = (mask & 8) != 0;
        _fri = (mask & 16) != 0;
        _sat = (mask & 32) != 0;
        _sun = (mask & 64) != 0;
        Title = row is null ? $"Новый график: {branchName}" : $"График: {branchName}";
    }

    public string BranchName { get; }
    public string Title { get; }
    public bool IsNew { get; }

    public string WorkStartText { get => _workStartText; set => SetProperty(ref _workStartText, value); }
    public string WorkEndText { get => _workEndText; set => SetProperty(ref _workEndText, value); }
    public bool LunchEnabled { get => _lunchEnabled; set => SetProperty(ref _lunchEnabled, value); }
    public string LunchStartText { get => _lunchStartText; set => SetProperty(ref _lunchStartText, value); }
    public string LunchEndText { get => _lunchEndText; set => SetProperty(ref _lunchEndText, value); }
    public string OffsetText { get => _offsetText; set => SetProperty(ref _offsetText, value); }
    public bool Mon { get => _mon; set => SetProperty(ref _mon, value); }
    public bool Tue { get => _tue; set => SetProperty(ref _tue, value); }
    public bool Wed { get => _wed; set => SetProperty(ref _wed, value); }
    public bool Thu { get => _thu; set => SetProperty(ref _thu, value); }
    public bool Fri { get => _fri; set => SetProperty(ref _fri, value); }
    public bool Sat { get => _sat; set => SetProperty(ref _sat, value); }
    public bool Sun { get => _sun; set => SetProperty(ref _sun, value); }

    public int WorkdaysMask =>
        (Mon ? 1 : 0) | (Tue ? 2 : 0) | (Wed ? 4 : 0) | (Thu ? 8 : 0)
        | (Fri ? 16 : 0) | (Sat ? 32 : 0) | (Sun ? 64 : 0);

    /// <summary>Валидация черновика; error — человекочитаемая причина.</summary>
    public bool TryBuildPayload(
        out int workStartMin,
        out int workEndMin,
        out int? lunchStartMin,
        out int? lunchEndMin,
        out int tzOffsetMinutes,
        out int workdaysMask,
        out string? error)
    {
        workStartMin = workEndMin = 0;
        lunchStartMin = lunchEndMin = null;
        tzOffsetMinutes = 0;
        workdaysMask = WorkdaysMask;
        error = null;

        var start = DlpFormat.ParseHm(WorkStartText);
        var end = DlpFormat.ParseHm(WorkEndText);
        if (start is null || end is null)
        {
            error = "Рабочее время укажите в формате ЧЧ:ММ (например 09:00–18:00).";
            return false;
        }

        if (end <= start)
        {
            error = "Конец рабочего дня должен быть позже начала.";
            return false;
        }

        int? lunchStart = null;
        int? lunchEnd = null;
        if (LunchEnabled)
        {
            lunchStart = DlpFormat.ParseHm(LunchStartText);
            lunchEnd = DlpFormat.ParseHm(LunchEndText);
            if (lunchStart is null || lunchEnd is null)
            {
                error = "Обед укажите в формате ЧЧ:ММ (например 13:00–13:45).";
                return false;
            }

            if (lunchEnd <= lunchStart)
            {
                error = "Конец обеда должен быть позже начала.";
                return false;
            }
        }

        if (!int.TryParse(
                OffsetText.Trim(),
                NumberStyles.Integer,
                CultureInfo.InvariantCulture,
                out var offset)
            || offset is < -720 or > 720)
        {
            error = "Смещение — целое число минут (например 0 или -120).";
            return false;
        }

        if (workdaysMask == 0)
        {
            error = "Отметьте хотя бы один рабочий день.";
            return false;
        }

        workStartMin = start.Value;
        workEndMin = end.Value;
        lunchStartMin = lunchStart;
        lunchEndMin = lunchEnd;
        tzOffsetMinutes = offset;
        return true;
    }
}

/// <summary>
/// Страница «🛡 DLP» — нативный аналог веб-маршрута /dlp (admin-only).
/// Сводка за день + «требует внимания» слева от списка ПК, справа — активность
/// выбранного хоста (5-минутная шкала, топ приложений) и вкладки
/// Файлы/Telegram/MAX/Браузер. Отдельный режим «Графики работ» — CRUD по
/// /inventory/dlp/work-schedules. Просмотр медиа-скриншотов недоступен:
/// Image-контролу нужен авторизованный запрос, поэтому панели read-only.
/// </summary>
public sealed class DlpViewModel : ObservableObject
{
    private readonly IHubApiClient _api;
    private CancellationTokenSource? _detailLoadCancellation;
    private CancellationTokenSource? _probeLoadCancellation;
    private CancellationTokenSource? _attentionLoadCancellation;

    private IReadOnlyList<DlpHostItemViewModel> _allHosts = [];
    private IReadOnlyList<HubDlpAttentionHost> _attentionRows = [];

    private DlpHostItemViewModel? _selectedHost;
    private string _searchText = string.Empty;
    private bool _activeOnly;
    private string _selectedBranch = "Все филиалы";
    private bool _isLoading;
    private string? _bannerErrorText;
    private string _totalText = string.Empty;
    private string _lastUpdatedText = string.Empty;
    private string _summaryText = string.Empty;
    private bool _isSchedulesView;
    private DateTime? _overviewDate = DateTime.Today;
    private bool _isAttentionLoading;
    private string _kpiActiveText = "0";
    private string _kpiActiveSecText = "0 сек";
    private string _kpiAwaySecText = "0 сек";
    private string _kpiEntertainmentSecText = "0 сек";
    private string _kpiUsbText = "0";
    private string _kpiMessengerText = "0";
    private bool _isDetailLoading;
    private string? _detailErrorText;
    private bool _hasDetail;
    private DateTime? _detailDate = DateTime.Today;
    private string _detailTitle = string.Empty;
    private string _detailSubtitle = string.Empty;
    private string _detailShiftText = string.Empty;
    private string _detailLunchText = string.Empty;
    private string _detActiveText = string.Empty;
    private string _detPassiveText = string.Empty;
    private string _detAwayText = string.Empty;
    private string _detLockedText = string.Empty;
    private string _detBreakText = string.Empty;
    private string _detOffshiftText = string.Empty;
    private string _detActiveOffshiftText = string.Empty;
    private string _detPctText = string.Empty;
    private string _detailDayText = string.Empty;
    private string _selectedDetailTab = "files";
    private bool _isProbeLoading;
    private string? _probeErrorText;
    private string _probeEmptyText = string.Empty;
    private string _noiseHiddenText = string.Empty;
    private string _browserTotalText = string.Empty;
    private bool _isSchedulesLoading;
    private string? _scheduleNoticeText;
    private string _scheduleNoticeTone = "info";
    private DlpScheduleEditorViewModel? _editingSchedule;
    private bool _isScheduleSaving;

    public DlpViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        SelectHostCommand = new NativeRelayCommand(
            parameter => SelectHostByName(parameter as string));
        ShowMonitoringCommand = new NativeRelayCommand(() => IsSchedulesView = false);
        ShowSchedulesCommand = new NativeRelayCommand(
            () => IsSchedulesView = true);
        EditScheduleCommand = new NativeRelayCommand(
            parameter => BeginScheduleEdit(parameter as DlpScheduleItemViewModel));
        NewScheduleCommand = new NativeRelayCommand(
            parameter => BeginScheduleEdit(parameter as string));
        CancelScheduleEditCommand = new NativeRelayCommand(() => EditingSchedule = null);
        SaveScheduleCommand = new NativeAsyncCommand(
            (_, ct) => SaveScheduleAsync(ct),
            ex => SetScheduleNotice(TasksViewModel.DescribeError(ex), "error"),
            _ => EditingSchedule is not null && !_isScheduleSaving);
        DeleteScheduleCommand = new NativeAsyncCommand(
            (parameter, ct) => DeleteScheduleAsync(parameter as DlpScheduleItemViewModel, ct),
            ex => SetScheduleNotice(TasksViewModel.DescribeError(ex), "error"));
        AttentionGroups = [];
        Hosts.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));
    }

    // ---- Команды ----

    public ICommand RefreshCommand { get; }
    public ICommand DismissBannerCommand { get; }
    /// <summary>Открыть хост по имени (клик по строке «требует внимания»).</summary>
    public ICommand SelectHostCommand { get; }
    public ICommand ShowMonitoringCommand { get; }
    public ICommand ShowSchedulesCommand { get; }
    public ICommand EditScheduleCommand { get; }
    public ICommand NewScheduleCommand { get; }
    public ICommand CancelScheduleEditCommand { get; }
    public ICommand SaveScheduleCommand { get; }
    public ICommand DeleteScheduleCommand { get; }

    // ---- Баннер / статус ----

    public string? BannerErrorText
    {
        get => _bannerErrorText;
        private set
        {
            if (SetProperty(ref _bannerErrorText, value))
            {
                OnPropertyChanged(nameof(HasBannerError));
            }
        }
    }

    public bool HasBannerError => BannerErrorText is not null;

    public bool IsLoading
    {
        get => _isLoading;
        private set
        {
            if (SetProperty(ref _isLoading, value))
            {
                OnPropertyChanged(nameof(IsEmpty));
            }
        }
    }

    /// <summary>Пустое состояние списка при завершённой загрузке без ошибки.</summary>
    public bool IsEmpty => !IsLoading && Hosts.Count == 0 && !HasBannerError;

    public string TotalText
    {
        get => _totalText;
        private set => SetProperty(ref _totalText, value);
    }

    public string LastUpdatedText
    {
        get => _lastUpdatedText;
        private set => SetProperty(ref _lastUpdatedText, value);
    }

    // ---- Сводка дня (dlp/summary) ----

    public string SummaryText
    {
        get => _summaryText;
        private set
        {
            if (SetProperty(ref _summaryText, value))
            {
                OnPropertyChanged(nameof(HasSummary));
            }
        }
    }

    public bool HasSummary => !string.IsNullOrEmpty(SummaryText);

    // ---- Режим страницы: мониторинг | графики работ ----

    public bool IsSchedulesView
    {
        get => _isSchedulesView;
        set
        {
            if (SetProperty(ref _isSchedulesView, value))
            {
                OnPropertyChanged(nameof(IsMonitoringView));
            }
        }
    }

    public bool IsMonitoringView => !IsSchedulesView;

    // ---- Сводка за день / «требует внимания» (dlp/attention) ----

    /// <summary>Дата сводки — DatePicker; смена дня перезагружает attention.</summary>
    public DateTime? OverviewDate
    {
        get => _overviewDate;
        set
        {
            if (SetProperty(ref _overviewDate, value))
            {
                _ = LoadAttentionSafelyAsync();
            }
        }
    }

    public bool IsAttentionLoading
    {
        get => _isAttentionLoading;
        private set => SetProperty(ref _isAttentionLoading, value);
    }

    public ObservableCollection<DlpAttentionGroupViewModel> AttentionGroups { get; }
    public string KpiActiveText { get => _kpiActiveText; private set => SetProperty(ref _kpiActiveText, value); }
    public string KpiActiveSecText { get => _kpiActiveSecText; private set => SetProperty(ref _kpiActiveSecText, value); }
    public string KpiAwaySecText { get => _kpiAwaySecText; private set => SetProperty(ref _kpiAwaySecText, value); }
    public string KpiEntertainmentSecText { get => _kpiEntertainmentSecText; private set => SetProperty(ref _kpiEntertainmentSecText, value); }
    public string KpiUsbText { get => _kpiUsbText; private set => SetProperty(ref _kpiUsbText, value); }
    public string KpiMessengerText { get => _kpiMessengerText; private set => SetProperty(ref _kpiMessengerText, value); }

    // ---- Список ПК ----

    public ObservableCollection<DlpHostItemViewModel> Hosts { get; } = [];
    public ObservableCollection<string> BranchOptions { get; } = ["Все филиалы"];

    public string SearchText
    {
        get => _searchText;
        set
        {
            if (SetProperty(ref _searchText, value))
            {
                ApplyHostFilter();
            }
        }
    }

    public bool ActiveOnly
    {
        get => _activeOnly;
        set
        {
            if (SetProperty(ref _activeOnly, value))
            {
                ApplyHostFilter();
            }
        }
    }

    public string SelectedBranch
    {
        get => _selectedBranch;
        set
        {
            if (SetProperty(ref _selectedBranch, value))
            {
                ApplyHostFilter();
            }
        }
    }

    public DlpHostItemViewModel? SelectedHost
    {
        get => _selectedHost;
        set
        {
            if (SetProperty(ref _selectedHost, value))
            {
                foreach (var item in _allHosts)
                {
                    item.IsSelected = ReferenceEquals(item, value);
                }

                if (value is not null)
                {
                    _ = LoadDetailSafelyAsync(value);
                }
            }
        }
    }

    // ---- Деталь хоста ----

    public bool HasDetail
    {
        get => _hasDetail;
        private set
        {
            if (SetProperty(ref _hasDetail, value))
            {
                OnPropertyChanged(nameof(ShowDetailPlaceholder));
            }
        }
    }

    /// <summary>Заглушка «выберите ПК» — ни данных, ни загрузки.</summary>
    public bool ShowDetailPlaceholder => !HasDetail && !IsDetailLoading;

    public bool IsDetailLoading
    {
        get => _isDetailLoading;
        private set
        {
            if (SetProperty(ref _isDetailLoading, value))
            {
                OnPropertyChanged(nameof(ShowDetailPlaceholder));
            }
        }
    }

    public string? DetailErrorText
    {
        get => _detailErrorText;
        private set
        {
            if (SetProperty(ref _detailErrorText, value))
            {
                OnPropertyChanged(nameof(HasDetailError));
            }
        }
    }

    public bool HasDetailError => DetailErrorText is not null;

    /// <summary>Дата детали — локальная дата филиала; смена перезагружает activity.</summary>
    public DateTime? DetailDate
    {
        get => _detailDate;
        set
        {
            if (SetProperty(ref _detailDate, value) && SelectedHost is not null)
            {
                _ = LoadDetailSafelyAsync(SelectedHost);
            }
        }
    }

    public string DetailTitle { get => _detailTitle; private set => SetProperty(ref _detailTitle, value); }
    public string DetailSubtitle { get => _detailSubtitle; private set => SetProperty(ref _detailSubtitle, value); }
    public string DetailShiftText { get => _detailShiftText; private set => SetProperty(ref _detailShiftText, value); }
    public string DetailLunchText { get => _detailLunchText; private set => SetProperty(ref _detailLunchText, value); }
    public string DetailDayText { get => _detailDayText; private set => SetProperty(ref _detailDayText, value); }
    public string DetActiveText { get => _detActiveText; private set => SetProperty(ref _detActiveText, value); }
    public string DetPassiveText { get => _detPassiveText; private set => SetProperty(ref _detPassiveText, value); }
    public string DetAwayText { get => _detAwayText; private set => SetProperty(ref _detAwayText, value); }
    public string DetLockedText { get => _detLockedText; private set => SetProperty(ref _detLockedText, value); }
    public string DetBreakText { get => _detBreakText; private set => SetProperty(ref _detBreakText, value); }
    public string DetOffshiftText { get => _detOffshiftText; private set => SetProperty(ref _detOffshiftText, value); }
    public string DetActiveOffshiftText { get => _detActiveOffshiftText; private set => SetProperty(ref _detActiveOffshiftText, value); }
    public string DetPctText { get => _detPctText; private set => SetProperty(ref _detPctText, value); }

    public ObservableCollection<DlpBucketCellViewModel> Buckets { get; } = [];
    public ObservableCollection<DlpRunViewModel> Runs { get; } = [];
    public ObservableCollection<DlpAppChipViewModel> TopApps { get; } = [];
    public bool HasTopApps => TopApps.Count > 0;

    // ---- Вкладки детали: files | telegram | max | browser ----

    public bool IsFilesTab
    {
        get => _selectedDetailTab == "files";
        set => SelectDetailTab(value ? "files" : null);
    }

    public bool IsTelegramTab
    {
        get => _selectedDetailTab == "telegram";
        set => SelectDetailTab(value ? "telegram" : null);
    }

    public bool IsMaxTab
    {
        get => _selectedDetailTab == "max";
        set => SelectDetailTab(value ? "max" : null);
    }

    public bool IsBrowserTab
    {
        get => _selectedDetailTab == "browser";
        set => SelectDetailTab(value ? "browser" : null);
    }

    public bool IsProbeLoading
    {
        get => _isProbeLoading;
        private set => SetProperty(ref _isProbeLoading, value);
    }

    public string? ProbeErrorText
    {
        get => _probeErrorText;
        private set
        {
            if (SetProperty(ref _probeErrorText, value))
            {
                OnPropertyChanged(nameof(HasProbeError));
            }
        }
    }

    public bool HasProbeError => ProbeErrorText is not null;

    public string ProbeEmptyText
    {
        get => _probeEmptyText;
        private set => SetProperty(ref _probeEmptyText, value);
    }

    public string NoiseHiddenText
    {
        get => _noiseHiddenText;
        private set => SetProperty(ref _noiseHiddenText, value);
    }

    public string BrowserTotalText
    {
        get => _browserTotalText;
        private set => SetProperty(ref _browserTotalText, value);
    }

    public ObservableCollection<DlpFileEventViewModel> FileEvents { get; } = [];
    public ObservableCollection<DlpChatViewModel> Chats { get; } = [];
    public ObservableCollection<DlpVisitViewModel> BrowserVisits { get; } = [];

    // ---- Графики работ ----

    public ObservableCollection<DlpScheduleItemViewModel> Schedules { get; } = [];

    public bool IsSchedulesLoading
    {
        get => _isSchedulesLoading;
        private set => SetProperty(ref _isSchedulesLoading, value);
    }

    public string? ScheduleNoticeText
    {
        get => _scheduleNoticeText;
        private set
        {
            if (SetProperty(ref _scheduleNoticeText, value))
            {
                OnPropertyChanged(nameof(HasScheduleNotice));
            }
        }
    }

    public string ScheduleNoticeTone
    {
        get => _scheduleNoticeTone;
        private set => SetProperty(ref _scheduleNoticeTone, value);
    }

    public bool HasScheduleNotice => ScheduleNoticeText is not null;
    public bool IsScheduleNoticeError => ScheduleNoticeTone == "error";

    public DlpScheduleEditorViewModel? EditingSchedule
    {
        get => _editingSchedule;
        private set
        {
            if (SetProperty(ref _editingSchedule, value))
            {
                OnPropertyChanged(nameof(IsEditingSchedule));
                ((NativeAsyncCommand)SaveScheduleCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public bool IsEditingSchedule => EditingSchedule is not null;

    // ---- Загрузка ----

    /// <summary>
    /// Первичная загрузка: hosts + summary + attention + schedules последовательно.
    /// Блоки изолированы: 403/503 одного источника не гасит остальные панели.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken)
    {
        IsLoading = true;
        BannerErrorText = null;
        try
        {
            var hosts = await _api.ListDlpHostsAsync(null, cancellationToken);
            _allHosts = (hosts.Hosts ?? Array.Empty<HubDlpHost>())
                .Where(row => !string.IsNullOrWhiteSpace(row.ComputerName))
                .Select(row => new DlpHostItemViewModel(row))
                .ToList();
            ApplyHostFilter();
            RebuildBranchOptions();
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }

        try
        {
            var summary = await _api.GetDlpSummaryAsync(cancellationToken);
            var s = summary.Summary;
            SummaryText = s is null
                ? string.Empty
                : $"ПК: {s.HostsTotal} · активны сегодня: {s.HostsActiveToday}"
                    + $" · визиты: {s.VisitsToday} · файловые события: {s.FileEventsToday}";
        }
        catch (Exception)
        {
            // Сводка — вспомогательный блок: ошибка уже есть в баннере от hosts либо
            // источник просто недоступен; страница живёт без неё.
        }

        try
        {
            await LoadAttentionAsync(cancellationToken);
        }
        catch (Exception exception)
        {
            BannerErrorText ??= TasksViewModel.DescribeError(exception);
        }

        try
        {
            await LoadSchedulesAsync(cancellationToken);
        }
        catch (Exception exception)
        {
            SetScheduleNotice(TasksViewModel.DescribeError(exception), "error");
        }
        finally
        {
            IsLoading = false;
        }

        LastUpdatedText = "Обновлено " + DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture);
    }

    /// <summary>Сводка за день + группы «требует внимания» (ошибки → баннер).</summary>
    private async Task LoadAttentionAsync(CancellationToken cancellationToken)
    {
        IsAttentionLoading = true;
        try
        {
            var day = OverviewDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? string.Empty;
            var response = await _api.GetDlpAttentionAsync(day, cancellationToken);
            _attentionRows = response.Hosts ?? Array.Empty<HubDlpAttentionHost>();
            RebuildAttention();
        }
        finally
        {
            IsAttentionLoading = false;
        }
    }

    private async Task LoadAttentionSafelyAsync()
    {
        _attentionLoadCancellation?.Cancel();
        var cancellation = _attentionLoadCancellation = new CancellationTokenSource();
        try
        {
            await LoadAttentionAsync(cancellation.Token);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            BannerErrorText ??= TasksViewModel.DescribeError(exception);
        }
    }

    /// <summary>KPI-строка + 4 ranked-списка из attention-строк.</summary>
    private void RebuildAttention()
    {
        var rows = _attentionRows;
        KpiActiveText = rows.Count(row => row.ActiveSec > 0).ToString(CultureInfo.InvariantCulture);
        KpiActiveSecText = DlpFormat.Duration(rows.Sum(row => row.ActiveSec));
        KpiAwaySecText = DlpFormat.Duration(rows.Sum(row => row.AwaySec));
        KpiEntertainmentSecText = DlpFormat.Duration(rows.Sum(row => row.EntertainmentSec));
        var usbFiles = rows.Sum(row => row.UsbFiles);
        KpiUsbText = $"{usbFiles} · {DlpFormat.Bytes(rows.Sum(row => row.UsbBytes))}";
        KpiMessengerText = rows.Sum(row => row.MessengerFiles).ToString(CultureInfo.InvariantCulture);

        AttentionGroups.Clear();
        AttentionGroups.Add(new DlpAttentionGroupViewModel(
            "Развлечения",
            rows.Where(row => row.EntertainmentSec > 0)
                .OrderByDescending(row => row.EntertainmentSec)
                .Take(5)
                .Select(row => new DlpAttentionRowViewModel(row, DlpFormat.Duration(row.EntertainmentSec)))));
        AttentionGroups.Add(new DlpAttentionGroupViewModel(
            "Простой",
            rows.Where(row => row.AwaySec + row.BrowserIdleSec > 0)
                .OrderByDescending(row => row.AwaySec + row.BrowserIdleSec)
                .Take(5)
                .Select(row => new DlpAttentionRowViewModel(
                    row, DlpFormat.Duration(row.AwaySec + row.BrowserIdleSec)))));
        AttentionGroups.Add(new DlpAttentionGroupViewModel(
            "USB",
            rows.Where(row => row.UsbFiles > 0)
                .OrderByDescending(row => row.UsbFiles)
                .Take(5)
                .Select(row => new DlpAttentionRowViewModel(
                    row, $"{row.UsbFiles} файлов · {DlpFormat.Bytes(row.UsbBytes)}"))));
        AttentionGroups.Add(new DlpAttentionGroupViewModel(
            "Мессенджеры",
            rows.Where(row => row.MessengerFiles > 0)
                .OrderByDescending(row => row.MessengerFiles)
                .Take(5)
                .Select(row => new DlpAttentionRowViewModel(
                    row, $"{row.MessengerFiles} файлов"))));
        OnPropertyChanged(nameof(AttentionGroups));
    }

    /// <summary>Локальный фильтр списка ПК: поиск + филиал + «только активные».</summary>
    private void ApplyHostFilter()
    {
        var query = SearchText.Trim();
        var branch = SelectedBranch;
        var filtered = _allHosts.Where(item =>
            (branch == "Все филиалы" || item.BranchName == branch)
            && (!ActiveOnly
                || _attentionRows.Any(row =>
                    string.Equals(row.ComputerName, item.ComputerName, StringComparison.OrdinalIgnoreCase)
                    && row.ActiveSec > 0))
            && (query.Length == 0
                || item.ComputerName.Contains(query, StringComparison.OrdinalIgnoreCase)
                || item.UserText.Contains(query, StringComparison.OrdinalIgnoreCase)
                || item.BranchName.Contains(query, StringComparison.OrdinalIgnoreCase)))
            .ToList();

        Hosts.Clear();
        foreach (var item in filtered)
        {
            Hosts.Add(item);
        }

        TotalText = filtered.Count == _allHosts.Count
            ? $"ПК: {_allHosts.Count}"
            : $"ПК: {filtered.Count} из {_allHosts.Count}";
    }

    /// <summary>Филиалы из списка ПК — варианты фильтра.</summary>
    private void RebuildBranchOptions()
    {
        var current = SelectedBranch;
        BranchOptions.Clear();
        BranchOptions.Add("Все филиалы");
        foreach (var name in _allHosts
                     .Select(item => item.BranchName)
                     .Where(name => !string.IsNullOrWhiteSpace(name))
                     .Distinct(StringComparer.OrdinalIgnoreCase)
                     .OrderBy(name => name, StringComparer.OrdinalIgnoreCase))
        {
            BranchOptions.Add(name);
        }

        if (!BranchOptions.Contains(current))
        {
            SelectedBranch = "Все филиалы";
        }
    }

    /// <summary>Клик по строке «требует внимания» — выбрать хост в списке.</summary>
    private void SelectHostByName(string? computerName)
    {
        if (string.IsNullOrWhiteSpace(computerName))
        {
            return;
        }

        // Снимаем фильтры, иначе строка может быть скрыта.
        _searchText = string.Empty;
        OnPropertyChanged(nameof(SearchText));
        _selectedBranch = "Все филиалы";
        OnPropertyChanged(nameof(SelectedBranch));
        _activeOnly = false;
        OnPropertyChanged(nameof(ActiveOnly));
        ApplyHostFilter();

        SelectedHost = Hosts.FirstOrDefault(item =>
            string.Equals(item.ComputerName, computerName.Trim(), StringComparison.OrdinalIgnoreCase));
    }

    // ---- Деталь хоста ----

    private async Task LoadDetailSafelyAsync(DlpHostItemViewModel host)
    {
        _detailLoadCancellation?.Cancel();
        var cancellation = _detailLoadCancellation = new CancellationTokenSource();
        IsDetailLoading = true;
        DetailErrorText = null;
        try
        {
            var day = DetailDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            var data = await _api.GetDlpActivityAsync(host.ComputerName, day, cancellation.Token);
            ApplyDetail(host, data);
            HasDetail = true;
            await LoadProbeSafelyAsync(cancellation.Token);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            DetailErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            if (cancellation == _detailLoadCancellation)
            {
                IsDetailLoading = false;
            }
        }
    }

    /// <summary>Шапка детали + сводка + шкала + лента + топ приложений.</summary>
    private void ApplyDetail(DlpHostItemViewModel host, HubDlpActivityResponse data)
    {
        DetailTitle = host.ComputerName;
        var local = data.LocalTime;
        var branch = local?.BranchName ?? host.BranchName;
        var offset = local?.UtcOffsetMinutes ?? 300;
        var offsetText = $"UTC{offset / 60:+#;-#;0}:{Math.Abs(offset % 60):D2}";
        DetailSubtitle = string.Join(
            " · ",
            new[] { host.UserText, branch, offsetText }
                .Where(part => !string.IsNullOrWhiteSpace(part)));
        DetailDayText = "День (локальное время филиала): "
            + (local?.Day ?? DetailDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "—");
        DetailShiftText = local?.WorkStartMin is int shiftStart && local.WorkEndMin is int shiftEnd
            ? $"Смена {DlpFormat.MinToHm(shiftStart)}–{DlpFormat.MinToHm(shiftEnd)}"
            : "Смена не задана";
        DetailLunchText = local?.LunchStartMin is int lunchStart && local.LunchEndMin is int lunchEnd
            ? $"Обед {DlpFormat.MinToHm(lunchStart)}–{DlpFormat.MinToHm(lunchEnd)}"
            : "Обеда нет";

        var summary = data.Summary;
        DetActiveText = DlpFormat.Duration(summary?.ActiveSec);
        DetPassiveText = DlpFormat.Duration(summary?.PassiveSec);
        DetAwayText = DlpFormat.Duration(summary?.AwaySec);
        DetLockedText = DlpFormat.Duration(summary?.LockedSec);
        DetBreakText = DlpFormat.Duration(summary?.BreakSec);
        DetOffshiftText = DlpFormat.Duration(summary?.OffshiftSec);
        DetActiveOffshiftText = summary is { ActiveOffshiftSec: > 0 }
            ? $"Ввод вне смены: {DlpFormat.Duration(summary.ActiveOffshiftSec)}"
            : string.Empty;
        DetPctText = summary?.ActivityPct is double pct
            ? $"Активность {pct:0.#}%"
            : string.Empty;

        RebuildTimeline(data.Buckets ?? Array.Empty<HubDlpActivityBucket>());

        TopApps.Clear();
        foreach (var app in data.AppsTop ?? Array.Empty<HubDlpAppTop>())
        {
            TopApps.Add(new DlpAppChipViewModel(app));
        }

        OnPropertyChanged(nameof(HasTopApps));
    }

    /// <summary>
    /// 288 ячеек по 5 минут на локальные сутки филиала + серии одинаковых
    /// состояний (лента). Пустые ячейки — «нет данных».
    /// </summary>
    private void RebuildTimeline(IReadOnlyList<HubDlpActivityBucket> buckets)
    {
        Buckets.Clear();
        Runs.Clear();

        var cells = Enumerable.Range(0, 288)
            .Select(minute => DlpBucketCellViewModel.Empty(minute * 5))
            .ToList();
        foreach (var bucket in buckets)
        {
            var cell = DlpBucketCellViewModel.FromBucket(bucket);
            if (cell.MinuteOfDay is >= 0 and < 24 * 60)
            {
                cells[cell.MinuteOfDay / 5] = cell;
            }
        }

        foreach (var cell in cells)
        {
            Buckets.Add(cell);
        }

        // Серии: склеиваем подряд идущие ячейки с одинаковой меткой+приложением.
        DlpBucketCellViewModel? runStart = null;
        var runSeconds = 0.0;
        for (var i = 0; i <= cells.Count; i++)
        {
            var cell = i < cells.Count ? cells[i] : null;
            var same = cell is not null
                && runStart is not null
                && cell.StateLabel == runStart.StateLabel
                && SameApp(cell, runStart);
            if (same)
            {
                runSeconds += 300;
                continue;
            }

            if (runStart is not null && runStart.StateLabel != "нет данных")
            {
                Runs.Add(new DlpRunViewModel(
                    $"{runStart.TimeText}–{cells[i - 1].TimeText}",
                    runStart.StateLabel,
                    runStart.TooltipText.Split(", ").Length > 1
                        ? runStart.TooltipText.Split(", ").Last()
                        : null,
                    runSeconds));
            }

            runStart = cell is null || cell.StateLabel == "нет данных" ? null : cell;
            runSeconds = 300;
        }
    }

    private static bool SameApp(DlpBucketCellViewModel a, DlpBucketCellViewModel b)
    {
        static string? App(DlpBucketCellViewModel cell)
        {
            var parts = cell.TooltipText.Split(", ");
            return parts.Length > 1 ? parts[^1] : null;
        }

        return App(a) == App(b);
    }

    // ---- Вкладки пробы ----

    private void SelectDetailTab(string? tab)
    {
        if (tab is null || _selectedDetailTab == tab)
        {
            return;
        }

        _selectedDetailTab = tab;
        OnPropertyChanged(nameof(IsFilesTab));
        OnPropertyChanged(nameof(IsTelegramTab));
        OnPropertyChanged(nameof(IsMaxTab));
        OnPropertyChanged(nameof(IsBrowserTab));
        _ = LoadProbeSafelyAsync(CancellationToken.None);
    }

    /// <summary>Ленивая загрузка активной вкладки выбранного хоста.</summary>
    private async Task LoadProbeSafelyAsync(CancellationToken cancellationToken)
    {
        var host = SelectedHost;
        if (host is null)
        {
            return;
        }

        _probeLoadCancellation?.Cancel();
        var cancellation = _probeLoadCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        IsProbeLoading = true;
        ProbeErrorText = null;
        try
        {
            switch (_selectedDetailTab)
            {
                case "files":
                    var files = await _api.ListFsEgressEventsAsync(
                        host.ComputerName, null, 500, cancellation.Token);
                    FileEvents.Clear();
                    foreach (var row in files.Items ?? Array.Empty<HubFsEgressEvent>())
                    {
                        FileEvents.Add(new DlpFileEventViewModel(row));
                    }

                    NoiseHiddenText = files.NoiseHidden > 0
                        ? $"Скрыто служебных: {files.NoiseHidden}"
                        : string.Empty;
                    ProbeEmptyText = FileEvents.Count == 0 ? "Файловых событий нет." : string.Empty;
                    break;
                case "telegram":
                    var tg = await _api.ListTelegramChatsAsync(
                        host.ComputerName, 200, cancellation.Token);
                    FillChats(tg.Chats, "Диалогов Telegram нет.");
                    break;
                case "max":
                    var max = await _api.ListMaxChatsAsync(
                        host.ComputerName, 200, cancellation.Token);
                    FillChats(max.Chats, "Диалогов MAX нет.");
                    break;
                case "browser":
                    var day = DetailDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                    var visits = await _api.ListBrowserVisitsAsync(
                        host.ComputerName, day, 200, cancellation.Token);
                    BrowserVisits.Clear();
                    foreach (var row in visits.Items ?? Array.Empty<HubBrowserVisit>())
                    {
                        BrowserVisits.Add(new DlpVisitViewModel(row));
                    }

                    BrowserTotalText = $"Визитов: {visits.Total}";
                    ProbeEmptyText = BrowserVisits.Count == 0 ? "Визитов за день нет." : string.Empty;
                    break;
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            ProbeErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            if (cancellation == _probeLoadCancellation)
            {
                IsProbeLoading = false;
            }
        }
    }

    private void FillChats(IReadOnlyList<HubDlpChat>? chats, string emptyText)
    {
        Chats.Clear();
        foreach (var chat in chats ?? Array.Empty<HubDlpChat>())
        {
            Chats.Add(new DlpChatViewModel(chat));
        }

        ProbeEmptyText = Chats.Count == 0 ? emptyText : string.Empty;
    }

    // ---- Графики работ ----

    private async Task LoadSchedulesAsync(CancellationToken cancellationToken)
    {
        IsSchedulesLoading = true;
        try
        {
            var response = await _api.ListDlpWorkSchedulesAsync(cancellationToken);
            var byBranch = (response.Items ?? Array.Empty<HubDlpWorkSchedule>())
                .Where(row => !string.IsNullOrWhiteSpace(row.BranchName))
                .ToDictionary(row => row.BranchName!.Trim(), StringComparer.OrdinalIgnoreCase);
            var branches = (response.Branches ?? Array.Empty<string>())
                .Concat(byBranch.Keys)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                .ToList();

            Schedules.Clear();
            foreach (var name in branches)
            {
                byBranch.TryGetValue(name, out var row);
                Schedules.Add(new DlpScheduleItemViewModel(name, row));
            }
        }
        finally
        {
            IsSchedulesLoading = false;
        }
    }

    /// <summary>«Изменить» по строке или «Задать график» для филиала без строки.</summary>
    private void BeginScheduleEdit(DlpScheduleItemViewModel? item)
    {
        if (item is null)
        {
            return;
        }

        EditingSchedule = new DlpScheduleEditorViewModel(item.BranchName, item.Row);
        ScheduleNoticeText = null;
    }

    private void BeginScheduleEdit(string? branchName)
    {
        if (string.IsNullOrWhiteSpace(branchName))
        {
            return;
        }

        EditingSchedule = new DlpScheduleEditorViewModel(branchName.Trim(), null);
        ScheduleNoticeText = null;
    }

    private async Task SaveScheduleAsync(CancellationToken cancellationToken)
    {
        var draft = EditingSchedule;
        if (draft is null)
        {
            return;
        }

        if (!draft.TryBuildPayload(
                out var workStart,
                out var workEnd,
                out var lunchStart,
                out var lunchEnd,
                out var offset,
                out var mask,
                out var error))
        {
            SetScheduleNotice(error!, "error");
            return;
        }

        _isScheduleSaving = true;
        ((NativeAsyncCommand)SaveScheduleCommand).RaiseCanExecuteChanged();
        try
        {
            await _api.SaveDlpWorkScheduleAsync(
                draft.BranchName, workStart, workEnd, lunchStart, lunchEnd, offset, mask,
                cancellationToken);
            EditingSchedule = null;
            SetScheduleNotice($"График «{draft.BranchName}» сохранён.", "success");
            await LoadSchedulesAsync(cancellationToken);
        }
        finally
        {
            _isScheduleSaving = false;
            ((NativeAsyncCommand)SaveScheduleCommand).RaiseCanExecuteChanged();
        }
    }

    /// <summary>DELETE {branch} — второе нажатие armed-кнопки; первое только взводит.</summary>
    private async Task DeleteScheduleAsync(DlpScheduleItemViewModel? item, CancellationToken cancellationToken)
    {
        if (item is null)
        {
            return;
        }

        if (!item.HasSchedule)
        {
            SetScheduleNotice($"Для «{item.BranchName}» график не задан.", "info");
            return;
        }

        if (!item.ArmDelete())
        {
            return;
        }

        await _api.DeleteDlpWorkScheduleAsync(item.BranchName, cancellationToken);
        SetScheduleNotice($"График «{item.BranchName}» сброшен — филиал без переклассификации.", "success");
        await LoadSchedulesAsync(cancellationToken);
    }

    private void SetScheduleNotice(string? text, string tone)
    {
        ScheduleNoticeText = text;
        ScheduleNoticeTone = tone;
    }

    /// <summary>Ошибка загрузки, выставленная шеллом при инициализации страниц.</summary>
    public void SetLoadError(string message)
    {
        BannerErrorText = message;
        IsLoading = false;
    }

    /// <summary>Сброс содержимого при выходе из сессии.</summary>
    public void Reset()
    {
        _detailLoadCancellation?.Cancel();
        _probeLoadCancellation?.Cancel();
        _attentionLoadCancellation?.Cancel();
        _detailLoadCancellation = null;
        _probeLoadCancellation = null;
        _attentionLoadCancellation = null;
        _allHosts = [];
        _attentionRows = [];
        Hosts.Clear();
        AttentionGroups.Clear();
        Buckets.Clear();
        Runs.Clear();
        TopApps.Clear();
        FileEvents.Clear();
        Chats.Clear();
        BrowserVisits.Clear();
        Schedules.Clear();
        SelectedHost = null;
        HasDetail = false;
        BannerErrorText = null;
        DetailErrorText = null;
        ProbeErrorText = null;
        ScheduleNoticeText = null;
        EditingSchedule = null;
        _searchText = string.Empty;
        OnPropertyChanged(nameof(SearchText));
        _selectedBranch = "Все филиалы";
        OnPropertyChanged(nameof(SelectedBranch));
        _activeOnly = false;
        OnPropertyChanged(nameof(ActiveOnly));
        _overviewDate = DateTime.Today;
        OnPropertyChanged(nameof(OverviewDate));
        _detailDate = DateTime.Today;
        OnPropertyChanged(nameof(DetailDate));
        _selectedDetailTab = "files";
        OnPropertyChanged(nameof(IsFilesTab));
        OnPropertyChanged(nameof(IsTelegramTab));
        OnPropertyChanged(nameof(IsMaxTab));
        OnPropertyChanged(nameof(IsBrowserTab));
        TotalText = string.Empty;
        SummaryText = string.Empty;
        LastUpdatedText = string.Empty;
        DetailTitle = string.Empty;
        DetailSubtitle = string.Empty;
        DetailShiftText = string.Empty;
        DetailLunchText = string.Empty;
        DetailDayText = string.Empty;
        DetActiveOffshiftText = string.Empty;
        DetPctText = string.Empty;
        ProbeEmptyText = string.Empty;
        NoiseHiddenText = string.Empty;
        BrowserTotalText = string.Empty;
        IsSchedulesView = false;
        IsLoading = false;
        IsDetailLoading = false;
        IsAttentionLoading = false;
        IsSchedulesLoading = false;
        IsProbeLoading = false;
    }
}

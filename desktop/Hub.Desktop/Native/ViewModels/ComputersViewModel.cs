using System.Collections.ObjectModel;
using System.Globalization;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Локализация статусов компьютера — подписи веб-страницы Computers.jsx /
/// mobile-hub (COMPUTER_STATUS_OPTIONS). Значение null — «все статусы».
/// </summary>
internal static class ComputerCatalog
{
    public static string StatusLabel(string? status) => status switch
    {
        "online" => "В сети",
        "stale" => "Давно не было",
        "offline" => "Не в сети",
        _ => "Неизвестно",
    };

    /// <summary>Тон чипа статуса: success — зелёный, warning — жёлтый, error — красный.</summary>
    public static string StatusTone(string? status) => status switch
    {
        "online" => "success",
        "stale" => "warning",
        "offline" => "error",
        _ => "muted",
    };

    public static string OutlookStatusLabel(string? status) => status switch
    {
        "ok" => "В норме",
        "warning" => "Внимание",
        "critical" => "Критично",
        _ => "—",
    };

    /// <summary>formatComputerAge из mobile-hub: «только что»/«N мин назад»/«N ч назад»/«N дн назад».</summary>
    public static string FormatAge(long? seconds)
    {
        if (seconds is null or < 0)
        {
            return "давность неизвестна";
        }

        return seconds.Value switch
        {
            < 60 => "только что",
            < 3600 => $"{seconds.Value / 60} мин назад",
            < 86_400 => $"{seconds.Value / 3600} ч назад",
            _ => $"{seconds.Value / 86_400} дн назад",
        };
    }

    /// <summary>formatComputerTimestamp из mobile-hub: epoch-секунды → «дд.мм.гг чч:мм».</summary>
    public static string FormatTimestamp(long? epochSeconds)
    {
        if (epochSeconds is null or <= 0)
        {
            return "Нет данных";
        }

        var local = DateTimeOffset.FromUnixTimeSeconds(epochSeconds.Value).ToLocalTime();
        return local.ToString("dd.MM.yy HH:mm", CultureInfo.InvariantCulture);
    }

    /// <summary>formatComputerUptime из mobile-hub: «N дн N ч» или «N ч».</summary>
    public static string FormatUptime(long? seconds)
    {
        if (seconds is null or < 0)
        {
            return "Нет данных";
        }

        var days = seconds.Value / 86_400;
        var hours = seconds.Value % 86_400 / 3600;
        return days > 0 ? $"{days} дн {hours} ч" : $"{hours} ч";
    }

    /// <summary>formatComputerBytes из mobile-hub: Б/КБ/МБ/ГБ/ТБ.</summary>
    public static string FormatBytes(long? bytes)
    {
        if (bytes is null or < 0)
        {
            return "Нет данных";
        }

        if (bytes.Value < 1024)
        {
            return $"{bytes.Value} Б";
        }

        string[] units = ["КБ", "МБ", "ГБ", "ТБ"];
        var amount = bytes.Value / 1024.0;
        var index = 0;
        while (amount >= 1024 && index < units.Length - 1)
        {
            amount /= 1024;
            index++;
        }

        return amount >= 10
            ? $"{amount:0} {units[index]}"
            : $"{amount:0.#} {units[index]}";
    }
}

/// <summary>
/// Строка списка компьютеров: имя, статус, давность, сотрудник, филиал/место,
/// IP/MAC и бейджи (изменения, диски, «не назначен») — как карточка выдачи
/// веб-Computers и mobile NativeComputerCard.
/// </summary>
public sealed class ComputerItemViewModel
{
    public ComputerItemViewModel(HubComputer computer)
    {
        ArgumentNullException.ThrowIfNull(computer);
        MacAddress = computer.MacAddress?.Trim() ?? string.Empty;
        Title = !string.IsNullOrWhiteSpace(computer.Hostname)
            ? computer.Hostname!.Trim()
            : MacAddress.Length > 0 ? MacAddress : "Неизвестный ПК";
        StatusText = ComputerCatalog.StatusLabel(computer.Status);
        StatusTone = ComputerCatalog.StatusTone(computer.Status);
        AgeText = ComputerCatalog.FormatAge(computer.AgeSeconds);
        UserText = !string.IsNullOrWhiteSpace(computer.UserFullName)
            ? computer.UserFullName!.Trim()
            : !string.IsNullOrWhiteSpace(computer.UserLogin)
                ? computer.UserLogin!.Trim()
                : !string.IsNullOrWhiteSpace(computer.CurrentUser)
                    ? computer.CurrentUser!.Trim()
                    : string.Empty;
        PlaceText = string.Join(
            " · ",
            new[] { computer.BranchName, computer.LocationName }
                .Where(part => !string.IsNullOrWhiteSpace(part))
                .Select(part => part!.Trim())
                .Distinct());
        IpText = string.IsNullOrWhiteSpace(computer.IpPrimary) ? string.Empty : computer.IpPrimary!.Trim();
        IsUnassigned = computer.IsUnassigned;
        HasHardwareChanges = computer.HasHardwareChanges;
        ChangesCount30d = computer.ChangesCount30d;
        DiskWarningCount = CountDiskWarnings(computer);
    }

    /// <summary>MAC — ключ запроса детали (GET /inventory/computers/{mac}).</summary>
    public string MacAddress { get; }
    public string Title { get; }
    public string StatusText { get; }
    public string StatusTone { get; }
    public string AgeText { get; }
    public string UserText { get; }
    public string PlaceText { get; }
    public string IpText { get; }
    public bool IsUnassigned { get; }
    public bool HasHardwareChanges { get; }
    public int ChangesCount30d { get; }
    public int DiskWarningCount { get; }

    public bool HasUser => UserText.Length > 0;
    public bool HasPlace => PlaceText.Length > 0;
    public bool HasIp => IpText.Length > 0;
    public bool HasMac => MacAddress.Length > 0;
    public bool HasChangesBadge => HasHardwareChanges || ChangesCount30d > 0;
    public string ChangesBadgeText => HasHardwareChanges ? "Изменения" : $"Изм. {ChangesCount30d}";
    public bool HasDiskBadge => DiskWarningCount > 0;
    public string DiskBadgeText => $"{DiskWarningCount} диск.";

    /// <summary>
    /// computerDiskWarningCount из mobile-hub: диск «подозрительный», если
    /// health_status не в ok/healthy/good/unknown или свободно &lt; 10% объёма.
    /// </summary>
    private static int CountDiskWarnings(HubComputer computer)
    {
        var count = 0;
        foreach (var disk in EnumerateDisks(computer))
        {
            var status = disk.HealthStatus?.Trim().ToLowerInvariant() ?? string.Empty;
            var badHealth = status.Length > 0
                && status is not ("ok" or "healthy" or "good" or "unknown");
            var lowSpace = disk is { FreeGb: not null, TotalGb: > 0 }
                && disk.FreeGb.Value / disk.TotalGb.Value < 0.1;
            if (badHealth || lowSpace)
            {
                count++;
            }
        }

        return count;
    }

    private static IEnumerable<HubComputerDisk> EnumerateDisks(HubComputer computer)
    {
        foreach (var disk in computer.LogicalDisks ?? [])
        {
            yield return disk;
        }

        foreach (var disk in computer.Storage ?? [])
        {
            yield return disk;
        }
    }
}

/// <summary>Строка диска/тома в карточке: имя, точка, свободно/всего, состояние.</summary>
public sealed class ComputerDiskItemViewModel
{
    public ComputerDiskItemViewModel(HubComputerDisk disk)
    {
        ArgumentNullException.ThrowIfNull(disk);
        Title = !string.IsNullOrWhiteSpace(disk.DisplayName)
            ? disk.DisplayName!.Trim()
            : !string.IsNullOrWhiteSpace(disk.Name)
                ? disk.Name!.Trim()
                : !string.IsNullOrWhiteSpace(disk.Mountpoint)
                    ? disk.Mountpoint!.Trim()
                    : "Диск";
        var capacity = disk is { FreeGb: not null, TotalGb: not null }
            ? $"свободно {disk.FreeGb.Value:0.#} из {disk.TotalGb.Value:0.#} ГБ"
            : disk.TotalGb is not null
                ? $"{disk.TotalGb.Value:0.#} ГБ"
                : disk.SizeGb is not null
                    ? $"{disk.SizeGb.Value:0.#} ГБ"
                    : string.Empty;
        SubtitleText = string.Join(
            " · ",
            new[] { disk.Mountpoint, disk.Device, disk.MediaType, capacity }
                .Where(part => !string.IsNullOrWhiteSpace(part))
                .Select(part => part!.Trim()));
        var status = disk.HealthStatus?.Trim().ToLowerInvariant() ?? string.Empty;
        var badHealth = status.Length > 0
            && status is not ("ok" or "healthy" or "good" or "unknown");
        var lowSpace = disk is { FreeGb: not null, TotalGb: > 0 }
            && disk.FreeGb.Value / disk.TotalGb.Value < 0.1;
        IsWarning = badHealth || lowSpace;
        HealthText = string.IsNullOrWhiteSpace(disk.HealthStatus) ? string.Empty : disk.HealthStatus!.Trim();
    }

    public string Title { get; }
    public string SubtitleText { get; }
    public bool IsWarning { get; }
    public string HealthText { get; }
    public bool HasHealth => HealthText.Length > 0;
}

/// <summary>Строка сетевого интерфейса в карточке: имя, линк, скорость, IPv4.</summary>
public sealed class ComputerNetworkItemViewModel
{
    public ComputerNetworkItemViewModel(HubComputerNetworkDevice device)
    {
        ArgumentNullException.ThrowIfNull(device);
        Title = string.IsNullOrWhiteSpace(device.Name) ? "Интерфейс" : device.Name!.Trim();
        Ipv4Text = string.Join(", ", device.Ipv4 ?? []);
        MetaText = string.Join(
            " · ",
            new[] { device.ConnectionStatus, device.LinkSpeed }
                .Where(part => !string.IsNullOrWhiteSpace(part))
                .Select(part => part!.Trim()));
    }

    public string Title { get; }
    public string Ipv4Text { get; }
    public string MetaText { get; }
    public bool HasIpv4 => Ipv4Text.Length > 0;
    public bool HasMeta => MetaText.Length > 0;
}

/// <summary>
/// Карточка компьютера: секции пользователь/место, железо и нагрузка, сеть,
/// диски и Outlook — набор полей mobile-карточки (bounded mobile_safe-проекция).
/// </summary>
public sealed class ComputerDetailViewModel
{
    public ComputerDetailViewModel(HubComputer computer)
    {
        ArgumentNullException.ThrowIfNull(computer);
        MacAddress = computer.MacAddress?.Trim() ?? string.Empty;
        Title = !string.IsNullOrWhiteSpace(computer.Hostname)
            ? computer.Hostname!.Trim()
            : MacAddress.Length > 0 ? MacAddress : "Компьютер";
        StatusText = ComputerCatalog.StatusLabel(computer.Status);
        StatusTone = ComputerCatalog.StatusTone(computer.Status);
        HeroMetaText = string.Join(
            " · ",
            new[]
            {
                string.IsNullOrWhiteSpace(computer.IpPrimary) ? null : computer.IpPrimary!.Trim(),
                MacAddress.Length > 0 ? MacAddress : null,
            }.Where(part => !string.IsNullOrWhiteSpace(part)));

        // ---- Пользователь и место ----
        UserText = OrDash(FirstNonEmpty(computer.UserFullName, computer.UserLogin, computer.CurrentUser));
        LastSeenText = ComputerCatalog.FormatTimestamp(computer.LastSeenAt);
        AgeText = ComputerCatalog.FormatAge(computer.AgeSeconds);
        BranchText = OrDash(computer.BranchName);
        LocationText = OrDash(computer.LocationName);
        DatabaseText = OrDash(computer.DatabaseName);
        InventoryText = OrDash(computer.InventoryInvNo);
        InventoryModelText = OrDash(computer.InventoryModelName);
        IsUnassigned = computer.IsUnassigned;
        AssignmentText = computer.IsUnassigned ? "Пользователь не назначен" : string.Empty;

        // ---- Железо и нагрузка (метрики агента) ----
        CpuText = OrDash(computer.CpuModel);
        RamText = computer.RamGb is null ? "—" : $"{computer.RamGb.Value:0.#} ГБ";
        CpuLoadText = computer.CpuLoadPercent is null ? "—" : $"{computer.CpuLoadPercent.Value:0.#}%";
        RamUsedText = computer.RamUsedPercent is null ? "—" : $"{computer.RamUsedPercent.Value:0.#}%";
        UptimeText = ComputerCatalog.FormatUptime(computer.UptimeSeconds);
        LastRebootText = ComputerCatalog.FormatTimestamp(computer.LastRebootAt);
        SystemSerialText = OrDash(computer.SystemSerial);

        // ---- Сеть ----
        IpPrimaryText = OrDash(computer.IpPrimary);
        IpListText = computer.IpList is { Count: > 0 } ips
            ? string.Join(", ", ips)
            : "—";
        foreach (var device in computer.Network?.Devices ?? [])
        {
            NetworkDevices.Add(new ComputerNetworkItemViewModel(device));
        }

        // ---- Диски (logical_disks + storage, как в mobile-карточке) ----
        foreach (var disk in computer.LogicalDisks ?? [])
        {
            Disks.Add(new ComputerDiskItemViewModel(disk));
        }

        foreach (var disk in computer.Storage ?? [])
        {
            Disks.Add(new ComputerDiskItemViewModel(disk));
        }

        DiskWarningCount = Disks.Count(disk => disk.IsWarning);

        // ---- Outlook и изменения ----
        OutlookStatusText = ComputerCatalog.OutlookStatusLabel(computer.OutlookStatus);
        OutlookSizeText = computer.OutlookTotalSizeBytes is null
            ? "—"
            : ComputerCatalog.FormatBytes(computer.OutlookTotalSizeBytes.Value);
        OutlookArchivesText = computer.OutlookArchivesCount is null
            ? "—"
            : computer.OutlookArchivesCount.Value.ToString(CultureInfo.InvariantCulture);
        ChangesCountText = computer.ChangesCount30d.ToString(CultureInfo.InvariantCulture);
        HasHardwareChanges = computer.HasHardwareChanges;
    }

    public string MacAddress { get; }
    public string Title { get; }
    public string StatusText { get; }
    public string StatusTone { get; }
    public string HeroMetaText { get; }
    public string UserText { get; }
    public string LastSeenText { get; }
    public string AgeText { get; }
    public string BranchText { get; }
    public string LocationText { get; }
    public string DatabaseText { get; }
    public string InventoryText { get; }
    public string InventoryModelText { get; }
    public bool IsUnassigned { get; }
    public string AssignmentText { get; }
    public bool HasAssignmentText => AssignmentText.Length > 0;
    public string CpuText { get; }
    public string RamText { get; }
    public string CpuLoadText { get; }
    public string RamUsedText { get; }
    public string UptimeText { get; }
    public string LastRebootText { get; }
    public string SystemSerialText { get; }
    public string IpPrimaryText { get; }
    public string IpListText { get; }
    public ObservableCollection<ComputerNetworkItemViewModel> NetworkDevices { get; } = [];
    public bool HasNetworkDevices => NetworkDevices.Count > 0;
    public ObservableCollection<ComputerDiskItemViewModel> Disks { get; } = [];
    public bool HasDisks => Disks.Count > 0;
    public int DiskWarningCount { get; }
    public string OutlookStatusText { get; }
    public string OutlookSizeText { get; }
    public string OutlookArchivesText { get; }
    public string ChangesCountText { get; }
    public bool HasHardwareChanges { get; }

    private static string? FirstNonEmpty(params string?[] values)
        => values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim();

    private static string OrDash(string? value)
        => string.IsNullOrWhiteSpace(value) ? "—" : value.Trim();
}

/// <summary>Опция фильтра статуса компьютера (Value=null — «все статусы»).</summary>
public sealed class ComputerStatusFilterItem
{
    public ComputerStatusFilterItem(string? value, string label)
    {
        Value = value;
        Label = label;
    }

    public string? Value { get; }
    public string Label { get; }
}

/// <summary>
/// Страница «💻 Компьютеры»: серверный поиск компьютеров агента с фильтрами
/// (статус, изменения, ВМ 172.*, scope все базы при computers.read_all),
/// offset-пагинацией «Показать ещё» и карточкой по MAC — как веб-Computers.jsx.
/// Только чтение: скрытие хостов, VNC и запись в срез не входят.
/// </summary>
public sealed class ComputersViewModel : ObservableObject
{
    /// <summary>Порция выдачи — как COMPUTERS_PAGE_SIZE в вебе (limit=50).</summary>
    private const int PageSize = 50;

    /// <summary>Debounce строки поиска — SEARCH_DEBOUNCE_MS в вебе.</summary>
    private static readonly TimeSpan SearchDebounce = TimeSpan.FromMilliseconds(500);

    /// <summary>Поиск короче двух символов на сервер не уходит (SEARCH_MIN_QUERY_LEN).</summary>
    private const int MinSearchLength = 2;

    /// <summary>search_fields mobile-клиента — полный набор полей поиска.</summary>
    private const string SearchFields = "identity,user,profiles,outlook,network,location,database";

    /// <summary>Право чтения всех баз — scope=all (как в вебе/мобайле).</summary>
    private const string ReadAllPermission = "computers.read_all";

    /// <summary>«Все статусы» — первый пункт меню фильтра (status= не шлём).</summary>
    internal static readonly ComputerStatusFilterItem AllStatuses = new(null, "Все");

    private readonly IHubApiClient _api;
    private CancellationTokenSource? _detailLoadCancellation;
    private CancellationTokenSource? _searchCancellation;
    private CancellationTokenSource? _listCancellation;

    /// <summary>Заглушка событий фильтров на время Reset (без лишних перезагрузок).</summary>
    private bool _suppressFilterEvents;

    /// <summary>computers.read_all из /auth/me: определяет видимость scope-переключателя.</summary>
    private bool _canReadAll;
    private bool _permissionsLoaded;

    /// <summary>Offset следующей порции (next_offset ответа; fallback — items.Count).</summary>
    private int _nextOffset;

    private ComputerItemViewModel? _selectedItem;
    private ComputerDetailViewModel? _detail;
    private bool _isDetailLoading;
    private string? _detailErrorText;
    private string _searchText = string.Empty;
    private ComputerStatusFilterItem _selectedStatusFilter = AllStatuses;
    private bool _allDatabases;
    private bool _changedOnly;
    private bool _hideVm172 = true;
    private bool _isLoading;
    private bool _isLoadingMore;
    private bool _hasMore;
    private int _total;
    private string? _bannerErrorText;
    private string _totalText = string.Empty;
    private string _lastUpdatedText = string.Empty;

    public ComputersViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        LoadMoreCommand = new NativeAsyncCommand(
            (_, ct) => LoadMoreAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasMore && !IsLoading && !IsLoadingMore);
        SelectStatusFilterCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is ComputerStatusFilterItem option)
            {
                SelectedStatusFilter = option;
            }
        });
        ClearFiltersCommand = new NativeRelayCommand(ClearFilters);
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        Items.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(IsEmpty));
            OnPropertyChanged(nameof(MoreButtonText));
        };
    }

    // ---- Список и фильтры ----

    public ObservableCollection<ComputerItemViewModel> Items { get; } = [];

    public ComputerItemViewModel? SelectedItem
    {
        get => _selectedItem;
        set
        {
            if (SetProperty(ref _selectedItem, value) && value is { MacAddress.Length: > 0 })
            {
                _ = LoadDetailSafelyAsync(value.MacAddress);
            }
        }
    }

    public ComputerDetailViewModel? Detail
    {
        get => _detail;
        private set
        {
            if (SetProperty(ref _detail, value))
            {
                OnPropertyChanged(nameof(HasDetail));
                OnPropertyChanged(nameof(ShowDetailPlaceholder));
            }
        }
    }

    public bool HasDetail => Detail is not null;

    /// <summary>Заглушка «выберите компьютер» — ни карточки, ни загрузки деталей.</summary>
    public bool ShowDetailPlaceholder => Detail is null && !IsDetailLoading;

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

    public bool HasDetailError => !string.IsNullOrEmpty(DetailErrorText);

    /// <summary>Поиск q: ввод стартует debounce-перезагрузку серверного поиска.</summary>
    public string SearchText
    {
        get => _searchText;
        set
        {
            if (SetProperty(ref _searchText, value ?? string.Empty))
            {
                ScheduleSearch();
            }
        }
    }

    /// <summary>Опции фильтра status= — COMPUTER_STATUS_OPTIONS без «Неизвестно».</summary>
    public ObservableCollection<ComputerStatusFilterItem> StatusFilterOptions { get; } =
    [
        AllStatuses,
        new("online", "В сети"),
        new("stale", "Давно не было"),
        new("offline", "Не в сети"),
    ];

    /// <summary>Фильтр status= («Все» — без параметра): смена перечитывает список.</summary>
    public ComputerStatusFilterItem SelectedStatusFilter
    {
        get => _selectedStatusFilter;
        set
        {
            if (SetProperty(ref _selectedStatusFilter, value ?? AllStatuses))
            {
                OnPropertyChanged(nameof(SelectedStatusFilterText));
                OnPropertyChanged(nameof(HasActiveFilters));
                ReloadFromFilterChange();
            }
        }
    }

    /// <summary>Подпись кнопки-меню статуса («Статус: В сети ▾»).</summary>
    public string SelectedStatusFilterText => _selectedStatusFilter.Label;

    /// <summary>Переключатель scope=all — виден только при computers.read_all.</summary>
    public bool AllDatabases
    {
        get => _allDatabases;
        set
        {
            if (SetProperty(ref _allDatabases, value))
            {
                OnPropertyChanged(nameof(HasActiveFilters));
                ReloadFromFilterChange();
            }
        }
    }

    /// <summary>changed_only=true — только хосты с изменениями железа за 30 дней.</summary>
    public bool ChangedOnly
    {
        get => _changedOnly;
        set
        {
            if (SetProperty(ref _changedOnly, value))
            {
                OnPropertyChanged(nameof(HasActiveFilters));
                ReloadFromFilterChange();
            }
        }
    }

    /// <summary>
    /// hide_vm_172=true — отсекать ВМ из 172.16.0.0/12; включён по умолчанию,
    /// как в вебе (localStorage !== '0') и мобайле (default true).
    /// </summary>
    public bool HideVm172
    {
        get => _hideVm172;
        set
        {
            if (SetProperty(ref _hideVm172, value))
            {
                ReloadFromFilterChange();
            }
        }
    }

    /// <summary>Scope-переключатель «Все базы» показываем только с правом computers.read_all.</summary>
    public bool ShowScopeFilter => _canReadAll;

    /// <summary>Есть активные фильтры — показывать «Сбросить».</summary>
    public bool HasActiveFilters
        => _selectedStatusFilter.Value is not null
            || _allDatabases
            || _changedOnly
            || !string.IsNullOrWhiteSpace(_searchText);

    public bool IsLoading
    {
        get => _isLoading;
        private set
        {
            if (SetProperty(ref _isLoading, value))
            {
                OnPropertyChanged(nameof(IsEmpty));
                ((NativeAsyncCommand)LoadMoreCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public bool IsLoadingMore
    {
        get => _isLoadingMore;
        private set
        {
            if (SetProperty(ref _isLoadingMore, value))
            {
                OnPropertyChanged(nameof(MoreButtonText));
                ((NativeAsyncCommand)LoadMoreCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>На сервере остались строки выдачи (has_more/next_offset).</summary>
    public bool HasMore
    {
        get => _hasMore;
        private set
        {
            if (SetProperty(ref _hasMore, value))
            {
                OnPropertyChanged(nameof(MoreButtonText));
                ((NativeAsyncCommand)LoadMoreCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Подпись «Показать ещё» с остатком серверной выдачи.</summary>
    public string MoreButtonText => IsLoadingMore
        ? "Загружаем…"
        : _total > Items.Count
            ? $"Показать ещё ({_total - Items.Count})"
            : "Показать ещё";

    public string? BannerErrorText
    {
        get => _bannerErrorText;
        private set
        {
            if (SetProperty(ref _bannerErrorText, value))
            {
                OnPropertyChanged(nameof(HasBannerError));
                OnPropertyChanged(nameof(IsEmpty));
            }
        }
    }

    public bool HasBannerError => !string.IsNullOrEmpty(BannerErrorText);

    public bool IsEmpty => !IsLoading && Items.Count == 0 && !HasBannerError;

    /// <summary>Подпись счётчика серверной выдачи: «120 компьютеров».</summary>
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

    public ICommand RefreshCommand { get; }
    public ICommand LoadMoreCommand { get; }
    public ICommand SelectStatusFilterCommand { get; }
    public ICommand ClearFiltersCommand { get; }
    public ICommand DismissBannerCommand { get; }

    /// <summary>Шов ожидания (debounce поиска): тесты ставят мгновенный.</summary>
    public Func<TimeSpan, CancellationToken, Task> DelayAsync { get; set; } = Task.Delay;

    /// <summary>Текущий scope запросов: all — только при праве computers.read_all.</summary>
    private string CurrentScope => _allDatabases && _canReadAll ? "all" : "selected";

    /// <summary>Нормализация ввода — как normalizeComputersSearchInput в вебе.</summary>
    private static string NormalizeQuery(string value)
        => string.Join(' ', (value ?? string.Empty)
            .Replace('\r', ' ')
            .Replace('\n', ' ')
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));

    /// <summary>Первичная загрузка/обновление первой страницы с текущими фильтрами.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        await EnsurePermissionsAsync(cancellationToken);
        await LoadPageAsync(append: false, cancellationToken);
    }

    /// <summary>
    /// Право computers.read_all узнаём один раз из /auth/me (как canReadAll
    /// в мобайле). Ошибка /me не блокирует список — просто без scope-фильтра.
    /// </summary>
    private async Task EnsurePermissionsAsync(CancellationToken cancellationToken)
    {
        if (_permissionsLoaded)
        {
            return;
        }

        _permissionsLoaded = true;
        try
        {
            var user = await _api.GetCurrentUserAsync(cancellationToken);
            _canReadAll = user.Permissions?.Contains(ReadAllPermission) == true;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            _canReadAll = false;
        }

        OnPropertyChanged(nameof(ShowScopeFilter));
        if (!_canReadAll && _allDatabases)
        {
            _allDatabases = false;
            OnPropertyChanged(nameof(AllDatabases));
            OnPropertyChanged(nameof(HasActiveFilters));
        }
    }

    private HubComputersQuery BuildQuery(int offset)
        => new()
        {
            Scope = CurrentScope,
            Search = NormalizeQuery(_searchText) is { Length: >= MinSearchLength } query ? query : null,
            SearchFields = SearchFields,
            Status = _selectedStatusFilter.Value,
            ChangedOnly = _changedOnly,
            HideVm172 = _hideVm172,
            SortBy = "hostname",
            SortDir = "asc",
            Limit = PageSize,
            Offset = offset,
        };

    /// <summary>Загрузка страницы: append=false — с начала выдачи, иначе по next_offset.</summary>
    private async Task LoadPageAsync(bool append, CancellationToken cancellationToken)
    {
        _listCancellation?.Cancel();
        _listCancellation?.Dispose();
        var listCancellation = new CancellationTokenSource();
        _listCancellation = listCancellation;
        var linked = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken, listCancellation.Token);
        var offset = append ? _nextOffset : 0;
        if (append)
        {
            IsLoadingMore = true;
        }
        else
        {
            IsLoading = true;
        }

        try
        {
            var page = await _api.SearchComputersAsync(BuildQuery(offset), linked.Token);
            // Ответ устарел: поиск/фильтры уже сменились — не применяем его.
            if (listCancellation.IsCancellationRequested)
            {
                return;
            }

            if (append)
            {
                // Дедуп по ключу mac|hostname — как mergeComputerPage в мобайле.
                var known = new HashSet<string>(
                    Items.Select(item => item.MacAddress.Length > 0 ? item.MacAddress : item.Title),
                    StringComparer.OrdinalIgnoreCase);
                foreach (var computer in page.Items ?? [])
                {
                    var item = new ComputerItemViewModel(computer);
                    var key = item.MacAddress.Length > 0 ? item.MacAddress : item.Title;
                    if (known.Add(key))
                    {
                        Items.Add(item);
                    }
                }
            }
            else
            {
                Items.Clear();
                foreach (var computer in page.Items ?? [])
                {
                    Items.Add(new ComputerItemViewModel(computer));
                }
            }

            _total = Math.Max(page.Total, Items.Count);
            _nextOffset = page.NextOffset
                ?? (page.Offset + (page.Items?.Count ?? 0));
            HasMore = page.HasMore && Items.Count > 0;
            TotalText = FormatCount(_total, "компьютер", "компьютера", "компьютеров");
            LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
            BannerErrorText = null;
        }
        catch (OperationCanceledException) when (listCancellation.IsCancellationRequested)
        {
            // Отменили мы сами (новый поиск/фильтр/страница) — не баннерная ошибка.
        }
        finally
        {
            if (ReferenceEquals(_listCancellation, listCancellation))
            {
                IsLoading = false;
                IsLoadingMore = false;
            }
            else if (!listCancellation.IsCancellationRequested)
            {
                IsLoading = false;
                IsLoadingMore = false;
            }

            linked.Dispose();
        }
    }

    /// <summary>«Показать ещё»: следующая серверная порция по next_offset.</summary>
    private Task LoadMoreAsync(CancellationToken cancellationToken)
        => LoadPageAsync(append: true, cancellationToken);

    /// <summary>Смена фильтра: список и карточка перечитываются с начала выдачи.</summary>
    private void ReloadFromFilterChange()
    {
        if (_suppressFilterEvents)
        {
            return;
        }

        _ = ReloadListSafelyAsync();
    }

    private async Task ReloadListSafelyAsync()
    {
        try
        {
            Detail = null;
            SelectedItem = null;
            await LoadAsync(CancellationToken.None);
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
    }

    /// <summary>Debounce 500 мс: серверный поиск; запросы короче 2 символов игнорируем.</summary>
    private void ScheduleSearch()
    {
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        _searchCancellation = null;
        // Сброс фильтров переписывает строку напрямую — отложенный поиск не нужен.
        if (_suppressFilterEvents)
        {
            return;
        }

        var cancellation = new CancellationTokenSource();
        _searchCancellation = cancellation;
        var query = NormalizeQuery(_searchText);
        // Веб: ввод длиной 1 символ поиска не меняет — остаётся прежняя выдача.
        if (query.Length == 1)
        {
            return;
        }

        _ = SearchSafelyAsync(query, cancellation.Token);
    }

    private async Task SearchSafelyAsync(string query, CancellationToken cancellationToken)
    {
        try
        {
            await DelayAsync(SearchDebounce, cancellationToken);
            // Строка уже сменилась — результат устарел.
            if (!string.Equals(NormalizeQuery(_searchText), query, StringComparison.Ordinal))
            {
                return;
            }

            Detail = null;
            SelectedItem = null;
            await LoadAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
    }

    /// <summary>Сброс фильтров и строки поиска к начальным значениям.</summary>
    private void ClearFilters()
    {
        _suppressFilterEvents = true;
        try
        {
            SearchText = string.Empty;
            SelectedStatusFilter = AllStatuses;
            AllDatabases = false;
            ChangedOnly = false;
        }
        finally
        {
            _suppressFilterEvents = false;
        }

        OnPropertyChanged(nameof(HasActiveFilters));
        ReloadFromFilterChange();
    }

    // ---- Карточка ----

    private async Task LoadDetailSafelyAsync(string macAddress)
    {
        _detailLoadCancellation?.Cancel();
        var cancellation = new CancellationTokenSource();
        _detailLoadCancellation = cancellation;
        IsDetailLoading = true;
        DetailErrorText = null;
        try
        {
            var computer = await _api.GetComputerDetailAsync(
                macAddress, CurrentScope, cancellation.Token);
            // Выбор уже ушёл на другой ПК — устаревший ответ не применяем.
            if (!string.Equals(_selectedItem?.MacAddress, macAddress, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            Detail = new ComputerDetailViewModel(computer);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            if (string.Equals(_selectedItem?.MacAddress, macAddress, StringComparison.OrdinalIgnoreCase))
            {
                DetailErrorText = TasksViewModel.DescribeError(ex);
            }
        }
        finally
        {
            if (ReferenceEquals(_detailLoadCancellation, cancellation))
            {
                IsDetailLoading = false;
            }
        }
    }

    /// <summary>Ошибка загрузки, выставленная шеллом при инициализации страниц.</summary>
    public void SetLoadError(string message)
    {
        BannerErrorText = message;
        IsLoading = false;
        IsLoadingMore = false;
    }

    /// <summary>Сброс содержимого при выходе из сессии.</summary>
    public void Reset()
    {
        _detailLoadCancellation?.Cancel();
        _listCancellation?.Cancel();
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        _searchCancellation = null;
        _suppressFilterEvents = true;
        Items.Clear();
        Detail = null;
        SelectedItem = null;
        BannerErrorText = null;
        DetailErrorText = null;
        _searchText = string.Empty;
        OnPropertyChanged(nameof(SearchText));
        _selectedStatusFilter = AllStatuses;
        OnPropertyChanged(nameof(SelectedStatusFilter));
        OnPropertyChanged(nameof(SelectedStatusFilterText));
        _allDatabases = false;
        OnPropertyChanged(nameof(AllDatabases));
        _changedOnly = false;
        OnPropertyChanged(nameof(ChangedOnly));
        _hideVm172 = true;
        OnPropertyChanged(nameof(HideVm172));
        _canReadAll = false;
        _permissionsLoaded = false;
        OnPropertyChanged(nameof(ShowScopeFilter));
        _suppressFilterEvents = false;
        OnPropertyChanged(nameof(HasActiveFilters));
        _nextOffset = 0;
        _total = 0;
        HasMore = false;
        TotalText = string.Empty;
        LastUpdatedText = string.Empty;
        IsLoading = false;
        IsLoadingMore = false;
        IsDetailLoading = false;
    }

    private static string FormatCount(int count, string one, string few, string many)
    {
        var mod100 = count % 100;
        var mod10 = count % 10;
        var form = mod100 is >= 11 and <= 14
            ? many
            : mod10 == 1
                ? one
                : mod10 is >= 2 and <= 4
                    ? few
                    : many;
        return string.Create(CultureInfo.CurrentCulture, $"{count} {form}");
    }
}

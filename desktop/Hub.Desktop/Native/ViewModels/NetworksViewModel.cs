using System.Collections.ObjectModel;
using System.Globalization;
using System.IO;
using System.Windows.Input;
using Hub.Desktop.Native.Api;
using Process = System.Diagnostics.Process;
using ProcessStartInfo = System.Diagnostics.ProcessStartInfo;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>Подписи device_type раздела «Сети» (значения из веб-диалога устройства).</summary>
internal static class NetworkCatalog
{
    public static string DeviceTypeLabel(string? deviceType) => deviceType switch
    {
        "switch" => "Коммутатор",
        "router" => "Маршрутизатор",
        "firewall" => "Межсетевой экран",
        "ap" => "Точка доступа",
        "other" => "Прочее",
        _ => deviceType ?? string.Empty,
    };

    /// <summary>Подпись city_code — имя города, как в вебе (tmn→Тюмень).</summary>
    public static string CityLabel(string? cityCode) => cityCode?.Trim().ToLowerInvariant() switch
    {
        "tmn" or "tyumen" or "тюмень" => "Тюмень",
        "spb" or "saint-petersburg" or "спб" => "Санкт-Петербург",
        "msk" or "moscow" or "мск" => "Москва",
        "ekb" or "yekaterinburg" or "екб" => "Екатеринбург",
        "nsk" or "novosibirsk" or "новосибирск" => "Новосибирск",
        "nng" or "nizhny-novgorod" or "nnv" => "Нижний Новгород",
        "kaz" or "kazan" or "казань" => "Казань",
        _ => cityCode?.Trim() ?? string.Empty,
    };

    /// <summary>
    /// Однобуквенные сокращения имени площадки из импорта («С.», «F.», «Н.»)
    /// не несут смысла — такие префиксы из подписи убираем.
    /// </summary>
    public static bool IsInformativeSiteName(string? siteName)
    {
        var trimmed = siteName?.Trim().TrimEnd('.');
        return trimmed is { Length: > 1 };
    }
}

/// <summary>Формат размера файла карты — тот же, что у чипов документооборота.</summary>
internal static class NetworkFormat
{
    internal static string FormatSize(long size) => size switch
    {
        <= 0 => string.Empty,
        < 1024 => $"{size} Б",
        < 1024 * 1024 => $"{size / 1024.0:0.#} КБ",
        _ => $"{size / (1024.0 * 1024.0):0.#} МБ",
    };
}

/// <summary>
/// Строка списка филиалов: имя, код и чипы счётчиков — как карточка филиала
/// в веб-BranchList (Уст/Порты/Роз/Карты/Точ + Код сайта).
/// </summary>
public sealed class NetworkBranchItemViewModel
{
    public NetworkBranchItemViewModel(HubNetworkBranch branch)
    {
        ArgumentNullException.ThrowIfNull(branch);
        Id = branch.Id;
        Title = string.IsNullOrWhiteSpace(branch.Name) ? "Филиал" : branch.Name!.Trim();
        CodeText = string.IsNullOrWhiteSpace(branch.BranchCode)
            ? string.Empty
            : branch.BranchCode!.Trim();
        CityCodeText = string.IsNullOrWhiteSpace(branch.CityCode)
            ? string.Empty
            : branch.CityCode!.Trim();
        DevicesChipText = $"Уст: {branch.DevicesCount}";
        PortsChipText = $"Порты: {branch.PortsCount}";
        SocketsChipText = $"Роз: {branch.SocketsCount}";
        MapsChipText = $"Карты: {branch.MapsCount}";
        PointsChipText = $"Точ: {branch.MapPointsCount}";
        SiteCodeText = string.IsNullOrWhiteSpace(branch.DefaultSiteCode)
            ? string.Empty
            : $"Код сайта: {branch.DefaultSiteCode!.Trim()}";
    }

    public long Id { get; }
    public string Title { get; }
    public string CodeText { get; }
    public string CityCodeText { get; }
    public string DevicesChipText { get; }
    public string PortsChipText { get; }
    public string SocketsChipText { get; }
    public string MapsChipText { get; }
    public string PointsChipText { get; }
    public string SiteCodeText { get; }
}

/// <summary>
/// Строка таблицы оборудования филиала: код устройства (ASW), тип,
/// вендор+модель, площадка, управляющий IP и занятость портов.
/// </summary>
public sealed class NetworkDeviceItemViewModel
{
    public NetworkDeviceItemViewModel(HubNetworkDevice device)
    {
        ArgumentNullException.ThrowIfNull(device);
        Id = device.Id;
        DeviceCodeText = string.IsNullOrWhiteSpace(device.DeviceCode) ? "—" : device.DeviceCode!.Trim();
        DeviceTypeText = NetworkCatalog.DeviceTypeLabel(device.DeviceType);
        // Вендор+модель; «Cisco Cisco Catalyst» — когда модель уже ведёт с вендора — не дублируем.
        var model = device.Model?.Trim();
        var vendor = device.Vendor?.Trim();
        ModelText = string.Join(
            " ",
            new[] {
                    string.IsNullOrEmpty(vendor)
                        || (model is not null && model.StartsWith(vendor, StringComparison.OrdinalIgnoreCase))
                        ? null
                        : vendor,
                    model }
                .Where(part => !string.IsNullOrWhiteSpace(part)));
        SiteText = string.Join(
            " · ",
            new[] {
                    NetworkCatalog.IsInformativeSiteName(device.SiteName) ? device.SiteName : null,
                    device.SiteCode }
                .Where(part => !string.IsNullOrWhiteSpace(part))
                .Select(part => part!.Trim())
                .Distinct());
        MgmtIpText = device.MgmtIp?.Trim() ?? string.Empty;
        PortsText = $"{device.OccupiedPorts}/{device.PortsCount}";
        NotesText = device.Notes?.Trim() ?? string.Empty;
    }

    public long Id { get; }
    public string DeviceCodeText { get; }
    public string DeviceTypeText { get; }
    public string ModelText { get; }
    public string SiteText { get; }
    public string MgmtIpText { get; }

    /// <summary>Занято портов / всего портов устройства.</summary>
    public string PortsText { get; }
    public string NotesText { get; }
}

/// <summary>
/// Чип файла-схемы: имя карты/файла, площадка, размер и состояние скачивания
/// (файл и PDF-экспорт — два независимых действия, общий busy-флаг).
/// </summary>
public sealed class NetworkMapItemViewModel : ObservableObject
{
    private bool _isDownloading;

    public NetworkMapItemViewModel(HubNetworkMap map)
    {
        ArgumentNullException.ThrowIfNull(map);
        Id = map.Id;
        FileName = string.IsNullOrWhiteSpace(map.FileName) ? $"map_{map.Id}.bin" : map.FileName!.Trim();
        Title = string.IsNullOrWhiteSpace(map.Title) ? FileName : map.Title!.Trim();
        SubtitleText = string.Join(
            " · ",
            new[] {
                    map.FloorLabel,
                    NetworkCatalog.IsInformativeSiteName(map.SiteName) ? map.SiteName : map.SiteCode }
                .Where(part => !string.IsNullOrWhiteSpace(part))
                .Select(part => part!.Trim())
                .Distinct());
        SizeText = NetworkFormat.FormatSize(map.FileSize);
    }

    public long Id { get; }
    public string FileName { get; }
    public string Title { get; }

    /// <summary>Подзаголовок чипа: этаж и площадка (floor_label + site).</summary>
    public string SubtitleText { get; }
    public string SizeText { get; }

    public bool IsDownloading
    {
        get => _isDownloading;
        set
        {
            if (SetProperty(ref _isDownloading, value))
            {
                OnPropertyChanged(nameof(DisplayText));
                OnPropertyChanged(nameof(IsDownloadEnabled));
            }
        }
    }

    /// <summary>Чип доступен, пока файл не скачивается (дедуп — и в DownloadMapAsync).</summary>
    public bool IsDownloadEnabled => !IsDownloading;

    public string DisplayText => IsDownloading
        ? "Скачиваем…"
        : SizeText.Length == 0 ? Title : $"{Title} ({SizeText})";
}

/// <summary>
/// Карточка филиала: реквизиты branch, чипы metrics, площадки sites[],
/// таблица устройств и чипы файлов-схем. Содержимое devices/maps
/// догружается отдельными запросами после overview.
/// </summary>
public sealed class NetworkBranchDetailViewModel : ObservableObject
{
    public NetworkBranchDetailViewModel(HubNetworkOverview overview)
    {
        ArgumentNullException.ThrowIfNull(overview);
        var branch = overview.Branch;
        var metrics = overview.Metrics;
        Title = string.IsNullOrWhiteSpace(branch?.Name) ? "Филиал" : branch!.Name!.Trim();
        BranchCodeText = string.IsNullOrWhiteSpace(branch?.BranchCode)
            ? string.Empty
            : branch!.BranchCode!.Trim();
        CityCodeText = string.IsNullOrWhiteSpace(branch?.CityCode)
            ? string.Empty
            : $"Город: {NetworkCatalog.CityLabel(branch!.CityCode)}";
        SiteCodeText = string.IsNullOrWhiteSpace(branch?.DefaultSiteCode)
            ? string.Empty
            : $"Код сайта: {branch!.DefaultSiteCode!.Trim()}";
        DbIdText = string.IsNullOrWhiteSpace(branch?.DbId)
            ? string.Empty
            : $"База: {branch!.DbId!.Trim()}";
        DevicesChipText = $"Уст: {metrics?.DevicesCount ?? 0}";
        PortsChipText = $"Порты: {metrics?.PortsCount ?? 0}";
        OccupiedChipText = $"Занято: {metrics?.OccupiedPorts ?? 0}";
        SocketsChipText = $"Розетки: {metrics?.SocketsCount ?? 0}";
        MapsChipText = $"Карты: {metrics?.MapsCount ?? 0}";
        PointsChipText = $"Точки: {metrics?.MapPointsCount ?? 0}";

        foreach (var site in overview.Sites ?? [])
        {
            var siteTitle = string.Join(
                " · ",
                new[] {
                        site.SiteCode,
                        NetworkCatalog.IsInformativeSiteName(site.Name) ? site.Name : null }
                    .Where(part => !string.IsNullOrWhiteSpace(part))
                    .Select(part => part!.Trim())
                    .Distinct());
            Sites.Add($"{siteTitle} — устройств: {site.DevicesCount}, портов: {site.PortsCount}");
        }
    }

    public string Title { get; }
    public string BranchCodeText { get; }
    public string CityCodeText { get; }
    public string SiteCodeText { get; }
    public string DbIdText { get; }
    public string DevicesChipText { get; }
    public string PortsChipText { get; }
    public string OccupiedChipText { get; }
    public string SocketsChipText { get; }
    public string MapsChipText { get; }
    public string PointsChipText { get; }

    /// <summary>Площадки филиала (sites[] из overview) — компактная строка-легенда.</summary>
    public ObservableCollection<string> Sites { get; } = [];
    public bool HasSites => Sites.Count > 0;

    public ObservableCollection<NetworkDeviceItemViewModel> Devices { get; } = [];
    public string DevicesTitleText => $"Оборудование · {Devices.Count}";
    public bool IsDevicesEmpty => Devices.Count == 0;

    public ObservableCollection<NetworkMapItemViewModel> Maps { get; } = [];
    public string MapsTitleText => $"Схемы сети · {Maps.Count}";
    public bool IsMapsEmpty => Maps.Count == 0;

    public void SetDevices(IReadOnlyList<HubNetworkDevice> devices)
    {
        Devices.Clear();
        foreach (var device in devices)
        {
            Devices.Add(new NetworkDeviceItemViewModel(device));
        }

        OnPropertyChanged(nameof(DevicesTitleText));
        OnPropertyChanged(nameof(IsDevicesEmpty));
    }

    public void SetMaps(IReadOnlyList<HubNetworkMap> maps)
    {
        Maps.Clear();
        foreach (var map in maps)
        {
            Maps.Add(new NetworkMapItemViewModel(map));
        }

        OnPropertyChanged(nameof(MapsTitleText));
        OnPropertyChanged(nameof(IsMapsEmpty));
    }
}

/// <summary>
/// Страница «🌐 Сети»: список филиалов слева (клиентский поиск по имени/коду —
/// как в веб-Networks), выбор → карточка с метриками, площадками, таблицей
/// оборудования и чипами файлов-схем. Чип скачивает файл в %TEMP% и открывает
/// его средствами ОС; PDF-экспорт открывается в системном viewer.
/// Только чтение: импорт/редактирование/интерактивная карта в срез не входят.
/// </summary>
public sealed class NetworksViewModel : ObservableObject
{
    /// <summary>Город выборки филиалов — тот же, что у веб-страницы (getBranches('tmn')).</summary>
    internal const string DefaultCity = "tmn";

    private readonly IHubApiClient _api;
    private CancellationTokenSource? _detailLoadCancellation;

    /// <summary>Карты, которые скачиваются прямо сейчас — второй клик не дублирует запрос.</summary>
    private readonly HashSet<string> _mapDownloadsInFlight = new(StringComparer.Ordinal);

    /// <summary>Полная выдача списка филиалов (клиентский поиск фильтрует её).</summary>
    private IReadOnlyList<NetworkBranchItemViewModel> _allBranches = [];

    private NetworkBranchItemViewModel? _selectedBranch;
    private NetworkBranchDetailViewModel? _detail;
    private bool _isDetailLoading;
    private string? _detailErrorText;
    private string _searchText = string.Empty;
    private bool _isLoading;
    private string? _bannerErrorText;
    private string _totalText = string.Empty;
    private string _lastUpdatedText = string.Empty;

    public NetworksViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        OpenMapFileCommand = new NativeAsyncCommand(
            (parameter, _) => DownloadMapAsync(parameter as NetworkMapItemViewModel, exportPdf: false),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is NetworkMapItemViewModel { IsDownloading: false });
        ExportMapPdfCommand = new NativeAsyncCommand(
            (parameter, _) => DownloadMapAsync(parameter as NetworkMapItemViewModel, exportPdf: true),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is NetworkMapItemViewModel { IsDownloading: false });
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        Items.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));
    }

    // ---- Список филиалов ----

    public ObservableCollection<NetworkBranchItemViewModel> Items { get; } = [];

    public NetworkBranchItemViewModel? SelectedBranch
    {
        get => _selectedBranch;
        set
        {
            if (SetProperty(ref _selectedBranch, value) && value is not null)
            {
                _ = LoadDetailSafelyAsync(value.Id);
            }
        }
    }

    public NetworkBranchDetailViewModel? Detail
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

    /// <summary>Заглушка «выберите филиал» — ни карточки, ни загрузки деталей.</summary>
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

    /// <summary>Клиентский поиск по филиалам (name/branch_code/city_code) — как в вебе.</summary>
    public string SearchText
    {
        get => _searchText;
        set
        {
            if (SetProperty(ref _searchText, value ?? string.Empty))
            {
                ApplyBranchFilter();
            }
        }
    }

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

    /// <summary>Подпись счётчика: «3 филиала».</summary>
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
    public ICommand OpenMapFileCommand { get; }
    public ICommand ExportMapPdfCommand { get; }
    public ICommand DismissBannerCommand { get; }

    /// <summary>
    /// Шов сохранения/открытия файла карты (как FileSaver у документооборота):
    /// тесты заменяют потоковое скачивание в %TEMP% + Process.Start.
    /// Аргументы — чип карты и флаг PDF-экспорта (false — исходный файл).
    /// </summary>
    public Func<NetworkMapItemViewModel, bool, Task>? MapFileSaver { get; set; }

    /// <summary>Первичная загрузка/обновление списка филиалов.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        IsLoading = true;
        try
        {
            var list = await _api.GetNetworkBranchesAsync(DefaultCity, cancellationToken);
            _allBranches = (list.Branches ?? [])
                .Select(branch => new NetworkBranchItemViewModel(branch))
                .ToList();
            ApplyBranchFilter();
            TotalText = FormatCount(_allBranches.Count, "филиал", "филиала", "филиалов");
            LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
            BannerErrorText = null;
        }
        finally
        {
            IsLoading = false;
        }
    }

    private void ApplyBranchFilter()
    {
        var query = _searchText.Trim();
        Items.Clear();
        foreach (var branch in _allBranches)
        {
            if (query.Length == 0
                || branch.Title.Contains(query, StringComparison.OrdinalIgnoreCase)
                || branch.CodeText.Contains(query, StringComparison.OrdinalIgnoreCase)
                || branch.CityCodeText.Contains(query, StringComparison.OrdinalIgnoreCase))
            {
                Items.Add(branch);
            }
        }
    }

    // ---- Карточка филиала ----

    private async Task LoadDetailSafelyAsync(long branchId)
    {
        _detailLoadCancellation?.Cancel();
        var cancellation = new CancellationTokenSource();
        _detailLoadCancellation = cancellation;
        IsDetailLoading = true;
        DetailErrorText = null;
        try
        {
            var overview = await _api.GetNetworkBranchOverviewAsync(branchId, cancellation.Token);
            if (_selectedBranch?.Id != branchId)
            {
                return;
            }

            var detail = new NetworkBranchDetailViewModel(overview);
            Detail = detail;

            // Устройства и файлы-схемы — отдельными запросами, как в веб-странице;
            // сбой одного блока не прячет остальные (ошибка — в тексте блока).
            await LoadDevicesSafelyAsync(branchId, detail, cancellation.Token);
            await LoadMapsSafelyAsync(branchId, detail, cancellation.Token);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            // Ошибка устаревшей загрузки не должна перекрывать карточку нового выбора.
            if (_selectedBranch?.Id == branchId)
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

    private async Task LoadDevicesSafelyAsync(
        long branchId,
        NetworkBranchDetailViewModel detail,
        CancellationToken cancellationToken)
    {
        try
        {
            var list = await _api.GetNetworkDevicesAsync(branchId, cancellationToken);
            if (_selectedBranch?.Id == branchId && ReferenceEquals(Detail, detail))
            {
                detail.SetDevices(list.Devices ?? []);
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            if (_selectedBranch?.Id == branchId && ReferenceEquals(Detail, detail))
            {
                DetailErrorText = TasksViewModel.DescribeError(ex);
            }
        }
    }

    private async Task LoadMapsSafelyAsync(
        long branchId,
        NetworkBranchDetailViewModel detail,
        CancellationToken cancellationToken)
    {
        try
        {
            var list = await _api.GetNetworkMapsAsync(branchId, cancellationToken);
            if (_selectedBranch?.Id == branchId && ReferenceEquals(Detail, detail))
            {
                detail.SetMaps(list.Maps ?? []);
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            if (_selectedBranch?.Id == branchId && ReferenceEquals(Detail, detail))
            {
                DetailErrorText = TasksViewModel.DescribeError(ex);
            }
        }
    }

    // ---- Файлы-схемы ----

    /// <summary>
    /// Чип схемы нажат: исходный файл (render=original) или PDF-экспорт качаем
    /// в %TEMP%/hub-desktop/networks и открываем средствами ОС.
    /// </summary>
    private async Task DownloadMapAsync(NetworkMapItemViewModel? item, bool exportPdf)
    {
        if (item is null)
        {
            return;
        }

        var downloadKey = (exportPdf ? "pdf:" : "file:") + item.Id;
        if (!_mapDownloadsInFlight.Add(downloadKey))
        {
            // Уже качается — второй FileStream на том же target дал бы «файл занят».
            return;
        }

        item.IsDownloading = true;
        try
        {
            if (MapFileSaver is not null)
            {
                await MapFileSaver(item, exportPdf);
                return;
            }

            var directory = Path.Combine(Path.GetTempPath(), "hub-desktop", "networks");
            Directory.CreateDirectory(directory);
            var safeName = string.Concat(
                item.FileName.Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries));
            if (safeName.Length == 0)
            {
                safeName = exportPdf ? $"map_{item.Id}.pdf" : $"map_{item.Id}.bin";
            }

            var target = Path.Combine(
                directory,
                exportPdf ? $"{item.Id}-pdf-{safeName}" : $"{item.Id}-{safeName}");
            await using (var destination = new FileStream(
                             target, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true))
            {
                var downloadedName = exportPdf
                    ? await _api.DownloadNetworkMapPdfAsync(item.Id, destination, CancellationToken.None)
                    : await _api.DownloadNetworkMapFileAsync(
                        item.Id, "original", destination, CancellationToken.None);
                var safeDownloadedName = string.Concat(
                    (downloadedName ?? string.Empty).Split(
                        Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries));
                if (safeDownloadedName.Length > 0)
                {
                    var prefix = exportPdf ? $"{item.Id}-pdf-" : $"{item.Id}-";
                    var renamed = Path.Combine(directory, prefix + safeDownloadedName);
                    if (!string.Equals(renamed, target, StringComparison.OrdinalIgnoreCase))
                    {
                        if (File.Exists(renamed))
                        {
                            File.Delete(renamed);
                        }

                        try
                        {
                            File.Move(target, renamed);
                            target = renamed;
                        }
                        catch (IOException)
                        {
                        }
                    }
                }
            }

            // Файл схемы/PDF открывается системным viewer'ом ассоциации ОС.
            Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            BannerErrorText = TasksViewModel.DescribeError(ex);
        }
        finally
        {
            item.IsDownloading = false;
            _mapDownloadsInFlight.Remove(downloadKey);
        }
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
        _detailLoadCancellation = null;
        _allBranches = [];
        Items.Clear();
        Detail = null;
        SelectedBranch = null;
        BannerErrorText = null;
        DetailErrorText = null;
        _searchText = string.Empty;
        OnPropertyChanged(nameof(SearchText));
        TotalText = string.Empty;
        LastUpdatedText = string.Empty;
        IsLoading = false;
        IsDetailLoading = false;
        _mapDownloadsInFlight.Clear();
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

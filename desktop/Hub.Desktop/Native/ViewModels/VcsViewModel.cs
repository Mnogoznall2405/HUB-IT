using System.Collections.ObjectModel;
using System.Globalization;
using System.Text.RegularExpressions;
using System.Windows.Input;
using Hub.Desktop.Native.Api;
using Process = System.Diagnostics.Process;
using ProcessStartInfo = System.Diagnostics.ProcessStartInfo;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Нормализация endpoint'а терминала ВКС — порт normalizeVncEndpoint
/// (frontend/src/lib/vncEndpoint.js): «vnc://» срезается, остаётся host[:port],
/// допустимы IPv4 (октеты ≤ 255) или DNS-имя по меткам, порт 1..65535.
/// </summary>
internal static class VcsEndpoint
{
    private static readonly Regex EndpointPattern =
        new(@"^([^:]+)(?::([0-9]{1,5}))?$", RegexOptions.Compiled);
    private static readonly Regex HostnameLabelPattern =
        new(@"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>Нормализованный host[:port] или пустая строка при невалидном адресе.</summary>
    public static string Normalize(string? rawValue)
    {
        var value = (rawValue ?? string.Empty).Trim();
        if (value.Length == 0 || value.Length > 320 || value.Any(char.IsControl))
        {
            return string.Empty;
        }

        if (value.StartsWith("vnc://", StringComparison.OrdinalIgnoreCase))
        {
            value = value["vnc://".Length..];
        }

        if (value.Length == 0 || value.Any(c => c is '@' or '/' or '?' or '#' or '\\'))
        {
            return string.Empty;
        }

        var match = EndpointPattern.Match(value);
        if (!match.Success)
        {
            return string.Empty;
        }

        var host = match.Groups[1].Value.ToLowerInvariant();
        var portText = match.Groups[2].Value;
        if (portText.Length > 0)
        {
            var port = int.Parse(portText, NumberStyles.None, CultureInfo.InvariantCulture);
            if (port is < 1 or > 65535)
            {
                return string.Empty;
            }
        }

        var ipv4Parts = host.Split('.');
        if (ipv4Parts.Length == 4
            && ipv4Parts.All(part => part.Length is >= 1 and <= 3 && part.All(char.IsDigit)))
        {
            if (ipv4Parts.Any(part => int.Parse(part, CultureInfo.InvariantCulture) > 255))
            {
                return string.Empty;
            }
        }
        else
        {
            if (host.Length > 253)
            {
                return string.Empty;
            }

            foreach (var label in host.Split('.'))
            {
                if (!HostnameLabelPattern.IsMatch(label))
                {
                    return string.Empty;
                }
            }
        }

        return portText.Length > 0 ? $"{host}:{portText}" : host;
    }
}

/// <summary>
/// Строка списка терминалов ВКС: имя переговорки, VNC-endpoint (host[:port])
/// и расположение — как карточка терминала веб-страницы Vcs.jsx.
/// </summary>
public sealed class VcsComputerItemViewModel
{
    public VcsComputerItemViewModel(HubVcsComputer computer)
    {
        ArgumentNullException.ThrowIfNull(computer);
        Id = computer.Id?.Trim() ?? string.Empty;
        Title = string.IsNullOrWhiteSpace(computer.Name) ? "Терминал ВКС" : computer.Name!.Trim();
        AddressText = computer.IpAddress?.Trim() ?? string.Empty;
        LocationText = computer.Location?.Trim() ?? string.Empty;
    }

    /// <summary>Идентификатор терминала — ключ POST launch-token.</summary>
    public string Id { get; }
    public string Title { get; }

    /// <summary>VNC-endpoint (ip_address контракта): host или host:port.</summary>
    public string AddressText { get; }
    public string LocationText { get; }
    public bool HasLocation => LocationText.Length > 0;
}

/// <summary>
/// Страница «🖧 VCS» (терминалы ВКС): плоский список терминалов, клиентский
/// поиск по имени/адресу/расположению и кнопка «Подключиться». Запуск — как
/// в вебе: POST /vcs/computers/{id}/launch-token → vnc://{endpoint}?launch_token=…
/// &api_base=… открывается системным обработчиком vnc:// (он скачивает
/// .vnc-файл по токену и стартует viewer). Только чтение: добавление/правка
/// терминалов и настройки VNC в срез не входят.
/// </summary>
public sealed class VcsViewModel : ObservableObject
{
    private readonly IHubApiClient _api;

    /// <summary>Подключения в полёте — второй клик по тому же терминалу не дублирует токен.</summary>
    private readonly HashSet<string> _connectsInFlight = new(StringComparer.Ordinal);

    /// <summary>Полная выдача списка (клиентский поиск фильтрует её).</summary>
    private IReadOnlyList<VcsComputerItemViewModel> _allComputers = [];

    private string _searchText = string.Empty;
    private bool _isLoading;
    private string? _bannerErrorText;
    private string _totalText = string.Empty;
    private string _lastUpdatedText = string.Empty;

    public VcsViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        ConnectCommand = new NativeAsyncCommand(
            (parameter, _) => ConnectAsync(parameter as VcsComputerItemViewModel),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is VcsComputerItemViewModel);
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        Items.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));
    }

    public ObservableCollection<VcsComputerItemViewModel> Items { get; } = [];

    /// <summary>Клиентский поиск по терминалам (имя/адрес/расположение) — как фильтр списка сетей.</summary>
    public string SearchText
    {
        get => _searchText;
        set
        {
            if (SetProperty(ref _searchText, value ?? string.Empty))
            {
                ApplyFilter();
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

    /// <summary>Подпись счётчика: «3 терминала».</summary>
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
    public ICommand ConnectCommand { get; }
    public ICommand DismissBannerCommand { get; }

    /// <summary>
    /// Шов запуска внешнего VNC-клиента: тесты подменяют Process.Start —
    /// делегат получает готовый vnc:// URI вида веб-клиента.
    /// </summary>
    public Action<string>? UrlLauncher { get; set; }

    /// <summary>Первичная загрузка/обновление списка терминалов.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        IsLoading = true;
        try
        {
            var computers = await _api.GetVcsComputersAsync(cancellationToken);
            _allComputers = (computers ?? [])
                .Select(computer => new VcsComputerItemViewModel(computer))
                .ToList();
            ApplyFilter();
            TotalText = FormatCount(_allComputers.Count, "терминал", "терминала", "терминалов");
            LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
            BannerErrorText = null;
        }
        finally
        {
            IsLoading = false;
        }
    }

    private void ApplyFilter()
    {
        var query = _searchText.Trim();
        Items.Clear();
        foreach (var computer in _allComputers)
        {
            if (query.Length == 0
                || computer.Title.Contains(query, StringComparison.OrdinalIgnoreCase)
                || computer.AddressText.Contains(query, StringComparison.OrdinalIgnoreCase)
                || computer.LocationText.Contains(query, StringComparison.OrdinalIgnoreCase))
            {
                Items.Add(computer);
            }
        }
    }

    /// <summary>
    /// «Подключиться»: launch-token → vnc://{endpoint}?launch_token=…&api_base=…
    /// — тот же URI, что строит веб-страница; открываем его обработчиком ОС
    /// (vnc_handler скачивает .vnc-файл и запускает TightVNC).
    /// </summary>
    private async Task ConnectAsync(VcsComputerItemViewModel? item)
    {
        if (item is null || !_connectsInFlight.Add(item.Id))
        {
            return;
        }

        try
        {
            var endpoint = VcsEndpoint.Normalize(item.AddressText);
            if (endpoint.Length == 0)
            {
                BannerErrorText =
                    "Некорректный адрес VNC. Исправьте адрес терминала и повторите попытку.";
                return;
            }

            var launch = await _api.CreateVcsLaunchTokenAsync(item.Id, CancellationToken.None);
            var token = launch.Token?.Trim() ?? string.Empty;
            var uri = BuildLaunchUri(endpoint, token);

            var launcher = UrlLauncher ?? LaunchWithShell;
            launcher(uri);
            BannerErrorText = null;
        }
        finally
        {
            _connectsInFlight.Remove(item.Id);
        }
    }

    /// <summary>
    /// buildVncUri из веб-Vcs.jsx: «vnc://{endpoint}», при токене —
    /// «?launch_token={token}&api_base={apiBase}» (apiBase — абсолютный /api/v1).
    /// </summary>
    internal string BuildLaunchUri(string endpoint, string token)
    {
        if (token.Length == 0)
        {
            return $"vnc://{endpoint}";
        }

        var apiBase = new Uri(_api.BaseUri, "api/v1").AbsoluteUri;
        return $"vnc://{endpoint}"
            + $"?launch_token={Uri.EscapeDataString(token)}"
            + $"&api_base={Uri.EscapeDataString(apiBase)}";
    }

    private static void LaunchWithShell(string uri) =>
        Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true });

    /// <summary>Ошибка загрузки, выставленная шеллом при инициализации страниц.</summary>
    public void SetLoadError(string message)
    {
        BannerErrorText = message;
        IsLoading = false;
    }

    /// <summary>Сброс содержимого при выходе из сессии.</summary>
    public void Reset()
    {
        _allComputers = [];
        Items.Clear();
        BannerErrorText = null;
        _searchText = string.Empty;
        OnPropertyChanged(nameof(SearchText));
        TotalText = string.Empty;
        LastUpdatedText = string.Empty;
        IsLoading = false;
        _connectsInFlight.Clear();
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

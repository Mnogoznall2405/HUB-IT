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
/// и расположение — как карточка терминала веб-страницы Vcs.jsx. При праве
/// vcs.manage карточка дополнительно несёт действия «↑»/«↓» (порядок),
/// «Изменить» и armed-«Удалить» (первое нажатие — подтверждение).
/// </summary>
public sealed class VcsComputerItemViewModel : ObservableObject
{
    private bool _isBusy;
    private bool _deleteArmed;
    private bool _canMoveUp;
    private bool _canMoveDown;

    public VcsComputerItemViewModel(HubVcsComputer computer)
    {
        ArgumentNullException.ThrowIfNull(computer);
        Source = computer;
        Id = computer.Id?.Trim() ?? string.Empty;
        Title = string.IsNullOrWhiteSpace(computer.Name) ? "Терминал ВКС" : computer.Name!.Trim();
        AddressText = computer.IpAddress?.Trim() ?? string.Empty;
        LocationText = computer.Location?.Trim() ?? string.Empty;
    }

    /// <summary>Исходная запись API — префилл диалога правки.</summary>
    internal HubVcsComputer Source { get; }

    /// <summary>Идентификатор терминала — ключ POST launch-token и PUT/DELETE.</summary>
    public string Id { get; }
    public string Title { get; }

    /// <summary>VNC-endpoint (ip_address контракта): host или host:port.</summary>
    public string AddressText { get; }
    public string LocationText { get; }
    public bool HasLocation => LocationText.Length > 0;

    /// <summary>Идёт запрос по строке (удаление) — кнопки действий недоступны.</summary>
    public bool IsBusy
    {
        get => _isBusy;
        internal set
        {
            if (SetProperty(ref _isBusy, value))
            {
                OnPropertyChanged(nameof(AreActionsEnabled));
            }
        }
    }

    /// <summary>Кнопки действий строки активны (обёртка !IsBusy для XAML).</summary>
    public bool AreActionsEnabled => !IsBusy;

    /// <summary>Первое нажатие «Удалить» взводит подтверждение; второе — DELETE.</summary>
    public bool DeleteArmed
    {
        get => _deleteArmed;
        internal set
        {
            if (SetProperty(ref _deleteArmed, value))
            {
                OnPropertyChanged(nameof(DeleteText));
            }
        }
    }

    /// <summary>Подпись кнопки удаления: armed-состояние просит повторное нажатие.</summary>
    public string DeleteText => DeleteArmed ? "Точно удалить?" : "Удалить";

    /// <summary>Позиция в полном списке: «↑» переставляет карточку выше (vcs.manage).</summary>
    public bool CanMoveUp
    {
        get => _canMoveUp;
        internal set => SetProperty(ref _canMoveUp, value);
    }

    /// <summary>Позиция в полном списке: «↓» переставляет карточку ниже (vcs.manage).</summary>
    public bool CanMoveDown
    {
        get => _canMoveDown;
        internal set => SetProperty(ref _canMoveDown, value);
    }
}

/// <summary>
/// Страница «🖧 VCS» (терминалы ВКС): плоский список терминалов, клиентский
/// поиск по имени/адресу/расположению и кнопка «Подключиться». Запуск — как
/// в вебе: POST /vcs/computers/{id}/launch-token → vnc://{endpoint}?launch_token=…
/// &api_base=… открывается системным обработчиком vnc:// (он скачивает
/// .vnc-файл по токену и стартует viewer). При праве vcs.manage — добавление/
/// правка/armed-удаление терминалов, порядок кнопками ↑/↓ (как drag&drop веба)
/// и диалоги «Пароль VNC»/«Информация». Ошибки диалогов изолированы в их формах,
/// ошибки списка — в баннере; порядок сохраняется оптимистично с откатом.
/// </summary>
public sealed class VcsViewModel : ObservableObject
{
    /// <summary>Право manage-среза — как PERM_VCS_MANAGE backend'а (admin — неявно).</summary>
    internal const string VcsManagePermission = "vcs.manage";

    private readonly IHubApiClient _api;

    /// <summary>Подключения в полёте — второй клик по тому же терминалу не дублирует токен.</summary>
    private readonly HashSet<string> _connectsInFlight = new(StringComparer.Ordinal);

    /// <summary>Полная выдача списка (клиентский поиск фильтрует её; порядок — серверный).</summary>
    private List<VcsComputerItemViewModel> _allComputers = [];

    /// <summary>Armed-удаление держит одна строка: новое взведение снимает предыдущее.</summary>
    private VcsComputerItemViewModel? _armedDeleteRow;

    /// <summary>Права страницы из /auth/me — один раз за сессию (fail-closed).</summary>
    private bool _permissionsLoaded;

    /// <summary>Сохранение порядка: снапшот летит один, ходы во время полёта склеиваются.</summary>
    private bool _orderSaveInFlight;
    private bool _orderSavePending;
    private Task _orderSaveTail = Task.CompletedTask;

    private string _searchText = string.Empty;
    private bool _isLoading;
    private string? _bannerErrorText;
    private string _totalText = string.Empty;
    private string _lastUpdatedText = string.Empty;
    private bool _canManageVcs;
    private VcsComputerEditorViewModel? _editor;
    private bool _isConfigDialogOpen;
    private bool _configIsBusy;
    private bool _configPasswordConfigured;
    private string _configPasswordInput = string.Empty;
    private string? _configErrorText;
    private bool _isInfoDialogOpen;
    private bool _infoIsBusy;
    private string _infoContentInput = string.Empty;
    private string? _infoErrorText;

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
        OpenCreateCommand = new NativeAsyncCommand(
            (_, ct) => OpenCreateAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => CanManageVcs && !IsEditorOpen);
        EditComputerCommand = new NativeRelayCommand(
            parameter => OpenEditorFor(parameter as VcsComputerItemViewModel),
            parameter => CanManageVcs && !IsEditorOpen && parameter is VcsComputerItemViewModel);
        DeleteComputerCommand = new NativeAsyncCommand(
            (parameter, ct) => DeleteAsync(parameter as VcsComputerItemViewModel, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => CanManageVcs && parameter is VcsComputerItemViewModel);
        MoveComputerUpCommand = new NativeRelayCommand(
            parameter => MoveComputer(parameter as VcsComputerItemViewModel, -1),
            parameter => CanManageVcs && parameter is VcsComputerItemViewModel { CanMoveUp: true });
        MoveComputerDownCommand = new NativeRelayCommand(
            parameter => MoveComputer(parameter as VcsComputerItemViewModel, 1),
            parameter => CanManageVcs && parameter is VcsComputerItemViewModel { CanMoveDown: true });
        OpenConfigCommand = new NativeAsyncCommand(
            (_, ct) => OpenConfigAsync(ct),
            ex =>
            {
                IsConfigDialogOpen = true;
                ConfigErrorText = TasksViewModel.DescribeError(ex);
            },
            _ => CanManageVcs && !IsConfigDialogOpen);
        CloseConfigCommand = new NativeRelayCommand(
            () => IsConfigDialogOpen = false,
            () => !ConfigIsBusy);
        SaveConfigCommand = new NativeAsyncCommand(
            (_, ct) => SaveConfigAsync(ct),
            ex => ConfigErrorText = TasksViewModel.DescribeError(ex),
            _ => CanManageVcs && !ConfigIsBusy);
        OpenInfoCommand = new NativeAsyncCommand(
            (_, ct) => OpenInfoAsync(ct),
            ex =>
            {
                IsInfoDialogOpen = true;
                InfoErrorText = TasksViewModel.DescribeError(ex);
            },
            _ => CanManageVcs && !IsInfoDialogOpen);
        CloseInfoCommand = new NativeRelayCommand(
            () => IsInfoDialogOpen = false,
            () => !InfoIsBusy);
        SaveInfoCommand = new NativeAsyncCommand(
            (_, ct) => SaveInfoAsync(ct),
            ex => InfoErrorText = TasksViewModel.DescribeError(ex),
            _ => CanManageVcs && !InfoIsBusy);
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

    /// <summary>«＋ Добавить» в тулбаре — только с правом vcs.manage.</summary>
    public ICommand OpenCreateCommand { get; }

    /// <summary>«Изменить» у карточки терминала (CommandParameter — строка).</summary>
    public ICommand EditComputerCommand { get; }

    /// <summary>«Удалить» у карточки: первое нажатие — armed, второе — DELETE.</summary>
    public ICommand DeleteComputerCommand { get; }

    /// <summary>«↑»/«↓» порядка карточек — замена drag&drop веб-страницы.</summary>
    public ICommand MoveComputerUpCommand { get; }
    public ICommand MoveComputerDownCommand { get; }

    /// <summary>«Пароль VNC» — диалог глобального password_hex (vcs.manage).</summary>
    public ICommand OpenConfigCommand { get; }
    public ICommand CloseConfigCommand { get; }
    public ICommand SaveConfigCommand { get; }

    /// <summary>«Информация» — диалог правки инфо-блока ВКС (vcs.manage).</summary>
    public ICommand OpenInfoCommand { get; }
    public ICommand CloseInfoCommand { get; }
    public ICommand SaveInfoCommand { get; }

    /// <summary>
    /// Шов запуска внешнего VNC-клиента: тесты подменяют Process.Start —
    /// делегат получает готовый vnc:// URI вида веб-клиента.
    /// </summary>
    public Action<string>? UrlLauncher { get; set; }

    // ---- Управление терминалами (vcs.manage) ----

    /// <summary>
    /// Право vcs.manage (или admin): кнопки «Добавить»/«Пароль VNC»/«Информация»
    /// и действия карточек. Fail-closed: без ответа /auth/me остаётся false.
    /// </summary>
    public bool CanManageVcs
    {
        get => _canManageVcs;
        private set
        {
            if (SetProperty(ref _canManageVcs, value))
            {
                RaiseManageCommandsChanged();
            }
        }
    }

    /// <summary>Открытый диалог добавления/правки терминала; null — закрыт.</summary>
    public VcsComputerEditorViewModel? Editor
    {
        get => _editor;
        private set
        {
            if (SetProperty(ref _editor, value))
            {
                OnPropertyChanged(nameof(IsEditorOpen));
                RaiseManageCommandsChanged();
            }
        }
    }

    public bool IsEditorOpen => Editor is not null;

    /// <summary>Оверлей «Пароль VNC» открыт.</summary>
    public bool IsConfigDialogOpen
    {
        get => _isConfigDialogOpen;
        private set
        {
            if (SetProperty(ref _isConfigDialogOpen, value))
            {
                RaiseManageCommandsChanged();
            }
        }
    }

    /// <summary>У сервера уже сохранён пароль (password_configured из GET /vcs/config).</summary>
    public bool ConfigPasswordConfigured
    {
        get => _configPasswordConfigured;
        private set
        {
            if (SetProperty(ref _configPasswordConfigured, value))
            {
                OnPropertyChanged(nameof(ConfigStatusText));
            }
        }
    }

    /// <summary>
    /// Подсказка поля пароля — как в веб-диалоге: «настроен — введите новый или
    /// сохраните пустым для очистки» / «не настроен — 16 символов, HEX».
    /// </summary>
    public string ConfigStatusText => ConfigPasswordConfigured
        ? "Пароль настроен. Введите новый 16-символьный HEX, чтобы заменить его, " +
            "или сохраните пустое поле, чтобы очистить."
        : "Пароль не настроен: 16 символов, шестнадцатеричный код.";

    /// <summary>Вводимый password_hex — как поле веб-диалога «Глобальный Password HEX».</summary>
    public string ConfigPasswordInput
    {
        get => _configPasswordInput;
        set => SetProperty(ref _configPasswordInput, value ?? string.Empty);
    }

    /// <summary>Ошибка диалога пароля (загрузка статуса/сохранение) — внутри формы.</summary>
    public string? ConfigErrorText
    {
        get => _configErrorText;
        private set
        {
            if (SetProperty(ref _configErrorText, value))
            {
                OnPropertyChanged(nameof(HasConfigError));
            }
        }
    }

    public bool HasConfigError => !string.IsNullOrEmpty(ConfigErrorText);

    /// <summary>Запрос диалога пароля в полёте: поля и «Сохранить» блокируются.</summary>
    public bool ConfigIsBusy
    {
        get => _configIsBusy;
        private set
        {
            if (SetProperty(ref _configIsBusy, value))
            {
                OnPropertyChanged(nameof(ConfigAreInputsEnabled));
                OnPropertyChanged(nameof(ConfigSubmitText));
                RaiseManageCommandsChanged();
            }
        }
    }

    public bool ConfigAreInputsEnabled => !ConfigIsBusy;
    public string ConfigSubmitText => ConfigIsBusy ? "Сохранение…" : "Сохранить настройки";

    /// <summary>Оверлей «Информация» открыт.</summary>
    public bool IsInfoDialogOpen
    {
        get => _isInfoDialogOpen;
        private set
        {
            if (SetProperty(ref _isInfoDialogOpen, value))
            {
                RaiseManageCommandsChanged();
            }
        }
    }

    /// <summary>Редактируемый текст инфо-блока (content контракта — JSON-таблица/текст).</summary>
    public string InfoContentInput
    {
        get => _infoContentInput;
        set => SetProperty(ref _infoContentInput, value ?? string.Empty);
    }

    /// <summary>Ошибка диалога «Информация» — внутри формы.</summary>
    public string? InfoErrorText
    {
        get => _infoErrorText;
        private set
        {
            if (SetProperty(ref _infoErrorText, value))
            {
                OnPropertyChanged(nameof(HasInfoError));
            }
        }
    }

    public bool HasInfoError => !string.IsNullOrEmpty(InfoErrorText);

    /// <summary>Запрос диалога «Информация» в полёте.</summary>
    public bool InfoIsBusy
    {
        get => _infoIsBusy;
        private set
        {
            if (SetProperty(ref _infoIsBusy, value))
            {
                OnPropertyChanged(nameof(InfoAreInputsEnabled));
                OnPropertyChanged(nameof(InfoSubmitText));
                RaiseManageCommandsChanged();
            }
        }
    }

    public bool InfoAreInputsEnabled => !InfoIsBusy;
    public string InfoSubmitText => InfoIsBusy ? "Сохранение…" : "Сохранить";

    /// <summary>Первичная загрузка/обновление списка терминалов.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        IsLoading = true;
        try
        {
            // Право узнаём до сборки строк: от него зависят manage-кнопки карточек.
            await EnsurePermissionsAsync(cancellationToken);

            var computers = await _api.GetVcsComputersAsync(cancellationToken);
            _allComputers = (computers ?? [])
                .Select(computer => new VcsComputerItemViewModel(computer))
                .ToList();
            ApplyFilter();
            UpdateMoveHints();
            TotalText = FormatCount(_allComputers.Count, "терминал", "терминала", "терминалов");
            LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
            BannerErrorText = null;
        }
        finally
        {
            IsLoading = false;
        }
    }

    /// <summary>
    /// Право vcs.manage узнаём один раз из /auth/me (матрица как у backend'а:
    /// admin видит всё, иначе — явное право). Ошибка /me не ломает список — false.
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
            var isAdmin = string.Equals(user.Role?.Trim(), "admin", StringComparison.OrdinalIgnoreCase);
            CanManageVcs = isAdmin
                || user.Permissions?.Contains(VcsManagePermission) == true;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            CanManageVcs = false;
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

    // ---- Управление: добавление / правка (vcs.manage) ----

    /// <summary>
    /// «＋ Добавить»: право перепроверяем (кнопка скрыта без него, но отказ
    /// дублируем словами, как у отсутствий) и открываем пустой редактор.
    /// </summary>
    private async Task OpenCreateAsync(CancellationToken cancellationToken)
    {
        await EnsurePermissionsAsync(cancellationToken);
        if (!CanManageVcs)
        {
            BannerErrorText = "Недостаточно прав для управления терминалами ВКС.";
            return;
        }

        OpenEditor(new VcsComputerEditorViewModel(_api));
    }

    private void OpenEditorFor(VcsComputerItemViewModel? item)
    {
        if (item is null || !CanManageVcs)
        {
            return;
        }

        OpenEditor(new VcsComputerEditorViewModel(_api, item.Source));
    }

    private void OpenEditor(VcsComputerEditorViewModel editor)
    {
        if (Editor is not null)
        {
            return;
        }

        editor.Saved = OnEditorSavedAsync;
        editor.Closed = () => Editor = null;
        Editor = editor;
    }

    /// <summary>Терминал сохранён: диалог закрываем, список перечитываем (как веб fetchComputers).</summary>
    private async Task OnEditorSavedAsync(HubVcsComputer _)
    {
        Editor = null;
        try
        {
            await LoadAsync(CancellationToken.None);
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
    }

    /// <summary>
    /// «Удалить»: первое нажатие взводит подтверждение на строке (как сброс 2FA
    /// и удаление отсутствий), второе — DELETE и локальное удаление карточки.
    /// Одновременно armed одна строка.
    /// </summary>
    private async Task DeleteAsync(VcsComputerItemViewModel? item, CancellationToken cancellationToken)
    {
        if (item is null || item.IsBusy || !CanManageVcs)
        {
            return;
        }

        if (!item.DeleteArmed)
        {
            ArmDelete(item);
            return;
        }

        item.DeleteArmed = false;
        _armedDeleteRow = null;
        item.IsBusy = true;
        try
        {
            await _api.DeleteVcsComputerAsync(item.Id, cancellationToken);
            _allComputers.Remove(item);
            ApplyFilter();
            UpdateMoveHints();
            TotalText = FormatCount(_allComputers.Count, "терминал", "терминала", "терминалов");
            BannerErrorText = null;
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            item.IsBusy = false;
        }
    }

    /// <summary>Armed-нажатие только у одной строки: новое снимает предыдущее.</summary>
    private void ArmDelete(VcsComputerItemViewModel item)
    {
        if (_armedDeleteRow is { } previous && !ReferenceEquals(previous, item))
        {
            previous.DeleteArmed = false;
        }

        _armedDeleteRow = item;
        item.DeleteArmed = true;
    }

    // ---- Управление: порядок карточек (вместо drag&drop веба — кнопки ↑/↓) ----

    /// <summary>
    /// Перестановка как moveComputerByOffset веба: список меняется оптимистично,
    /// затем PUT /vcs/computers/order массивом id; ошибка — откат перечитыванием.
    /// </summary>
    private void MoveComputer(VcsComputerItemViewModel? item, int offset)
    {
        if (item is null || !CanManageVcs)
        {
            return;
        }

        var index = _allComputers.IndexOf(item);
        var target = index + offset;
        if (index < 0 || target < 0 || target >= _allComputers.Count)
        {
            return;
        }

        _allComputers.RemoveAt(index);
        _allComputers.Insert(target, item);
        ApplyFilter();
        UpdateMoveHints();
        QueueOrderSave();
    }

    /// <summary>Текущий хвост сохранения порядка — тесты дожидаются его вместо sleep.</summary>
    internal Task OrderSaveTail => _orderSaveTail;

    /// <summary>
    /// Сохранение идёт — новые ходы не плодят запросы: помечаем pending и
    /// завершающий виток отправит последний снапшот (как debounce веба).
    /// </summary>
    private void QueueOrderSave()
    {
        if (_orderSaveInFlight)
        {
            _orderSavePending = true;
            return;
        }

        _orderSaveInFlight = true;
        _orderSaveTail = SaveOrderLoopAsync();
    }

    private async Task SaveOrderLoopAsync()
    {
        try
        {
            do
            {
                _orderSavePending = false;
                var orderedIds = _allComputers.Select(computer => computer.Id).ToArray();
                await _api.UpdateVcsComputersOrderAsync(orderedIds, CancellationToken.None);
            }
            while (_orderSavePending);
        }
        catch (Exception)
        {
            // Откат к серверному порядку: перечитываем список (fetchComputers веба).
            try
            {
                await LoadAsync(CancellationToken.None);
            }
            catch (Exception loadException)
            {
                BannerErrorText = TasksViewModel.DescribeError(loadException);
                return;
            }

            BannerErrorText = "Не удалось сохранить порядок терминалов.";
        }
        finally
        {
            _orderSaveInFlight = false;
            if (_orderSavePending)
            {
                // Ход пришёл между последней проверкой и сбросом флага.
                QueueOrderSave();
            }
        }
    }

    /// <summary>«↑»/«↓» доступны краям списка по позиции в полной выдаче.</summary>
    private void UpdateMoveHints()
    {
        for (var index = 0; index < _allComputers.Count; index++)
        {
            _allComputers[index].CanMoveUp = index > 0;
            _allComputers[index].CanMoveDown = index < _allComputers.Count - 1;
        }
    }

    // ---- Управление: глобальный пароль VNC (/vcs/config) ----

    /// <summary>
    /// «Пароль VNC»: диалог открываем сразу (как веб), статус догружаем
    /// GET /vcs/config; ошибка чтения — плашка внутри диалога.
    /// </summary>
    private async Task OpenConfigAsync(CancellationToken cancellationToken)
    {
        await EnsurePermissionsAsync(cancellationToken);
        if (!CanManageVcs)
        {
            BannerErrorText = "Недостаточно прав для управления терминалами ВКС.";
            return;
        }

        IsConfigDialogOpen = true;
        ConfigErrorText = null;
        ConfigPasswordInput = string.Empty;
        ConfigIsBusy = true;
        try
        {
            var config = await _api.GetVcsConfigAsync(cancellationToken);
            ConfigPasswordConfigured = config.PasswordConfigured;
        }
        catch (Exception exception)
        {
            ConfigErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            ConfigIsBusy = false;
        }
    }

    /// <summary>
    /// Сохранить пароль: PUT /vcs/config → флаг из ответа обновляет подсказку,
    /// диалог закрывается. Пустое поле — очистка пароля (как «save empty to clear»).
    /// </summary>
    private async Task SaveConfigAsync(CancellationToken cancellationToken)
    {
        if (ConfigIsBusy || !CanManageVcs)
        {
            return;
        }

        ConfigErrorText = null;
        ConfigIsBusy = true;
        try
        {
            var updated = await _api.UpdateVcsConfigAsync(ConfigPasswordInput, cancellationToken);
            ConfigPasswordConfigured = updated.PasswordConfigured;
            ConfigPasswordInput = string.Empty;
            IsConfigDialogOpen = false;
            BannerErrorText = null;
        }
        catch (Exception exception)
        {
            ConfigErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            ConfigIsBusy = false;
        }
    }

    // ---- Управление: инфо-блок (/vcs/info) ----

    /// <summary>
    /// «Информация»: диалог открываем сразу, текст догружаем GET /vcs/info;
    /// ошибка чтения — плашка внутри диалога.
    /// </summary>
    private async Task OpenInfoAsync(CancellationToken cancellationToken)
    {
        await EnsurePermissionsAsync(cancellationToken);
        if (!CanManageVcs)
        {
            BannerErrorText = "Недостаточно прав для управления терминалами ВКС.";
            return;
        }

        IsInfoDialogOpen = true;
        InfoErrorText = null;
        InfoIsBusy = true;
        try
        {
            var info = await _api.GetVcsInfoAsync(cancellationToken);
            InfoContentInput = info.Content ?? string.Empty;
        }
        catch (Exception exception)
        {
            InfoErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            InfoIsBusy = false;
        }
    }

    /// <summary>Сохранить инфо-блок: PUT /vcs/info {content} → диалог закрывается.</summary>
    private async Task SaveInfoAsync(CancellationToken cancellationToken)
    {
        if (InfoIsBusy || !CanManageVcs)
        {
            return;
        }

        InfoErrorText = null;
        InfoIsBusy = true;
        try
        {
            var saved = await _api.UpdateVcsInfoAsync(InfoContentInput, cancellationToken);
            InfoContentInput = saved.Content ?? string.Empty;
            IsInfoDialogOpen = false;
            BannerErrorText = null;
        }
        catch (Exception exception)
        {
            InfoErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            InfoIsBusy = false;
        }
    }

    /// <summary>Пересчёт CanExecute manage-команд при смене гейта/диалогов/busy.</summary>
    private void RaiseManageCommandsChanged()
    {
        ((NativeAsyncCommand)OpenCreateCommand).RaiseCanExecuteChanged();
        ((NativeRelayCommand)EditComputerCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)DeleteComputerCommand).RaiseCanExecuteChanged();
        ((NativeRelayCommand)MoveComputerUpCommand).RaiseCanExecuteChanged();
        ((NativeRelayCommand)MoveComputerDownCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)OpenConfigCommand).RaiseCanExecuteChanged();
        ((NativeRelayCommand)CloseConfigCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)SaveConfigCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)OpenInfoCommand).RaiseCanExecuteChanged();
        ((NativeRelayCommand)CloseInfoCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)SaveInfoCommand).RaiseCanExecuteChanged();
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
        _allComputers = [];
        Items.Clear();
        BannerErrorText = null;
        _searchText = string.Empty;
        OnPropertyChanged(nameof(SearchText));
        TotalText = string.Empty;
        LastUpdatedText = string.Empty;
        IsLoading = false;
        _connectsInFlight.Clear();
        Editor = null;
        if (_armedDeleteRow is { } armed)
        {
            armed.DeleteArmed = false;
        }
        _armedDeleteRow = null;
        CanManageVcs = false;
        _permissionsLoaded = false;
        _orderSaveInFlight = false;
        _orderSavePending = false;
        _orderSaveTail = Task.CompletedTask;
        IsConfigDialogOpen = false;
        ConfigIsBusy = false;
        ConfigPasswordConfigured = false;
        _configPasswordInput = string.Empty;
        OnPropertyChanged(nameof(ConfigPasswordInput));
        ConfigErrorText = null;
        IsInfoDialogOpen = false;
        InfoIsBusy = false;
        _infoContentInput = string.Empty;
        OnPropertyChanged(nameof(InfoContentInput));
        InfoErrorText = null;
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

/// <summary>
/// Диалог «Добавить терминал ВКС» / «Редактировать терминал» (vcs.manage).
/// Create → POST /vcs/computers, edit → PUT /vcs/computers/{id} — оба полным
/// телом формы (как веб preparedData): name (обязательно, ≤ 100), ip_address —
/// нормализованный endpoint host[:port] (create по контракту 7..50 символов),
/// location опционален. Ошибки валидации/сервера — в ErrorText, диалог и поля
/// сохраняются.
/// </summary>
public sealed class VcsComputerEditorViewModel : ObservableObject
{
    /// <summary>Ограничения VcsComputerCreate backend'а (name ≤ 100).</summary>
    internal const int NameMaxLength = 100;

    /// <summary>Ограничения VcsComputerCreate backend'а (ip_address 7..50).</summary>
    internal const int AddressMinLength = 7;
    internal const int AddressMaxLength = 50;

    private readonly IHubApiClient _api;
    private readonly HubVcsComputer? _original;
    private bool _isBusy;
    private string? _errorText;
    private string _name = string.Empty;
    private string _address = string.Empty;
    private string _location = string.Empty;

    /// <summary>Режим создания терминала.</summary>
    public VcsComputerEditorViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        IsCreateMode = true;
        InitCommands();
    }

    /// <summary>Режим правки терминала: форма заполняется исходными значениями.</summary>
    public VcsComputerEditorViewModel(IHubApiClient api, HubVcsComputer original)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _original = original ?? throw new ArgumentNullException(nameof(original));
        _name = (original.Name ?? string.Empty).Trim();
        _address = (original.IpAddress ?? string.Empty).Trim();
        _location = (original.Location ?? string.Empty).Trim();
        InitCommands();
    }

    private void InitCommands()
    {
        SubmitCommand = new NativeAsyncCommand(
            (_, ct) => SubmitAsync(ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsBusy);
        CloseCommand = new NativeRelayCommand(() => Closed?.Invoke(), () => !IsBusy);
    }

    /// <summary>Сохранение успешно — родитель перечитывает список и закрывает диалог.</summary>
    internal Func<HubVcsComputer, Task>? Saved;

    /// <summary>Закрытие диалога (✕/Отмена/Esc) — решает родитель.</summary>
    internal Action? Closed;

    // ---- Режим и заголовки ----

    public bool IsCreateMode { get; }

    public string TitleText => IsCreateMode
        ? "Добавить терминал ВКС"
        : "Редактировать терминал";

    public string SubtitleText => IsCreateMode
        ? "Новый терминал появится в конце списка."
        : _original?.Name?.Trim() ?? string.Empty;

    // ---- Поля формы ----

    /// <summary>Наименование (переговорка/кабинет) — обязательное, ≤ 100.</summary>
    public string Name
    {
        get => _name;
        set => SetProperty(ref _name, value ?? string.Empty);
    }

    /// <summary>IP-адрес / имя хоста (host[:port], допускается префикс vnc://).</summary>
    public string Address
    {
        get => _address;
        set => SetProperty(ref _address, value ?? string.Empty);
    }

    /// <summary>Расположение (филиал/этаж) — опционально.</summary>
    public string Location
    {
        get => _location;
        set => SetProperty(ref _location, value ?? string.Empty);
    }

    // ---- Состояние ----

    /// <summary>Поля формы отключены на время запроса.</summary>
    public bool AreInputsEnabled => !IsBusy;

    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (SetProperty(ref _isBusy, value))
            {
                OnPropertyChanged(nameof(AreInputsEnabled));
                OnPropertyChanged(nameof(SubmitButtonText));
                ((NativeAsyncCommand)SubmitCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)CloseCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public string SubmitButtonText => IsBusy
        ? "Сохранение…"
        : IsCreateMode ? "Добавить" : "Сохранить";

    /// <summary>Ошибка валидации/сервера — плашка внутри формы, поля не стираются.</summary>
    public string? ErrorText
    {
        get => _errorText;
        private set
        {
            if (SetProperty(ref _errorText, value))
            {
                OnPropertyChanged(nameof(HasError));
            }
        }
    }

    public bool HasError => !string.IsNullOrEmpty(ErrorText);

    public ICommand SubmitCommand { get; private set; } = new NativeRelayCommand(() => { });
    public ICommand CloseCommand { get; private set; } = new NativeRelayCommand(() => { });

    /// <summary>
    /// Сохранение: create → POST, edit → PUT по id исходной записи; обе ветки
    /// шлют полное тело формы. false — диалог остаётся открытым с ErrorText.
    /// </summary>
    public async Task<bool> SubmitAsync(CancellationToken cancellationToken = default)
    {
        if (IsBusy)
        {
            return false;
        }

        ErrorText = null;
        var request = BuildRequest(out var error);
        if (error is not null || request is null)
        {
            ErrorText = error;
            return false;
        }

        IsBusy = true;
        try
        {
            var saved = IsCreateMode
                ? await _api.CreateVcsComputerAsync(request, cancellationToken)
                : await _api.UpdateVcsComputerAsync(
                    _original!.Id?.Trim() ?? string.Empty, request, cancellationToken);
            if (Saved is { } onSaved)
            {
                await onSaved.Invoke(saved);
            }

            return true;
        }
        catch (Exception exception)
        {
            ErrorText = TasksViewModel.DescribeError(exception);
            return false;
        }
        finally
        {
            IsBusy = false;
        }
    }

    /// <summary>
    /// Тело запроса (до вызова API): name обязателен (≤ 100), адрес нормализуется
    /// VcsEndpoint-как-веб; на создание дополнительно серверные 7..50 символов
    /// (у PUT такого ограничения нет — длинный FQDN правкой не ломаем).
    /// </summary>
    internal HubVcsComputerInput? BuildRequest(out string? error)
    {
        error = null;
        var name = Name.Trim();
        if (name.Length == 0)
        {
            error = "Укажите наименование терминала.";
            return null;
        }

        if (name.Length > NameMaxLength)
        {
            error = $"Наименование — не более {NameMaxLength} символов.";
            return null;
        }

        var endpoint = VcsEndpoint.Normalize(Address);
        if (endpoint.Length == 0)
        {
            error = "Некорректный IP-адрес или имя хоста.";
            return null;
        }

        if (IsCreateMode && endpoint.Length is < AddressMinLength or > AddressMaxLength)
        {
            error = $"Адрес VNC — от {AddressMinLength} до {AddressMaxLength} символов.";
            return null;
        }

        return new HubVcsComputerInput
        {
            Name = name,
            IpAddress = endpoint,
            Location = Location.Trim(),
        };
    }
}

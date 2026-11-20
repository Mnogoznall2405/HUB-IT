using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>Локация в левой рейке «Моих файлов»: личный диск или общая папка (библиотека).</summary>
public sealed class MyFilesLocationViewModel
{
    private MyFilesLocationViewModel()
    {
    }

    /// <summary>null — личный диск пользователя (запросы без library_id).</summary>
    public string? LibraryId { get; private init; }
    public string Name { get; private init; } = string.Empty;
    public string IconGlyph { get; private init; } = "📁";
    /// <summary>Подпись под именем: роль в библиотеке и/или занято место.</summary>
    public string MetaText { get; private init; } = string.Empty;
    /// <summary>Роль в библиотеке backend'а: manage|edit|comment|view (у личного диска — пусто).</summary>
    public string Role { get; private init; } = string.Empty;
    public bool IsPersonal => LibraryId is null;

    /// <summary>Можно ли создавать/переименовывать/удалять и грузить файлы в этом месте.</summary>
    public bool CanWrite { get; private init; }

    public static MyFilesLocationViewModel Personal { get; } = new()
    {
        Name = "Мои файлы",
        IconGlyph = "💾",
        MetaText = "Личный диск",
        CanWrite = true,
    };

    public static MyFilesLocationViewModel FromLibrary(HubMyFileLibrary library)
    {
        ArgumentNullException.ThrowIfNull(library);
        var role = (library.MyRole ?? string.Empty).Trim().ToLowerInvariant();
        var roleLabel = role switch
        {
            "manage" => "Управление",
            "edit" => "Редактирование",
            "comment" => "Комментарии",
            "view" => "Просмотр",
            _ => "Общая папка",
        };
        var meta = roleLabel;
        if (library.QuotaBytes > 0)
        {
            meta += " · " + MyFilesViewModel.FormatSize(library.UsedBytes)
                + " из " + MyFilesViewModel.FormatSize(library.QuotaBytes);
        }

        return new MyFilesLocationViewModel
        {
            LibraryId = library.Id,
            Name = string.IsNullOrWhiteSpace(library.Name) ? "Общая папка" : library.Name.Trim(),
            IconGlyph = "📂",
            MetaText = meta,
            Role = role,
            // Создание/удаление в библиотеке — для ролей edit и выше (как в веб-клиенте).
            CanWrite = role is "manage" or "edit",
        };
    }
}

/// <summary>Строка списка «Моих файлов»: папка или файл текущего места.</summary>
public sealed class MyFileEntryViewModel : ObservableObject
{
    private bool _isDownloading;
    private bool _isShared;
    private bool _purgeArmed;

    private MyFileEntryViewModel()
    {
    }

    public string Id { get; private init; } = string.Empty;
    public string Name { get; private init; } = string.Empty;
    public bool IsFolder { get; private init; }
    public string IconGlyph { get; private init; } = "📄";
    /// <summary>«1,2 МБ» у файла; у папки — счётчик содержимого или пусто.</summary>
    public string SizeText { get; private init; } = string.Empty;
    public string ModifiedText { get; private init; } = string.Empty;
    /// <summary>Статус обработки для не-готовых файлов («Обрабатывается…»), у ready — пусто.</summary>
    public string StatusText { get; private init; } = string.Empty;
    /// <summary>Скачивание разрешено только у готовых файлов (backend: ready only).</summary>
    public bool CanOpen { get; private init; }
    /// <summary>Кнопка «Просмотр» — сервер отдаёт /preview/content и тип — image.</summary>
    public bool CanPreview { get; private init; }

    /// <summary>Флаг «качается»: второй клик по чипу не даст параллельный FileStream.</summary>
    public bool IsDownloading
    {
        get => _isDownloading;
        internal set => SetProperty(ref _isDownloading, value);
    }

    /// <summary>Есть активная публичная ссылка (is_shared ответа backend).</summary>
    public bool IsShared
    {
        get => _isShared;
        internal set => SetProperty(ref _isShared, value);
    }

    /// <summary>Подпись «Удалить навсегда» в корзине: armed-паттерн — «Удалить?».</summary>
    public string PurgeText => _purgeArmed ? "Удалить?" : "Удалить навсегда";

    /// <summary>Первое нажатие взводит (true → команда уже может удалять навсегда).</summary>
    public bool ArmPurge()
    {
        if (_purgeArmed)
        {
            return true;
        }

        _purgeArmed = true;
        OnPropertyChanged(nameof(PurgeText));
        return false;
    }

    /// <summary>Папка восстановлена/удалена навсегда — флаг сбрасывается с обновлением списка.</summary>
    public void DisarmPurge()
    {
        if (_purgeArmed)
        {
            _purgeArmed = false;
            OnPropertyChanged(nameof(PurgeText));
        }
    }

    public static MyFileEntryViewModel FromFolder(HubMyFileFolder folder, bool forTrash = false)
    {
        ArgumentNullException.ThrowIfNull(folder);
        var count = Math.Max(0, folder.FileCount);
        return new MyFileEntryViewModel
        {
            Id = folder.Id ?? string.Empty,
            Name = string.IsNullOrWhiteSpace(folder.Name) ? "Папка" : folder.Name.Trim(),
            IsFolder = true,
            IconGlyph = "📁",
            SizeText = count == 0 ? "пусто" : FormatCount(count),
            ModifiedText = FormatDate(folder.UpdatedAt ?? folder.CreatedAt),
            CanOpen = !forTrash,
            IsShared = folder.IsShared,
        };
    }

    public static MyFileEntryViewModel FromFile(HubMyFileItem file, bool forTrash = false)
    {
        ArgumentNullException.ThrowIfNull(file);
        var name = string.IsNullOrWhiteSpace(file.OriginalFileName)
            ? "Файл"
            : file.OriginalFileName.Trim();
        var status = (file.Status ?? string.Empty).Trim().ToLowerInvariant();
        var ready = status == "ready";
        return new MyFileEntryViewModel
        {
            Id = file.Id ?? string.Empty,
            Name = name,
            IsFolder = false,
            IconGlyph = FileIcon(name),
            SizeText = MyFilesViewModel.FormatSize(file.OriginalSizeBytes),
            ModifiedText = FormatDate(file.UpdatedAt ?? file.CreatedAt),
            StatusText = ready ? string.Empty : StatusLabel(status),
            CanOpen = ready && !forTrash,
            CanPreview = !forTrash
                && file.PreviewAvailable
                && string.Equals((file.PreviewKind ?? string.Empty).Trim(), "image", StringComparison.OrdinalIgnoreCase),
            IsShared = file.IsShared,
        };
    }

    private static string StatusLabel(string status) => status switch
    {
        "uploading" or "queued" => "Загружается…",
        "scanning" => "Проверка…",
        "processing" => "Обрабатывается…",
        "failed" => "Ошибка обработки",
        _ => "Обрабатывается…",
    };

    /// <summary>Иконка по расширению — как в веб-списке «Моих файлов».</summary>
    private static string FileIcon(string name)
    {
        var extension = Path.GetExtension(name)?.ToLowerInvariant() ?? string.Empty;
        return extension switch
        {
            ".pdf" => "📕",
            ".doc" or ".docx" or ".odt" or ".rtf" or ".txt" or ".md" => "📝",
            ".xls" or ".xlsx" or ".ods" or ".csv" => "📊",
            ".ppt" or ".pptx" or ".odp" => "📽",
            ".png" or ".jpg" or ".jpeg" or ".gif" or ".bmp" or ".webp" or ".svg" or ".heic" => "🖼",
            ".mp4" or ".mov" or ".mkv" or ".avi" or ".webm" => "🎬",
            ".mp3" or ".wav" or ".ogg" or ".flac" or ".m4a" => "🎵",
            ".zip" or ".7z" or ".rar" or ".tar" or ".gz" => "🗜",
            _ => "📄",
        };
    }

    internal static string FormatDate(DateTimeOffset? value) =>
        value?.ToLocalTime().ToString("dd.MM.yyyy", CultureInfo.InvariantCulture) ?? string.Empty;

    internal static string FormatCount(int count) =>
        $"{count.ToString(CultureInfo.InvariantCulture)} элем.";
}

/// <summary>Хлебная крошка пути: FolderId null — корень локации (диск или библиотека).</summary>
public sealed class MyFileCrumbViewModel
{
    public MyFileCrumbViewModel(string? folderId, string name, bool showSeparator = true)
    {
        FolderId = folderId;
        Name = name;
        ShowSeparator = showSeparator;
    }

    public string? FolderId { get; }
    public string Name { get; }
    /// <summary>«›» перед крошкой; у корневой не показываем.</summary>
    public bool ShowSeparator { get; }
}

/// <summary>Опция срока хранения загружаемого файла (RETENTION_OPTIONS веб-клиента).</summary>
public sealed class MyFileRetentionOption
{
    public MyFileRetentionOption(int days)
    {
        Days = days;
        Label = days == 0 ? "Навсегда" : $"{days.ToString(CultureInfo.InvariantCulture)} дн.";
    }

    public int Days { get; }
    public string Label { get; }
}

/// <summary>
/// Строка активной публичной ссылки в панели «Поделиться».
/// Контракт backend хранит одну ссылку на объект — список нужен только для
/// единообразной привязки строки со статусом и сроком.
/// </summary>
public sealed class MyFileShareLinkViewModel
{
    private MyFileShareLinkViewModel()
    {
    }

    public string Url { get; private init; } = string.Empty;
    /// <summary>«Активна» или «Истекла» (expires_at файла уже в прошлом).</summary>
    public string StatusText { get; private init; } = string.Empty;
    /// <summary>«до dd.MM.yyyy HH:mm» или «бессрочно» (null либо >10 лет — как в веб-клиенте).</summary>
    public string ExpiresText { get; private init; } = string.Empty;

    public static MyFileShareLinkViewModel Create(string url, DateTimeOffset? expiresAt)
    {
        var now = DateTimeOffset.Now;
        var expired = expiresAt is { } value && value <= now;
        // «Навсегда» backend хранит как expires_at +100 лет; веб считает бессрочным >3650 дней.
        var forever = expiresAt is null || (expiresAt.Value - now).TotalDays > 3650;
        return new MyFileShareLinkViewModel
        {
            Url = url,
            StatusText = expired ? "Истекла" : "Активна",
            ExpiresText = forever
                ? "бессрочно"
                : $"до {expiresAt!.Value.ToLocalTime().ToString("dd.MM.yyyy HH:mm", CultureInfo.InvariantCulture)}",
        };
    }
}

/// <summary>
/// «Мои файлы»: двухпанельный файловый менеджер — личный диск и общие папки
/// (библиотеки) с навигацией, скачиванием (grant), чанковой загрузкой,
/// созданием/переименованием/удалением. Редактирование документов — web-only.
/// </summary>
public sealed class MyFilesViewModel : ObservableObject
{
    /// <summary>Одна повторная попытка на чанк — минимум для первого среза.</summary>
    private static readonly TimeSpan ChunkRetryDelay = TimeSpan.FromSeconds(1);

    private readonly IHubApiClient _api;
    private readonly HashSet<string> _downloadsInFlight = new(StringComparer.Ordinal);

    private MyFilesLocationViewModel? _selectedLocation;
    private string? _currentLibraryId;
    private string? _currentFolderId;
    private MyFileEntryViewModel? _selectedItem;
    private bool _isLoading;
    private bool _isUploading;
    private string? _uploadStatusText;
    private string? _bannerErrorText;
    private string _headerText = "Мои файлы";
    private bool _librariesLoaded;
    private bool _isNameEditorOpen;
    private string _nameEditorTitle = string.Empty;
    private string _nameEditorConfirmText = "Сохранить";
    private string _nameEditorText = string.Empty;
    private MyFileEntryViewModel? _renameTarget;
    private int _retentionDays = 1;
    private bool _isSharePanelOpen;
    private bool _isShareBusy;
    private string _shareTargetText = string.Empty;
    private string _shareUrl = string.Empty;
    private bool _shareLinkCopied;
    private MyFileEntryViewModel? _shareTarget;
    private bool _isTrashView;
    private string? _trashLibraryId;
    private bool _emptyTrashArmed;
    private bool _canManageLibraries;
    private readonly Dictionary<string, HubMyFileLibrary> _libraryById = new(StringComparer.Ordinal);
    private HubMyFileQuota? _quota;
    private MyFilesLibraryEditorViewModel? _libraryEditor;
    private MyFilesLibraryMembersViewModel? _membersEditor;
    private bool _isPreviewOpen;
    private bool _isPreviewLoading;
    private ImageSource? _previewImage;
    private string _previewTitle = string.Empty;

    public MyFilesViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        SelectLocationCommand = new NativeAsyncCommand(
            (parameter, ct) => SelectLocationAsync(
                parameter as MyFilesLocationViewModel ?? MyFilesLocationViewModel.Personal, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        OpenEntryCommand = new NativeAsyncCommand(
            (parameter, ct) => OpenEntryAsync(
                parameter as MyFileEntryViewModel ?? SelectedItem, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is MyFileEntryViewModel { CanOpen: true }
                || (parameter is null && SelectedItem is { CanOpen: true }));
        GoUpCommand = new NativeAsyncCommand(
            (_, ct) => GoUpAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => CanGoUp);
        GoToCrumbCommand = new NativeAsyncCommand(
            (parameter, ct) => parameter is MyFileCrumbViewModel crumb
                ? GoToFolderAsync(crumb.FolderId, ct)
                : Task.CompletedTask,
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        DownloadEntryCommand = new NativeAsyncCommand(
            (parameter, ct) => DownloadFileAsync(
                parameter as MyFileEntryViewModel ?? SelectedItem),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => (parameter as MyFileEntryViewModel ?? SelectedItem)
                is { IsFolder: false, CanOpen: true });
        UploadCommand = new NativeAsyncCommand(
            (_, ct) => UploadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => CanWrite && !IsUploading);
        BeginNewFolderCommand = new NativeAsyncCommand(
            (_, ct) => BeginNewFolderAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => CanWrite && !IsUploading);
        BeginRenameCommand = new NativeAsyncCommand(
            (parameter, ct) => BeginRenameAsync(
                parameter as MyFileEntryViewModel ?? SelectedItem, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => CanWrite && !IsUploading
                && (parameter as MyFileEntryViewModel ?? SelectedItem) is not null);
        ConfirmNameEditorCommand = new NativeAsyncCommand(
            (_, ct) => ConfirmNameEditorAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => !string.IsNullOrWhiteSpace(NameEditorText));
        CancelNameEditorCommand = new NativeRelayCommand(CloseNameEditor);
        DeleteEntryCommand = new NativeAsyncCommand(
            (parameter, ct) => DeleteEntryAsync(
                parameter as MyFileEntryViewModel ?? SelectedItem, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => CanWrite && !IsUploading
                && (parameter as MyFileEntryViewModel ?? SelectedItem) is not null);
        SelectRetentionCommand = new NativeRelayCommand(
            parameter =>
            {
                if (parameter is MyFileRetentionOption option)
                {
                    RetentionDays = option.Days;
                }
                else if (parameter is string text && int.TryParse(text, out var days))
                {
                    RetentionDays = days;
                }
            });
        BeginShareCommand = new NativeAsyncCommand(
            (parameter, ct) => OpenSharePanelAsync(
                parameter as MyFileEntryViewModel ?? SelectedItem, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => !IsUploading && !IsShareBusy
                && (parameter as MyFileEntryViewModel ?? SelectedItem) is { CanOpen: true });
        CreateShareCommand = new NativeAsyncCommand(
            (_, ct) => ReplaceShareAsync(rotate: false, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => _shareTarget is not null && !IsShareBusy);
        RotateShareCommand = new NativeAsyncCommand(
            (_, ct) => ReplaceShareAsync(rotate: true, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => _shareTarget is not null && !IsShareBusy);
        RevokeShareCommand = new NativeAsyncCommand(
            (_, ct) => RevokeShareAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => _shareTarget is not null && !IsShareBusy);
        CopyShareLinkCommand = new NativeRelayCommand(
            CopyShareLink,
            () => ShareUrl.Length > 0);
        CloseSharePanelCommand = new NativeRelayCommand(CloseSharePanel);
        ShowTrashCommand = new NativeAsyncCommand(
            (_, ct) => ShowTrashAsync(forcePersonal: false, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => CanShowLocationTrash);
        ShowPersonalTrashCommand = new NativeAsyncCommand(
            (_, ct) => ShowTrashAsync(forcePersonal: true, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsPersonalTrash);
        ShowFilesCommand = new NativeAsyncCommand(
            (_, ct) => ShowFilesAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => IsTrashView);
        EmptyTrashCommand = new NativeAsyncCommand(
            (_, ct) => EmptyTrashAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => IsTrashView && Items.Count > 0);
        RestoreEntryCommand = new NativeAsyncCommand(
            (parameter, ct) => RestoreEntryAsync(
                parameter as MyFileEntryViewModel ?? SelectedItem, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => IsTrashView
                && (parameter as MyFileEntryViewModel ?? SelectedItem) is not null);
        PurgeEntryCommand = new NativeAsyncCommand(
            (parameter, ct) => PurgeEntryAsync(
                parameter as MyFileEntryViewModel ?? SelectedItem, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => IsTrashView
                && (parameter as MyFileEntryViewModel ?? SelectedItem) is not null);
        CopyEntryCommand = new NativeAsyncCommand(
            (parameter, ct) => CopyEntryAsync(
                parameter as MyFileEntryViewModel ?? SelectedItem, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => IsFileView
                && (parameter as MyFileEntryViewModel ?? SelectedItem) is { IsFolder: false, CanOpen: true });
        DownloadArchiveCommand = new NativeAsyncCommand(
            (parameter, ct) => DownloadFolderArchiveAsync(
                parameter as MyFileEntryViewModel ?? SelectedItem),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => IsFileView
                && (parameter as MyFileEntryViewModel ?? SelectedItem) is { IsFolder: true });
        PreviewEntryCommand = new NativeAsyncCommand(
            (parameter, ct) => PreviewEntryAsync(
                parameter as MyFileEntryViewModel ?? SelectedItem, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => IsFileView
                && (parameter as MyFileEntryViewModel ?? SelectedItem) is { IsFolder: false, CanPreview: true });
        ClosePreviewCommand = new NativeRelayCommand(ClosePreview);
        NewLibraryCommand = new NativeRelayCommand(
            () => OpenLibraryEditor(null),
            () => CanManageLibraries);
        EditLibraryCommand = new NativeRelayCommand(
            () =>
            {
                if (_currentLibraryId is { } id && _libraryById.TryGetValue(id, out var library))
                {
                    OpenLibraryEditor(library);
                }
            },
            () => CanEditCurrentLibrary);
        LibraryMembersCommand = new NativeAsyncCommand(
            (_, ct) => OpenMembersEditorAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => CanManageMembersHere);
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        Items.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));
        ShareLinks.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasShareLinks));
    }

    /// <summary>Локации левой рейки: личный диск первой строкой, затем общие папки.</summary>
    public ObservableCollection<MyFilesLocationViewModel> Locations { get; } = [];

    /// <summary>Путь: синтетический корень локации + папки из ответа backend.</summary>
    public ObservableCollection<MyFileCrumbViewModel> Breadcrumbs { get; } = [];

    /// <summary>Папки и файлы текущего места (папки первыми — как отдаёт backend).</summary>
    public ObservableCollection<MyFileEntryViewModel> Items { get; } = [];

    /// <summary>Активные публичные ссылки цели панели (контракт backend — одна на объект).</summary>
    public ObservableCollection<MyFileShareLinkViewModel> ShareLinks { get; } = [];

    /// <summary>Выбранная локация; присвоение из рейки — та же навигация, что SelectLocationCommand.</summary>
    public MyFilesLocationViewModel? SelectedLocation
    {
        get => _selectedLocation;
        set
        {
            if (SetProperty(ref _selectedLocation, value)
                && value is not null
                && !string.Equals(value.LibraryId, _currentLibraryId, StringComparison.Ordinal))
            {
                _ = SelectLocationSafelyAsync(value);
            }
        }
    }

    public MyFileEntryViewModel? SelectedItem
    {
        get => _selectedItem;
        set
        {
            if (SetProperty(ref _selectedItem, value))
            {
                RaiseCommandStates();
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

    /// <summary>Идёт чанковая загрузка: действия над списком временно недоступны.</summary>
    public bool IsUploading
    {
        get => _isUploading;
        private set
        {
            if (SetProperty(ref _isUploading, value))
            {
                RaiseCommandStates();
            }
        }
    }

    /// <summary>«Загрузка «отчёт.pdf»…» — строка прогресса под тулбаром.</summary>
    public string? UploadStatusText
    {
        get => _uploadStatusText;
        private set => SetProperty(ref _uploadStatusText, value);
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

    /// <summary>Заголовок правой панели — имя локации («Мои файлы» или библиотека).</summary>
    public string HeaderText
    {
        get => _headerText;
        private set => SetProperty(ref _headerText, value);
    }

    /// <summary>Можно писать в текущее место (личный диск — всегда; библиотека — по my_role).</summary>
    public bool CanWrite => _selectedLocation?.CanWrite ?? true;

    public bool CanGoUp => _currentFolderId is not null;

    /// <summary>Пустая выдача без ошибки и не в процессе загрузки.</summary>
    public bool IsEmpty => !IsLoading && Items.Count == 0 && !HasBannerError;

    // ---- Корзина ----

    /// <summary>Сейчас показана корзина (Items — удалённые файлы/папки, без навигации вглубь).</summary>
    public bool IsTrashView
    {
        get => _isTrashView;
        private set
        {
            if (SetProperty(ref _isTrashView, value))
            {
                OnPropertyChanged(nameof(IsFileView));
                OnPropertyChanged(nameof(IsPersonalTrash));
                OnPropertyChanged(nameof(AreFileActionsVisible));
                OnPropertyChanged(nameof(EmptyTitleText));
                OnPropertyChanged(nameof(EmptyHintText));
            }
        }
    }

    /// <summary>Обычный список файлов (не корзина).</summary>
    public bool IsFileView => !IsTrashView;

    /// <summary>Корзина личного диска (а не корзина библиотеки).</summary>
    public bool IsPersonalTrash => IsTrashView && _trashLibraryId is null;

    /// <summary>Файловые действия (загрузка/папки/удаление/поделиться) скрыты в корзине.</summary>
    public bool AreFileActionsVisible => CanWrite && !IsTrashView;

    /// <summary>Корзину можно открыть у диска и у библиотеки с my_role=manage.</summary>
    public bool CanShowLocationTrash => !IsTrashView
        && (_selectedLocation is null
            || _selectedLocation.IsPersonal
            || string.Equals(_selectedLocation.Role, "manage", StringComparison.Ordinal));

    /// <summary>Подпись «Очистить корзину»: armed-паттерн второго нажатия.</summary>
    public string EmptyTrashText => _emptyTrashArmed ? "Очистить корзину?" : "Очистить корзину";

    // ---- Квота личного диска ----

    /// <summary>Квота загружена — показываем индикатор занятого места в рейке.</summary>
    public bool IsQuotaVisible => _quota is not null;

    /// <summary>Процент занятого (0-100) для ProgressBar рейки.</summary>
    public double QuotaPercent => _quota is { LimitBytes: > 0 } quota
        ? Math.Min(100d, quota.UsedBytes / (double)quota.LimitBytes * 100d)
        : 0d;

    /// <summary>«3,2 ГБ из 10 ГБ».</summary>
    public string QuotaText => _quota is null
        ? string.Empty
        : $"{FormatSize(_quota.UsedBytes)} из {FormatSize(_quota.LimitBytes)}";

    // ---- Библиотеки: редактор и участники ----

    /// <summary>can_manage из GET /my-files/libraries — показывает «+ Общая папка» и «Настроить».</summary>
    public bool CanManageLibraries
    {
        get => _canManageLibraries;
        private set
        {
            if (SetProperty(ref _canManageLibraries, value))
            {
                ((NativeRelayCommand)NewLibraryCommand).RaiseCanExecuteChanged();
                OnPropertyChanged(nameof(CanEditCurrentLibrary));
            }
        }
    }

    /// <summary>Управляющий может править параметры открытой библиотеки.</summary>
    public bool CanEditCurrentLibrary => CanManageLibraries && _currentLibraryId is not null && !IsTrashView;

    /// <summary>«Участники» доступны управляющему или члену библиотеки с ролью manage.</summary>
    public bool CanManageMembersHere => _currentLibraryId is not null
        && !IsTrashView
        && (CanManageLibraries || string.Equals(_selectedLocation?.Role, "manage", StringComparison.Ordinal));

    /// <summary>VM диалога создания/переименования библиотеки; null — диалог закрыт.</summary>
    public MyFilesLibraryEditorViewModel? LibraryEditor
    {
        get => _libraryEditor;
        private set
        {
            if (SetProperty(ref _libraryEditor, value))
            {
                OnPropertyChanged(nameof(IsLibraryEditorOpen));
            }
        }
    }

    public bool IsLibraryEditorOpen => LibraryEditor is not null;

    /// <summary>VM диалога участников текущей библиотеки; null — диалог закрыт.</summary>
    public MyFilesLibraryMembersViewModel? MembersEditor
    {
        get => _membersEditor;
        private set
        {
            if (SetProperty(ref _membersEditor, value))
            {
                OnPropertyChanged(nameof(IsMembersEditorOpen));
            }
        }
    }

    public bool IsMembersEditorOpen => MembersEditor is not null;

    // ---- Предпросмотр изображения ----

    /// <summary>Оверлей предпросмотра открыт.</summary>
    public bool IsPreviewOpen
    {
        get => _isPreviewOpen;
        private set => SetProperty(ref _isPreviewOpen, value);
    }

    /// <summary>Идёт скачивание preview/content (индикатор в оверлее).</summary>
    public bool IsPreviewLoading
    {
        get => _isPreviewLoading;
        private set => SetProperty(ref _isPreviewLoading, value);
    }

    /// <summary>Картинка превью (BitmapImage из авторизованного потока).</summary>
    public ImageSource? PreviewImage
    {
        get => _previewImage;
        private set => SetProperty(ref _previewImage, value);
    }

    public string PreviewTitle
    {
        get => _previewTitle;
        private set => SetProperty(ref _previewTitle, value);
    }

    public string EmptyTitleText => IsTrashView ? "Корзина пуста" : "Здесь пока пусто";

    public string EmptyHintText => IsTrashView
        ? "Удалённые объекты хранятся ограниченное время."
        : CanWrite
            ? "Загрузите файлы или создайте папку."
            : "В этой папке пока нет файлов.";

    // ---- Редактор имени (создать папку / переименовать) ----

    public bool IsNameEditorOpen
    {
        get => _isNameEditorOpen;
        private set => SetProperty(ref _isNameEditorOpen, value);
    }

    public string NameEditorTitle
    {
        get => _nameEditorTitle;
        private set => SetProperty(ref _nameEditorTitle, value);
    }

    public string NameEditorConfirmText
    {
        get => _nameEditorConfirmText;
        private set => SetProperty(ref _nameEditorConfirmText, value);
    }

    public string NameEditorText
    {
        get => _nameEditorText;
        set
        {
            if (SetProperty(ref _nameEditorText, value ?? string.Empty))
            {
                ((NativeAsyncCommand)ConfirmNameEditorCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Срок хранения загружаемых файлов (только личный диск; у библиотек — своя квота).</summary>
    public int RetentionDays
    {
        get => _retentionDays;
        set
        {
            if (SetProperty(ref _retentionDays, value))
            {
                OnPropertyChanged(nameof(RetentionLabel));
            }
        }
    }

    public string RetentionLabel =>
        RetentionDays == 0 ? "Навсегда" : $"{RetentionDays.ToString(CultureInfo.InvariantCulture)} дн.";

    public IReadOnlyList<MyFileRetentionOption> RetentionOptions { get; } =
        [new(1), new(3), new(7), new(10), new(30), new(0)];

    // ---- Панель «Поделиться» (публичная ссылка) ----

    /// <summary>Панель публичной ссылки открыта поверх списка.</summary>
    public bool IsSharePanelOpen
    {
        get => _isSharePanelOpen;
        private set => SetProperty(ref _isSharePanelOpen, value);
    }

    /// <summary>Идёт запрос create/revoke share — кнопки панели временно недоступны.</summary>
    public bool IsShareBusy
    {
        get => _isShareBusy;
        private set
        {
            if (SetProperty(ref _isShareBusy, value))
            {
                ((NativeAsyncCommand)CreateShareCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)RotateShareCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)RevokeShareCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)BeginShareCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Подпись цели панели («Папка «Документы»» / имя файла).</summary>
    public string ShareTargetText
    {
        get => _shareTargetText;
        private set => SetProperty(ref _shareTargetText, value);
    }

    /// <summary>Абсолютный URL активной ссылки для показа и копирования.</summary>
    public string ShareUrl
    {
        get => _shareUrl;
        private set
        {
            if (SetProperty(ref _shareUrl, value))
            {
                ((NativeRelayCommand)CopyShareLinkCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Ссылка только что скопирована — кнопка меняет подпись на «Скопировано».</summary>
    public bool ShareLinkCopied
    {
        get => _shareLinkCopied;
        private set
        {
            if (SetProperty(ref _shareLinkCopied, value))
            {
                OnPropertyChanged(nameof(ShareCopyText));
            }
        }
    }

    public string ShareCopyText => ShareLinkCopied ? "Скопировано" : "Копировать";

    public bool HasShareLinks => ShareLinks.Count > 0;

    public ICommand RefreshCommand { get; }
    public ICommand SelectLocationCommand { get; }
    public ICommand OpenEntryCommand { get; }
    public ICommand GoUpCommand { get; }
    public ICommand GoToCrumbCommand { get; }
    public ICommand DownloadEntryCommand { get; }
    public ICommand UploadCommand { get; }
    public ICommand BeginNewFolderCommand { get; }
    public ICommand BeginRenameCommand { get; }
    public ICommand ConfirmNameEditorCommand { get; }
    public ICommand CancelNameEditorCommand { get; }
    public ICommand DeleteEntryCommand { get; }
    public ICommand SelectRetentionCommand { get; }
    /// <summary>«Поделиться» на строке: открывает панель и получает ссылку (rotate=false).</summary>
    public ICommand BeginShareCommand { get; }
    /// <summary>Создать ссылку в пустой панели (после отзыва): rotate=false.</summary>
    public ICommand CreateShareCommand { get; }
    /// <summary>Перевыпустить ссылку: rotate=true гасит прежнюю.</summary>
    public ICommand RotateShareCommand { get; }
    /// <summary>Отозвать публичную ссылку: строка в списке исчезает.</summary>
    public ICommand RevokeShareCommand { get; }
    /// <summary>Скопировать текущий URL через шов ClipboardSetter.</summary>
    public ICommand CopyShareLinkCommand { get; }
    public ICommand CloseSharePanelCommand { get; }
    /// <summary>Тулбарная «Корзина»: корзина текущего места (диск либо библиотека manage).</summary>
    public ICommand ShowTrashCommand { get; }
    /// <summary>«Корзина» в левой рейке — всегда личная корзина диска.</summary>
    public ICommand ShowPersonalTrashCommand { get; }
    public ICommand ShowFilesCommand { get; }
    public ICommand EmptyTrashCommand { get; }
    public ICommand RestoreEntryCommand { get; }
    public ICommand PurgeEntryCommand { get; }
    /// <summary>«Создать копию» у файла — POST /my-files/{id}/copy в текущую папку.</summary>
    public ICommand CopyEntryCommand { get; }
    /// <summary>«Скачать архивом» у папки — archive-grant + авторизованная выкачка zip.</summary>
    public ICommand DownloadArchiveCommand { get; }
    /// <summary>«Просмотр» у изображения — GET /my-files/{id}/preview + /preview/content.</summary>
    public ICommand PreviewEntryCommand { get; }
    public ICommand ClosePreviewCommand { get; }
    public ICommand NewLibraryCommand { get; }
    public ICommand EditLibraryCommand { get; }
    public ICommand LibraryMembersCommand { get; }
    public ICommand DismissBannerCommand { get; }

    /// <summary>
    /// Шов сохранения/открытия файла (как AttachmentSaver у билетов): тесты заменяют
    /// потоковое скачивание в %TEMP% + Process.Start.
    /// </summary>
    public Func<MyFileEntryViewModel, Task>? FileSaver { get; set; }

    /// <summary>
    /// Шов сохранения архива папки (SaveFileDialog у view): аргумент — запись
    /// папки; задача — скачать zip через archive-grant. null → %TEMP% + открыть ОС.
    /// </summary>
    public Func<MyFileEntryViewModel, Task>? ArchiveSaver { get; set; }

    /// <summary>
    /// Шов выбора файлов для загрузки — view ставит OpenFileDialog,
    /// тесты возвращают список путей.
    /// </summary>
    public Func<IReadOnlyList<string>>? FilePicker { get; set; }

    /// <summary>
    /// Шов ввода имени (новая папка/переименование): аргумент — текущее имя
    /// (null при создании), результат — новое имя или null при отмене.
    /// Когда шов не задан, открывается встроенный редактор имени.
    /// </summary>
    public Func<string?, Task<string?>>? FolderPicker { get; set; }

    /// <summary>Шов подтверждения удаления (MessageBox у view); null в тестах — удалять сразу.</summary>
    public Func<string, bool>? ConfirmDelete { get; set; }

    /// <summary>
    /// Шов буфера обмена для «Копировать» (Clipboard.SetText — UI-зависимость);
    /// тесты подменяют захватом строки.
    /// </summary>
    public Action<string> ClipboardSetter { get; set; } = System.Windows.Clipboard.SetText;

    /// <summary>Шов ожидания между повторами чанка (тесты подменяют Task.Delay).</summary>
    public Func<TimeSpan, CancellationToken, Task> DelayAsync { get; set; } = Task.Delay;

    /// <summary>
    /// Шов открытия исходного потока файла для загрузки; по умолчанию File.OpenRead.
    /// Внутренний — тесты подменяют MemoryStream, не создавая файлы на диске.
    /// </summary>
    internal Func<string, Stream> OpenUploadStream { get; set; } = File.OpenRead;

    // ---- Загрузка ----

    /// <summary>Локации + содержимое текущего места (ошибка — в баннер, как у соседних страниц).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        IsLoading = true;
        try
        {
            await LoadLibrariesSafelyAsync(cancellationToken);
            if (IsTrashView)
            {
                var trash = await _api.GetMyFilesTrashAsync(_trashLibraryId, cancellationToken);
                ApplyTrashPage(trash);
            }
            else
            {
                var page = await _api.GetMyFilesAsync(
                    _currentFolderId, _currentLibraryId, cancellationToken);
                ApplyPage(page);
            }

            await LoadQuotaSafelyAsync(cancellationToken);
            BannerErrorText = null;
        }
        catch (Exception ex)
        {
            BannerErrorText = TasksViewModel.DescribeError(ex);
        }
        finally
        {
            IsLoading = false;
        }
    }

    /// <summary>
    /// Библиотеки грузим один раз за сессию; их отказ не должен ломать
    /// личный диск — левая рейка тогда показывает только «Мои файлы».
    /// </summary>
    private async Task LoadLibrariesSafelyAsync(CancellationToken cancellationToken)
    {
        if (_librariesLoaded)
        {
            return;
        }

        try
        {
            var list = await _api.GetMyFileLibrariesAsync(cancellationToken);
            ApplyLibraries(list);
            _librariesLoaded = true;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch
        {
            _librariesLoaded = true;
            EnsurePersonalLocation();
        }
    }

    private void ApplyLibraries(HubMyFileLibraryList list)
    {
        _libraryById.Clear();
        Locations.Clear();
        Locations.Add(MyFilesLocationViewModel.Personal);
        foreach (var library in list.Items ?? [])
        {
            if (!string.IsNullOrEmpty(library.Id))
            {
                _libraryById[library.Id] = library;
            }

            Locations.Add(MyFilesLocationViewModel.FromLibrary(library));
        }

        CanManageLibraries = list.CanManage;
        var selected = Locations.FirstOrDefault(
            l => string.Equals(l.LibraryId, _currentLibraryId, StringComparison.Ordinal))
            ?? MyFilesLocationViewModel.Personal;
        _selectedLocation = selected;
        OnPropertyChanged(nameof(SelectedLocation));
        OnPropertyChanged(nameof(CanWrite));
        OnPropertyChanged(nameof(CanShowLocationTrash));
        OnPropertyChanged(nameof(CanManageMembersHere));
        OnPropertyChanged(nameof(CanEditCurrentLibrary));
        HeaderText = IsTrashView ? "Корзина · " + selected.Name : selected.Name;
        RaiseCommandStates();
    }

    /// <summary>GET /my-files/trash: плоский список (папки первыми), крошки — корень + «Корзина».</summary>
    private void ApplyTrashPage(HubMyFileTrash trash)
    {
        Items.Clear();
        foreach (var folder in trash.Folders ?? [])
        {
            Items.Add(MyFileEntryViewModel.FromFolder(folder, forTrash: true));
        }
        foreach (var file in trash.Items ?? [])
        {
            Items.Add(MyFileEntryViewModel.FromFile(file, forTrash: true));
        }

        Breadcrumbs.Clear();
        Breadcrumbs.Add(new MyFileCrumbViewModel(
            null, _selectedLocation?.Name ?? "Мои файлы", showSeparator: false));
        Breadcrumbs.Add(new MyFileCrumbViewModel("__trash__", "Корзина"));

        OnPropertyChanged(nameof(CanGoUp));
        ((NativeAsyncCommand)GoUpCommand).RaiseCanExecuteChanged();
        OnPropertyChanged(nameof(IsEmpty));
        ((NativeAsyncCommand)EmptyTrashCommand).RaiseCanExecuteChanged();
    }

    /// <summary>Квота только для личного диска; отказ квоты не ломает список.</summary>
    private async Task LoadQuotaSafelyAsync(CancellationToken cancellationToken)
    {
        if (_currentLibraryId is not null)
        {
            SetQuota(null);
            return;
        }

        try
        {
            SetQuota(await _api.GetMyFilesQuotaAsync(cancellationToken));
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch
        {
            SetQuota(null);
        }
    }

    private void SetQuota(HubMyFileQuota? quota)
    {
        if (Equals(_quota, quota))
        {
            return;
        }

        _quota = quota;
        OnPropertyChanged(nameof(IsQuotaVisible));
        OnPropertyChanged(nameof(QuotaPercent));
        OnPropertyChanged(nameof(QuotaText));
    }

    private void EnsurePersonalLocation()
    {
        if (Locations.Count == 0)
        {
            Locations.Add(MyFilesLocationViewModel.Personal);
            _selectedLocation = MyFilesLocationViewModel.Personal;
            OnPropertyChanged(nameof(SelectedLocation));
        }
    }

    private void ApplyPage(HubMyFileListPage page)
    {
        Items.Clear();
        foreach (var folder in page.Folders ?? [])
        {
            Items.Add(MyFileEntryViewModel.FromFolder(folder));
        }
        foreach (var file in page.Items ?? [])
        {
            Items.Add(MyFileEntryViewModel.FromFile(file));
        }

        // Путь: корень локации + цепочка папок backend'а (последняя — текущая).
        Breadcrumbs.Clear();
        Breadcrumbs.Add(new MyFileCrumbViewModel(
            null, _selectedLocation?.Name ?? "Мои файлы", showSeparator: false));
        foreach (var crumb in page.Breadcrumbs ?? [])
        {
            Breadcrumbs.Add(new MyFileCrumbViewModel(crumb.Id, crumb.Name ?? "Папка"));
        }

        OnPropertyChanged(nameof(CanGoUp));
        ((NativeAsyncCommand)GoUpCommand).RaiseCanExecuteChanged();
        OnPropertyChanged(nameof(IsEmpty));
    }

    /// <summary>Ошибка загрузки, выставленная шеллом при инициализации страниц.</summary>
    public void SetLoadError(string message)
    {
        BannerErrorText = message;
        IsLoading = false;
    }

    /// <summary>Сброс содержимого при выходе из сессии: назад к личному диску.</summary>
    public void Reset()
    {
        Locations.Clear();
        Items.Clear();
        Breadcrumbs.Clear();
        _selectedLocation = null;
        _currentLibraryId = null;
        _currentFolderId = null;
        SelectedItem = null;
        BannerErrorText = null;
        UploadStatusText = null;
        IsLoading = false;
        IsUploading = false;
        _librariesLoaded = false;
        _downloadsInFlight.Clear();
        CloseNameEditor();
        CloseSharePanel();
        ExitTrashView();
        ClosePreview();
        LibraryEditor = null;
        MembersEditor = null;
        SetQuota(null);
        CanManageLibraries = false;
        _libraryById.Clear();
        RetentionDays = 1;
        HeaderText = "Мои файлы";
        OnPropertyChanged(nameof(CanWrite));
        OnPropertyChanged(nameof(CanGoUp));
        OnPropertyChanged(nameof(SelectedLocation));
        RaiseCommandStates();
    }

    // ---- Навигация ----

    /// <summary>Выбор локации рейки: корень личного диска или корень библиотеки.</summary>
    public async Task SelectLocationAsync(
        MyFilesLocationViewModel location,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(location);
        _selectedLocation = location;
        OnPropertyChanged(nameof(SelectedLocation));
        _currentLibraryId = location.LibraryId;
        _currentFolderId = null;
        SelectedItem = null;
        ExitTrashView();
        ClosePreview();
        HeaderText = location.Name;
        OnPropertyChanged(nameof(CanWrite));
        OnPropertyChanged(nameof(CanGoUp));
        ((NativeAsyncCommand)GoUpCommand).RaiseCanExecuteChanged();
        RaiseCommandStates();
        await LoadAsync(cancellationToken);
    }

    private async Task SelectLocationSafelyAsync(MyFilesLocationViewModel location)
    {
        try
        {
            await SelectLocationAsync(location);
        }
        catch (Exception ex)
        {
            BannerErrorText = TasksViewModel.DescribeError(ex);
        }
    }

    private Task OpenEntryAsync(MyFileEntryViewModel? item, CancellationToken cancellationToken)
    {
        if (item is null || IsTrashView)
        {
            return Task.CompletedTask;
        }

        return item.IsFolder
            ? GoToFolderAsync(item.Id, cancellationToken)
            : DownloadFileAsync(item);
    }

    /// <summary>Навигация в папку (null — корень текущей локации).</summary>
    private Task GoToFolderAsync(string? folderId, CancellationToken cancellationToken)
    {
        if (IsTrashView)
        {
            // В корзине крошки «Локация › Корзина»: корень возвращает к файлам,
            // сама «Корзина» — no-op (плоский список без вложенности).
            return string.Equals(folderId, "__trash__", StringComparison.Ordinal)
                ? Task.CompletedTask
                : ShowFilesAsync(cancellationToken);
        }

        if (string.Equals(folderId, _currentFolderId, StringComparison.Ordinal)
            && Items.Count > 0)
        {
            return Task.CompletedTask;
        }

        _currentFolderId = string.IsNullOrWhiteSpace(folderId) ? null : folderId;
        SelectedItem = null;
        OnPropertyChanged(nameof(CanGoUp));
        ((NativeAsyncCommand)GoUpCommand).RaiseCanExecuteChanged();
        return LoadAsync(cancellationToken);
    }

    /// <summary>Вверх: родитель текущей папки — предпоследняя крошка (последняя — она сама).</summary>
    private Task GoUpAsync(CancellationToken cancellationToken)
    {
        var parentId = Breadcrumbs.Count >= 2
            ? Breadcrumbs[^2].FolderId
            : null;
        _currentFolderId = parentId;
        SelectedItem = null;
        OnPropertyChanged(nameof(CanGoUp));
        ((NativeAsyncCommand)GoUpCommand).RaiseCanExecuteChanged();
        return LoadAsync(cancellationToken);
    }

    // ---- Скачивание ----

    /// <summary>Скачивание через одноразовый grant → %TEMP%/hub-desktop/my-files → открыть ОС.</summary>
    private async Task DownloadFileAsync(MyFileEntryViewModel? item)
    {
        if (item is null || item.IsFolder || !item.CanOpen || string.IsNullOrEmpty(item.Id))
        {
            return;
        }

        if (!_downloadsInFlight.Add(item.Id))
        {
            return;
        }

        item.IsDownloading = true;
        try
        {
            if (FileSaver is not null)
            {
                await FileSaver(item);
                return;
            }

            var directory = Path.Combine(Path.GetTempPath(), "hub-desktop", "my-files");
            Directory.CreateDirectory(directory);
            var safeName = string.Concat(
                item.Name.Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries));
            if (safeName.Length == 0)
            {
                safeName = "file.bin";
            }

            var target = Path.Combine(directory, $"{item.Id}-{safeName}");
            await using (var destination = new FileStream(
                target, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true))
            {
                var downloadedName = await _api.DownloadMyFileAsync(
                    item.Id, destination, CancellationToken.None);
                if (!string.IsNullOrWhiteSpace(downloadedName))
                {
                    var renamed = Path.Combine(directory, $"{item.Id}-{downloadedName}");
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

            Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            BannerErrorText = TasksViewModel.DescribeError(ex);
        }
        finally
        {
            item.IsDownloading = false;
            _downloadsInFlight.Remove(item.Id);
        }
    }

    // ---- Загрузка файлов (сессия → чанки → complete) ----

    private async Task UploadAsync(CancellationToken cancellationToken)
    {
        if (FilePicker is null)
        {
            return;
        }

        var paths = FilePicker() ?? [];
        if (paths.Count == 0)
        {
            return;
        }

        IsUploading = true;
        try
        {
            for (var index = 0; index < paths.Count; index++)
            {
                var path = paths[index];
                var label = Path.GetFileName(path.Trim());
                UploadStatusText = paths.Count == 1
                    ? $"Загрузка «{label}»…"
                    : $"Загрузка «{label}» ({index + 1}/{paths.Count})…";
                await UploadOneAsync(path, cancellationToken);
            }

            UploadStatusText = null;
            await LoadAsync(cancellationToken);
            BannerErrorText = null;
        }
        catch (Exception ex)
        {
            BannerErrorText = TasksViewModel.DescribeError(ex);
        }
        finally
        {
            IsUploading = false;
            UploadStatusText = null;
        }
    }

    private async Task UploadOneAsync(string path, CancellationToken cancellationToken)
    {
        var fileName = Path.GetFileName(path.Trim());
        if (string.IsNullOrEmpty(fileName))
        {
            fileName = "file.bin";
        }

        await using var source = OpenUploadStream(path);
        Stream stream;
        if (source.CanSeek)
        {
            stream = source;
        }
        else
        {
            var buffer = new MemoryStream();
            await source.CopyToAsync(buffer, cancellationToken);
            buffer.Position = 0;
            stream = buffer;
        }

        var size = stream.Length;
        if (size <= 0)
        {
            throw new InvalidOperationException($"Файл «{fileName}» пуст — загружать нечего.");
        }

        var session = await _api.CreateMyFileUploadSessionAsync(
            new HubMyFileUploadSessionCreate
            {
                FileName = fileName,
                FileSize = size,
                RetentionDays = RetentionDays,
                MimeType = GuessMimeType(fileName),
                FolderId = _currentFolderId,
                LibraryId = _currentLibraryId,
            },
            cancellationToken);
        var fileId = session.FileId;
        if (string.IsNullOrWhiteSpace(fileId))
        {
            throw new InvalidOperationException("Сервер вернул сессию загрузки без идентификатора.");
        }

        var chunkSize = session.ChunkSizeBytes > 0
            ? session.ChunkSizeBytes
            : 8 * 1024 * 1024;
        try
        {
            foreach (var (offset, end) in BuildUploadTasks(session.Ranges, size, chunkSize))
            {
                var buffer = new byte[end - offset];
                stream.Position = offset;
                await ReadExactlyAsync(stream, buffer, cancellationToken);
                await UploadChunkWithRetryAsync(fileId, offset, buffer, cancellationToken);
            }

            await _api.CompleteMyFileUploadSessionAsync(fileId, cancellationToken);
        }
        catch (Exception ex)
        {
            // Best-effort отмена: висячая резервированная сессия жила бы до TTL на backend.
            try
            {
                await _api.CancelMyFileUploadSessionAsync(
                    fileId,
                    ex is OperationCanceledException ? "Upload cancelled" : "Upload failed",
                    CancellationToken.None);
            }
            catch
            {
            }

            throw;
        }
    }

    /// <summary>
    /// Незакрытые диапазоны файла, разбитые сеткой серверного chunk_size_bytes —
    /// как buildUploadTasks веб-клиента (resume переиспользует уже принятые ranges).
    /// </summary>
    internal static List<(long Offset, long End)> BuildUploadTasks(
        IReadOnlyList<long[]>? coveredRanges,
        long totalBytes,
        int chunkSizeBytes)
    {
        var tasks = new List<(long Offset, long End)>();
        if (totalBytes <= 0 || chunkSizeBytes <= 0)
        {
            return tasks;
        }

        var covered = new List<(long Start, long End)>();
        if (coveredRanges is not null)
        {
            foreach (var range in coveredRanges)
            {
                if (range.Length < 2)
                {
                    continue;
                }

                var start = Math.Max(0, range[0]);
                var end = Math.Min(totalBytes, range[1]);
                if (end > start)
                {
                    covered.Add((start, end));
                }
            }
        }

        covered.Sort((a, b) => a.Start.CompareTo(b.Start));
        long cursor = 0;
        foreach (var (start, end) in covered)
        {
            if (start > cursor)
            {
                for (var offset = cursor; offset < start; offset += chunkSizeBytes)
                {
                    tasks.Add((offset, Math.Min(start, offset + chunkSizeBytes)));
                }
            }

            cursor = Math.Max(cursor, end);
        }

        for (var offset = cursor; offset < totalBytes; offset += chunkSizeBytes)
        {
            tasks.Add((offset, Math.Min(totalBytes, offset + chunkSizeBytes)));
        }

        return tasks;
    }

    private async Task UploadChunkWithRetryAsync(
        string fileId,
        long offset,
        byte[] data,
        CancellationToken cancellationToken)
    {
        try
        {
            await _api.UploadMyFileChunkAsync(fileId, offset, data, cancellationToken);
            return;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            // Одна пауза и повтор — transient сбой сети/таймаута на первом срезе.
            await DelayAsync(ChunkRetryDelay, cancellationToken);
        }

        await _api.UploadMyFileChunkAsync(fileId, offset, data, cancellationToken);
    }

    private static async Task ReadExactlyAsync(
        Stream stream,
        byte[] buffer,
        CancellationToken cancellationToken)
    {
        var read = 0;
        while (read < buffer.Length)
        {
            var chunk = await stream.ReadAsync(
                buffer.AsMemory(read, buffer.Length - read), cancellationToken);
            if (chunk == 0)
            {
                throw new EndOfStreamException("Локальный файл закончился раньше ожидаемого размера.");
            }

            read += chunk;
        }
    }

    /// <summary>mime по расширению (как file.type у браузера); редкое — octet-stream.</summary>
    private static string GuessMimeType(string fileName)
    {
        var extension = Path.GetExtension(fileName)?.ToLowerInvariant() ?? string.Empty;
        return extension switch
        {
            ".pdf" => "application/pdf",
            ".txt" or ".md" => "text/plain",
            ".csv" => "text/csv",
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".gif" => "image/gif",
            ".webp" => "image/webp",
            ".svg" => "image/svg+xml",
            ".mp4" => "video/mp4",
            ".mp3" => "audio/mpeg",
            ".zip" => "application/zip",
            ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            ".doc" => "application/msword",
            ".xls" => "application/vnd.ms-excel",
            ".ppt" => "application/vnd.ms-powerpoint",
            _ => "application/octet-stream",
        };
    }

    // ---- Создание папки / переименование / удаление ----

    private async Task BeginNewFolderAsync(CancellationToken cancellationToken)
    {
        if (FolderPicker is not null)
        {
            var name = await FolderPicker(null);
            if (!string.IsNullOrWhiteSpace(name))
            {
                await CreateFolderAsync(name.Trim(), cancellationToken);
            }

            return;
        }

        _renameTarget = null;
        NameEditorTitle = "Новая папка";
        NameEditorConfirmText = "Создать";
        NameEditorText = string.Empty;
        IsNameEditorOpen = true;
    }

    private async Task BeginRenameAsync(MyFileEntryViewModel? item, CancellationToken cancellationToken)
    {
        if (item is null)
        {
            return;
        }

        if (FolderPicker is not null)
        {
            var name = await FolderPicker(item.Name);
            if (!string.IsNullOrWhiteSpace(name)
                && !string.Equals(name.Trim(), item.Name, StringComparison.Ordinal))
            {
                await RenameEntryAsync(item, name.Trim(), cancellationToken);
            }

            return;
        }

        _renameTarget = item;
        NameEditorTitle = item.IsFolder ? "Переименовать папку" : "Переименовать файл";
        NameEditorConfirmText = "Сохранить";
        NameEditorText = item.Name;
        IsNameEditorOpen = true;
    }

    private async Task ConfirmNameEditorAsync(CancellationToken cancellationToken)
    {
        var name = NameEditorText.Trim();
        if (name.Length == 0)
        {
            return;
        }

        var target = _renameTarget;
        if (target is null)
        {
            await CreateFolderAsync(name, cancellationToken);
        }
        else if (!string.Equals(name, target.Name, StringComparison.Ordinal))
        {
            await RenameEntryAsync(target, name, cancellationToken);
        }

        CloseNameEditor();
        BannerErrorText = null;
    }

    private void CloseNameEditor()
    {
        _renameTarget = null;
        IsNameEditorOpen = false;
    }

    private async Task CreateFolderAsync(string name, CancellationToken cancellationToken)
    {
        await _api.CreateMyFileFolderAsync(
            name, _currentFolderId, _currentLibraryId, cancellationToken);
        await LoadAsync(cancellationToken);
    }

    private async Task RenameEntryAsync(
        MyFileEntryViewModel item,
        string name,
        CancellationToken cancellationToken)
    {
        if (item.IsFolder)
        {
            await _api.RenameMyFileFolderAsync(item.Id, name, cancellationToken);
        }
        else
        {
            await _api.RenameMyFileAsync(item.Id, name, cancellationToken);
        }

        await LoadAsync(cancellationToken);
    }

    private async Task DeleteEntryAsync(MyFileEntryViewModel? item, CancellationToken cancellationToken)
    {
        if (item is null || string.IsNullOrEmpty(item.Id))
        {
            return;
        }

        var prompt = item.IsFolder
            ? $"Удалить папку «{item.Name}»? Она будет перемещена в корзину."
            : $"Удалить файл «{item.Name}»? Он будет перемещён в корзину.";
        if (ConfirmDelete is not null && !ConfirmDelete(prompt))
        {
            return;
        }

        if (item.IsFolder)
        {
            await _api.DeleteMyFileFolderAsync(item.Id, cancellationToken);
        }
        else
        {
            await _api.DeleteMyFileAsync(item.Id, cancellationToken);
        }

        if (ReferenceEquals(SelectedItem, item))
        {
            SelectedItem = null;
        }

        await LoadAsync(cancellationToken);
        BannerErrorText = null;
    }

    // ---- Публичная ссылка (шаринг) ----

    /// <summary>
    /// «Поделиться» на строке: POST …/share?rotate=false — backend вернёт
    /// действующую ссылку или создаст новую (как кнопка в веб-клиенте).
    /// </summary>
    private async Task OpenSharePanelAsync(
        MyFileEntryViewModel? item,
        CancellationToken cancellationToken)
    {
        if (item is null || string.IsNullOrEmpty(item.Id))
        {
            return;
        }

        IsShareBusy = true;
        try
        {
            var share = await CreateShareAsync(item, rotate: false, cancellationToken);
            // Цель и подпись меняем только при успехе: при ошибке открытая панель
            // продолжает показывать прежний объект, а не чужое имя.
            _shareTarget = item;
            ShareTargetText = item.IsFolder ? $"Папка «{item.Name}»" : item.Name;
            ApplyShare(item, share);
            IsSharePanelOpen = true;
            ShareLinkCopied = false;
            BannerErrorText = null;
        }
        finally
        {
            IsShareBusy = false;
        }
    }

    /// <summary>Создать (rotate=false после отзыва) или перевыпустить (rotate=true) ссылку.</summary>
    private async Task ReplaceShareAsync(bool rotate, CancellationToken cancellationToken)
    {
        var target = _shareTarget;
        if (target is null)
        {
            return;
        }

        IsShareBusy = true;
        try
        {
            var share = await CreateShareAsync(target, rotate, cancellationToken);
            ApplyShare(target, share);
            ShareLinkCopied = false;
            BannerErrorText = null;
        }
        finally
        {
            IsShareBusy = false;
        }
    }

    /// <summary>Отзыв ссылки: строка исчезает из списка, флаг is_shared снимается со строки.</summary>
    private async Task RevokeShareAsync(CancellationToken cancellationToken)
    {
        var target = _shareTarget;
        if (target is null)
        {
            return;
        }

        IsShareBusy = true;
        try
        {
            if (target.IsFolder)
            {
                await _api.RevokeMyFileFolderShareAsync(target.Id, cancellationToken);
            }
            else
            {
                await _api.RevokeMyFileShareAsync(target.Id, cancellationToken);
            }

            ShareLinks.Clear();
            ShareUrl = string.Empty;
            ShareLinkCopied = false;
            target.IsShared = false;
            BannerErrorText = null;
        }
        finally
        {
            IsShareBusy = false;
        }
    }

    private Task<HubMyFileShare> CreateShareAsync(
        MyFileEntryViewModel item,
        bool rotate,
        CancellationToken cancellationToken) =>
        item.IsFolder
            ? _api.CreateMyFileFolderShareAsync(item.Id, rotate, cancellationToken)
            : _api.CreateMyFileShareAsync(item.Id, rotate, cancellationToken);

    private void ApplyShare(MyFileEntryViewModel item, HubMyFileShare share)
    {
        var url = BuildShareUrl(item, share);
        ShareUrl = url;
        ShareLinks.Clear();
        if (url.Length > 0)
        {
            ShareLinks.Add(MyFileShareLinkViewModel.Create(url, share.ExpiresAt));
        }

        item.IsShared = true;
    }

    /// <summary>
    /// public_path ответа — маршрут веб-портала («/shared-files/{token}») от origin:
    /// BaseUri клиента по контракту содержит только origin. Пустой public_path
    /// восстанавливаем из token; абсолютный URL нужен кнопке «Копировать».
    /// </summary>
    private string BuildShareUrl(MyFileEntryViewModel item, HubMyFileShare share)
    {
        var path = (share.PublicPath ?? string.Empty).Trim();
        if (path.Length == 0)
        {
            var token = (share.Token ?? string.Empty).Trim();
            if (token.Length == 0)
            {
                return string.Empty;
            }

            path = (item.IsFolder ? "/shared-folders/" : "/shared-files/")
                + Uri.EscapeDataString(token);
        }

        if (Uri.TryCreate(path, UriKind.Absolute, out var absolute))
        {
            return absolute.AbsoluteUri;
        }

        return new Uri(_api.BaseUri, path).AbsoluteUri;
    }

    private void CopyShareLink()
    {
        if (ShareUrl.Length == 0)
        {
            return;
        }

        try
        {
            ClipboardSetter(ShareUrl);
            ShareLinkCopied = true;
        }
        catch
        {
            // Буфер обмена бывает занят: ссылка остаётся выделяемой вручную.
            ShareLinkCopied = false;
            BannerErrorText = "Не удалось скопировать — выделите ссылку и скопируйте вручную.";
        }
    }

    private void CloseSharePanel()
    {
        IsSharePanelOpen = false;
        _shareTarget = null;
        ShareLinks.Clear();
        ShareUrl = string.Empty;
        ShareLinkCopied = false;
    }

    // ---- Корзина ----

    /// <summary>
    /// Переход в корзину текущего места (диск или manage-библиотека).
    /// forcePersonal — «Корзина» левой рейки, всегда корзина диска.
    /// </summary>
    private async Task ShowTrashAsync(bool forcePersonal, CancellationToken cancellationToken)
    {
        _trashLibraryId = forcePersonal ? null : _currentLibraryId;
        if (forcePersonal)
        {
            _selectedLocation = MyFilesLocationViewModel.Personal;
            _currentLibraryId = null;
            OnPropertyChanged(nameof(SelectedLocation));
            OnPropertyChanged(nameof(CanWrite));
        }

        _currentFolderId = null;
        SelectedItem = null;
        _emptyTrashArmed = false;
        OnPropertyChanged(nameof(EmptyTrashText));
        IsTrashView = true;
        OnPropertyChanged(nameof(CanShowLocationTrash));
        OnPropertyChanged(nameof(CanManageMembersHere));
        OnPropertyChanged(nameof(CanEditCurrentLibrary));
        HeaderText = "Корзина · " + (_selectedLocation?.Name ?? "Мои файлы");
        OnPropertyChanged(nameof(CanGoUp));
        ((NativeAsyncCommand)GoUpCommand).RaiseCanExecuteChanged();
        RaiseCommandStates();
        await LoadAsync(cancellationToken);
    }

    /// <summary>«К файлам» — выход из корзины в корень той же локации.</summary>
    private Task ShowFilesAsync(CancellationToken cancellationToken)
    {
        ExitTrashView();
        _currentFolderId = null;
        SelectedItem = null;
        HeaderText = _selectedLocation?.Name ?? "Мои файлы";
        OnPropertyChanged(nameof(CanShowLocationTrash));
        OnPropertyChanged(nameof(CanManageMembersHere));
        OnPropertyChanged(nameof(CanEditCurrentLibrary));
        OnPropertyChanged(nameof(CanGoUp));
        ((NativeAsyncCommand)GoUpCommand).RaiseCanExecuteChanged();
        RaiseCommandStates();
        return LoadAsync(cancellationToken);
    }

    private void ExitTrashView()
    {
        if (!IsTrashView && !_emptyTrashArmed)
        {
            return;
        }

        IsTrashView = false;
        _trashLibraryId = null;
        _emptyTrashArmed = false;
        OnPropertyChanged(nameof(EmptyTrashText));
    }

    /// <summary>POST /my-files/trash/empty — armed: второе нажатие очищает корзину.</summary>
    private async Task EmptyTrashAsync(CancellationToken cancellationToken)
    {
        if (!_emptyTrashArmed)
        {
            _emptyTrashArmed = true;
            OnPropertyChanged(nameof(EmptyTrashText));
            return;
        }

        _emptyTrashArmed = false;
        OnPropertyChanged(nameof(EmptyTrashText));
        await _api.EmptyMyFilesTrashAsync(_trashLibraryId, cancellationToken);
        await LoadAsync(cancellationToken);
    }

    /// <summary>Восстановить запись из корзины в исходное место (restore endpoints).</summary>
    private async Task RestoreEntryAsync(MyFileEntryViewModel? item, CancellationToken cancellationToken)
    {
        if (item is null || !IsTrashView)
        {
            return;
        }

        if (item.IsFolder)
        {
            await _api.RestoreMyFileFolderAsync(item.Id, cancellationToken);
        }
        else
        {
            await _api.RestoreMyFileAsync(item.Id, cancellationToken);
        }

        await LoadAsync(cancellationToken);
    }

    /// <summary>Удаление навсегда — armed на записи: «Удалить навсегда» → «Удалить?».</summary>
    private async Task PurgeEntryAsync(MyFileEntryViewModel? item, CancellationToken cancellationToken)
    {
        if (item is null || !IsTrashView)
        {
            return;
        }

        if (!item.ArmPurge())
        {
            return;
        }

        if (item.IsFolder)
        {
            await _api.PurgeMyFileFolderAsync(item.Id, cancellationToken);
        }
        else
        {
            await _api.PurgeMyFileAsync(item.Id, cancellationToken);
        }

        await LoadAsync(cancellationToken);
    }

    // ---- Копия и архив ----

    /// <summary>POST /my-files/{id}/copy — копия файла в текущую папку текущего места.</summary>
    private async Task CopyEntryAsync(MyFileEntryViewModel? item, CancellationToken cancellationToken)
    {
        if (item is null || item.IsFolder || !item.CanOpen)
        {
            return;
        }

        await _api.CopyMyFileAsync(item.Id, _currentFolderId, _currentLibraryId, cancellationToken);
        await LoadAsync(cancellationToken);
    }

    /// <summary>
    /// POST /my-files/folders/{id}/archive-grant + авторизованный GET download_path.
    /// View подставляет SaveFileDialog; без шва — %TEMP%/hub-desktop/my-files + ОС.
    /// </summary>
    private async Task DownloadFolderArchiveAsync(MyFileEntryViewModel? item)
    {
        if (item is null || !item.IsFolder)
        {
            return;
        }

        if (ArchiveSaver is not null)
        {
            await ArchiveSaver(item);
            return;
        }

        var directory = Path.Combine(Path.GetTempPath(), "hub-desktop", "my-files");
        Directory.CreateDirectory(directory);
        var safeName = string.Concat(
            (item.Name + ".zip").Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries));
        if (safeName.Length == 0)
        {
            safeName = "archive.zip";
        }

        var target = Path.Combine(directory, $"{item.Id}-{safeName}");
        await using (var destination = new FileStream(
            target, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true))
        {
            await _api.DownloadMyFileFolderArchiveAsync(item.Id, destination, CancellationToken.None);
        }

        Process.Start(new ProcessStartInfo { FileName = target, UseShellExecute = true });
    }

    // ---- Предпросмотр изображения ----

    /// <summary>
    /// GET /my-files/{id}/preview: image → авторизованное скачивание /preview/content
    /// в BitmapImage. Текст/PDF/xlsx не показываем (skipped scope) — баннер-подсказка.
    /// </summary>
    private async Task PreviewEntryAsync(MyFileEntryViewModel? item, CancellationToken cancellationToken)
    {
        if (item is null || item.IsFolder)
        {
            return;
        }

        IsPreviewLoading = true;
        PreviewTitle = item.Name;
        try
        {
            var meta = await _api.GetMyFilePreviewAsync(item.Id, cancellationToken);
            var kind = (meta.PreviewKind ?? string.Empty).Trim();
            if (!string.Equals(kind, "image", StringComparison.OrdinalIgnoreCase)
                || meta.PreviewUrl is null)
            {
                BannerErrorText = "Предпросмотр этого типа пока не поддержан — откройте файл скачиванием.";
                return;
            }

            await using var stream = new MemoryStream();
            await _api.DownloadMyFilePreviewContentAsync(item.Id, stream, cancellationToken);
            stream.Position = 0;
            var bitmap = new BitmapImage();
            bitmap.BeginInit();
            bitmap.CacheOption = BitmapCacheOption.OnLoad;
            bitmap.StreamSource = stream;
            bitmap.EndInit();
            bitmap.Freeze();
            PreviewImage = bitmap;
            IsPreviewOpen = true;
        }
        finally
        {
            IsPreviewLoading = false;
        }
    }

    private void ClosePreview()
    {
        IsPreviewOpen = false;
        PreviewImage = null;
        IsPreviewLoading = false;
    }

    // ---- Библиотеки: редакторы ----

    /// <summary>«+ Общая папка» (null) или «Настроить» у открытой библиотеки.</summary>
    private void OpenLibraryEditor(HubMyFileLibrary? source)
    {
        var editor = source is null
            ? new MyFilesLibraryEditorViewModel(_api)
            : new MyFilesLibraryEditorViewModel(_api, source);
        editor.Saved += _library =>
        {
            LibraryEditor = null;
            _librariesLoaded = false;
            _ = ReloadSafelyAsync();
        };
        editor.Deleted += _library =>
        {
            LibraryEditor = null;
            _librariesLoaded = false;
            _ = SelectLocationSafelyAsync(MyFilesLocationViewModel.Personal);
        };
        editor.Closed += () => LibraryEditor = null;
        LibraryEditor = editor;
    }

    /// <summary>«Участники» открытой библиотеки — GET members + поиск сотрудников/отделов.</summary>
    private async Task OpenMembersEditorAsync(CancellationToken cancellationToken)
    {
        if (_currentLibraryId is not { } id || !_libraryById.TryGetValue(id, out var library))
        {
            return;
        }

        var editor = new MyFilesLibraryMembersViewModel(_api, library);
        // Сохранение не закрывает диалог («Сохранено»): рейку обновляем в фоне —
        // у библиотеки мог измениться members_count.
        editor.Saved += () =>
        {
            _librariesLoaded = false;
            _ = ReloadSafelyAsync();
        };
        editor.Closed += () => MembersEditor = null;
        MembersEditor = editor;
        await editor.LoadAsync(cancellationToken);
    }

    /// <summary>Перечитать файлы/библиотеки после правок диалогов (ошибки — в баннер).</summary>
    private async Task ReloadSafelyAsync()
    {
        try
        {
            await LoadAsync();
        }
        catch (Exception ex)
        {
            BannerErrorText = TasksViewModel.DescribeError(ex);
        }
    }

    // ---- Служебное ----

    /// <summary>«1,2 МБ» — тот же формат, что у вложений почты/чата.</summary>
    internal static string FormatSize(long bytes) =>
        bytes <= 0 ? "0 Б" : bytes switch
        {
            < 1024 => $"{bytes} Б",
            < 1024 * 1024 => $"{bytes / 1024.0:0.#} КБ",
            < 1024L * 1024 * 1024 => $"{bytes / (1024.0 * 1024):0.#} МБ",
            _ => $"{bytes / (1024.0 * 1024 * 1024):0.#} ГБ",
        };

    private void RaiseCommandStates()
    {
        ((NativeAsyncCommand)UploadCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)BeginNewFolderCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)BeginRenameCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)DeleteEntryCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)DownloadEntryCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)OpenEntryCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)BeginShareCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)ShowTrashCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)ShowPersonalTrashCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)ShowFilesCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)EmptyTrashCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)RestoreEntryCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)PurgeEntryCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)CopyEntryCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)DownloadArchiveCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)PreviewEntryCommand).RaiseCanExecuteChanged();
        ((NativeRelayCommand)EditLibraryCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)LibraryMembersCommand).RaiseCanExecuteChanged();
    }
}

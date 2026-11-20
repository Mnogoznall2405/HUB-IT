using System.Globalization;
using System.IO;
using System.Windows.Media.Imaging;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native;

/// <summary>
/// Общий загрузчик картинок с Bearer-авторизацией: качает байты через
/// IHubApiClient.DownloadImageAsync, декодирует в замороженный BitmapImage
/// (безопасен на любом потоке) и кэширует результат. LRU-кэш ограничен,
/// параллельные запросы одного ключа дедуплицируются — один сетевой вызов.
/// Ошибки (404, сеть, битый контент) не поднимаются в UI: возвращаем null,
/// представление остаётся на инициалах/иконке.
/// </summary>
public sealed class AuthImageLoader
{
    /// <summary>Верх кэша: самые давно неиспользуемые записи вытесняются.</summary>
    public const int DefaultCapacity = 200;

    private readonly IHubApiClient _api;
    private readonly int _capacity;
    private readonly object _gate = new();
    private readonly LinkedList<string> _lru = new();
    private readonly Dictionary<string, CacheEntry> _entries = new(StringComparer.Ordinal);

    private sealed class CacheEntry
    {
        public required LinkedListNode<string> Node { get; init; }
        public required Task<BitmapImage?> ImageTask { get; init; }
    }

    public AuthImageLoader(IHubApiClient api, int capacity = DefaultCapacity)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _capacity = Math.Max(1, capacity);
    }

    /// <summary>Число записей в кэше — для диагностики и тестов.</summary>
    public int CachedCount
    {
        get
        {
            lock (_gate)
            {
                return _entries.Count;
            }
        }
    }

    /// <summary>
    /// Загрузить картинку по пути/URL. decodePixelWidth &gt; 0 — даунскейл при
    /// декоде (превью галереи чата ~256); ширина входит в ключ кэша.
    /// Пустой путь → null без запроса.
    /// </summary>
    public Task<BitmapImage?> LoadAsync(
        string? uriOrPath,
        int decodePixelWidth = 0,
        CancellationToken cancellationToken = default)
    {
        var path = (uriOrPath ?? string.Empty).Trim();
        if (path.Length == 0)
        {
            return Task.FromResult<BitmapImage?>(null);
        }

        var key = decodePixelWidth > 0
            ? decodePixelWidth.ToString(CultureInfo.InvariantCulture) + "|" + path
            : path;
        lock (_gate)
        {
            if (_entries.TryGetValue(key, out var hit))
            {
                Touch(hit);
                return hit.ImageTask;
            }

            // Задача кладётся в кэш до первого await: повторный запрос ключа
            // (в т.ч. параллельный) ждёт тот же самый сетевой вызов.
            var task = LoadCoreAsync(path, decodePixelWidth, cancellationToken);
            var node = _lru.AddLast(key);
            _entries.Add(key, new CacheEntry { Node = node, ImageTask = task });
            while (_lru.Count > _capacity)
            {
                var eldest = _lru.First!;
                _lru.RemoveFirst();
                _entries.Remove(eldest.Value);
            }

            return task;
        }
    }

    /// <summary>Сброс кэша целиком — logout/смена пользователя (чужие фото не остаются).</summary>
    public void Clear()
    {
        lock (_gate)
        {
            _lru.Clear();
            _entries.Clear();
        }
    }

    /// <summary>Свежесть записи: попадание поднимает её над чередой вытеснения.</summary>
    private void Touch(CacheEntry entry)
    {
        _lru.Remove(entry.Node);
        _lru.AddLast(entry.Node);
    }

    private async Task<BitmapImage?> LoadCoreAsync(
        string path,
        int decodePixelWidth,
        CancellationToken cancellationToken)
    {
        try
        {
            var bytes = await _api.DownloadImageAsync(path, cancellationToken);
            if (bytes is not { Length: > 0 })
            {
                return null;
            }

            return DecodeImage(bytes, decodePixelWidth);
        }
        catch
        {
            // 404/сеть/отмена — без фото: UI показывает инициалы или иконку.
            return null;
        }
    }

    /// <summary>
    /// Байты → BitmapImage: OnLoad читает поток целиком в EndInit (stream можно
    /// сразу закрыть), Freeze делает результат пригодным для любого потока.
    /// </summary>
    private static BitmapImage? DecodeImage(byte[] bytes, int decodePixelWidth)
    {
        try
        {
            var image = new BitmapImage();
            using var stream = new MemoryStream(bytes, writable: false);
            image.BeginInit();
            image.CacheOption = BitmapCacheOption.OnLoad;
            if (decodePixelWidth > 0)
            {
                image.DecodePixelWidth = decodePixelWidth;
            }

            image.StreamSource = stream;
            image.EndInit();
            image.Freeze();
            return image;
        }
        catch
        {
            return null;
        }
    }
}

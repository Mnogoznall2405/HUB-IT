namespace Hub.Desktop.Native.Api;

/// <summary>
/// Хранилище bearer-сессии нативного клиента (DPAPI-файл в профиле пользователя).
/// Сессия независима от WebView2-cookie: ротация refresh-токена атомарна,
/// совместное использование web-токена невозможно.
/// </summary>
public interface INativeSessionStore
{
    Task<NativeSession?> LoadAsync(CancellationToken cancellationToken);

    /// <summary>Атомарная замена всей сессии (access+refresh+device id пишутся одним файлом).</summary>
    Task SaveAsync(NativeSession session, CancellationToken cancellationToken);

    Task ClearAsync(CancellationToken cancellationToken);

    /// <summary>Стабильный X-Client-Device-ID установки; создаётся один раз и персистится.</summary>
    Task<string> GetOrCreateClientDeviceIdAsync(CancellationToken cancellationToken);
}

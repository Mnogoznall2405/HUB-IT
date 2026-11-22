namespace Hub.Desktop.Native.Voice;

/// <summary>
/// Причина отказа старта записи: нет устройства, нет разрешения, прочее.
/// UI мапит на человекочитаемый баннер (UI-028).
/// </summary>
public enum NativeVoiceStartError
{
    /// <summary>Микрофона нет или он занят — записывать нечего.</summary>
    NoDevice,

    /// <summary>Windows/политика не дала доступ к микрофону.</summary>
    PermissionDenied,

    /// <summary>Запись недоступна по иной причине (сервис, драйвер).</summary>
    Unavailable,
}

/// <summary>Отказ старта записи — типизированная причина для баннера.</summary>
public sealed class NativeVoiceStartException : Exception
{
    public NativeVoiceStartException(NativeVoiceStartError kind, Exception inner)
        : base(inner.Message, inner)
    {
        Kind = kind;
    }

    public NativeVoiceStartError Kind { get; }
}

/// <summary>Готовая запись: файл на диске, mime для манифеста и длительность.</summary>
public sealed record NativeVoiceRecording(string FilePath, string MimeType, TimeSpan Duration);

/// <summary>
/// Шов над рекордером (UI-028): прод — MediaCapture/AAC, тесты — фейк.
/// Start бросает <see cref="NativeVoiceStartException"/>; Stop возвращает
/// записанный файл; Abort молча рвёт запись без результата. Один экземпляр —
/// одна сессия записи: после Stop/Abort объект не переиспользуется.
/// </summary>
public interface INativeVoiceRecorder : IDisposable
{
    /// <summary>Открыть микрофон и начать запись.</summary>
    Task StartAsync(CancellationToken cancellationToken);

    /// <summary>Завершить запись и вернуть файл с длительностью.</summary>
    Task<NativeVoiceRecording> StopAsync(CancellationToken cancellationToken);

    /// <summary>Обрыв без результата (отмена, смена диалога, выход).</summary>
    void Abort();

    /// <summary>Текущая длительность записи — для строки «Запись m:ss».</summary>
    TimeSpan Elapsed { get; }
}

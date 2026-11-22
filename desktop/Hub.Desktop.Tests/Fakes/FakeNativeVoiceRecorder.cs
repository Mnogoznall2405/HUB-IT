using Hub.Desktop.Native.Voice;

namespace Hub.Desktop.Tests.Fakes;

/// <summary>
/// Фейк рекордера (UI-028): запоминает жизненный цикл (Start/Stop/Abort/
/// Dispose), умеет падать заданной ошибкой старта и на Stop пишет реальный
/// temp-файл — VM считает размер и чанки по настоящим байтам. Файл удаляет
/// сам VM после отправки/отмены — тесты это и проверяют.
/// </summary>
public sealed class FakeNativeVoiceRecorder : INativeVoiceRecorder
{
    private TimeSpan _elapsed;

    public bool Started { get; private set; }
    public bool Stopped { get; private set; }
    public bool Aborted { get; private set; }
    public bool Disposed { get; private set; }

    /// <summary>Ошибка старта — например NativeVoiceStartException(NoDevice).</summary>
    public Exception? StartException { get; set; }

    /// <summary>Байты записанного «файла» — чанки режутся по ним.</summary>
    public byte[] RecordingBytes { get; set; } = [9, 8, 7, 6, 5];

    public string RecordingMime { get; set; } = "audio/mp4";
    public TimeSpan RecordingDuration { get; set; } = TimeSpan.FromSeconds(7);

    /// <summary>Путь, который вернул последний Stop — тест чистит, если VM не удалил.</summary>
    public string? LastRecordingPath { get; private set; }

    public TimeSpan Elapsed => _elapsed;

    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (StartException is not null)
        {
            return Task.FromException(StartException);
        }

        Started = true;
        _elapsed = TimeSpan.FromSeconds(3);
        return Task.CompletedTask;
    }

    public Task<NativeVoiceRecording> StopAsync(CancellationToken cancellationToken)
    {
        Stopped = true;
        var path = Path.Combine(Path.GetTempPath(), $"hub-voice-test-{Guid.NewGuid():N}.m4a");
        File.WriteAllBytes(path, RecordingBytes);
        LastRecordingPath = path;
        return Task.FromResult(new NativeVoiceRecording(path, RecordingMime, RecordingDuration));
    }

    public void Abort() => Aborted = true;

    public void Dispose() => Disposed = true;
}

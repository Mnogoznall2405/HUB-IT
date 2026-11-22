using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using Windows.Media.Capture;
using Windows.Media.MediaProperties;
using Windows.Storage.Streams;

namespace Hub.Desktop.Native.Voice;

/// <summary>
/// Рекордер на Windows.Media.Capture (UI-028): AAC в .m4a — компактно,
/// играется встроенным MediaElement (.mp4/.m4a в белом списке UI-026)
/// и совпадает с web-форматом audio/mp4. Запись идёт в память, на Stop
/// сбрасывается в %TEMP%/hub-desktop/voice — временный файл удаляется
/// после отправки/отмены VM'ом.
/// </summary>
public sealed class MediaCaptureVoiceRecorder : INativeVoiceRecorder
{
    private MediaCapture? _capture;
    private InMemoryRandomAccessStream? _stream;
    private readonly Stopwatch _elapsed = new();
    private bool _disposed;

    public TimeSpan Elapsed => _elapsed.Elapsed;

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var capture = new MediaCapture();
        try
        {
            await capture.InitializeAsync(new MediaCaptureInitializationSettings
            {
                StreamingCaptureMode = StreamingCaptureMode.Audio,
            }).AsTask(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            capture.Dispose();
            throw new NativeVoiceStartException(MapStartError(ex), ex);
        }

        _capture = capture;
        _stream = new InMemoryRandomAccessStream();
        try
        {
            await _capture.StartRecordToStreamAsync(
                MediaEncodingProfile.CreateM4a(AudioEncodingQuality.Medium),
                _stream).AsTask(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Cleanup();
            throw new NativeVoiceStartException(MapStartError(ex), ex);
        }

        _elapsed.Restart();
    }

    public async Task<NativeVoiceRecording> StopAsync(CancellationToken cancellationToken)
    {
        if (_capture is null || _stream is null)
        {
            throw new InvalidOperationException("Запись не была начата.");
        }

        _elapsed.Stop();
        await _capture.StopRecordAsync().AsTask(cancellationToken);

        var directory = Path.Combine(Path.GetTempPath(), "hub-desktop", "voice");
        Directory.CreateDirectory(directory);
        var path = Path.Combine(
            directory, $"voice_{DateTimeOffset.UtcNow:yyyyMMdd_HHmmss}_{Guid.NewGuid():N}.m4a");
        using (var reader = new DataReader(_stream.GetInputStreamAt(0)))
        {
            _ = await reader.LoadAsync((uint)_stream.Size).AsTask(cancellationToken);
            var bytes = new byte[_stream.Size];
            reader.ReadBytes(bytes);
            await File.WriteAllBytesAsync(path, bytes, cancellationToken);
        }

        var duration = _elapsed.Elapsed;
        Cleanup();
        return new NativeVoiceRecording(path, "audio/mp4", duration);
    }

    public void Abort()
    {
        _elapsed.Stop();
        if (_capture is not null)
        {
            // Stop без await: обрыв должен быть синхронным и безопасным —
            // ошибки остановки при отмене не имеют значения.
            _ = _capture.StopRecordAsync();
        }

        Cleanup();
    }

    public void Dispose()
    {
        _disposed = true;
        Abort();
    }

    private void Cleanup()
    {
        _elapsed.Stop();
        _stream?.Dispose();
        _stream = null;
        _capture?.Dispose();
        _capture = null;
    }

    /// <summary>Маппинг HRESULT'ов захвата на причину для баннера.</summary>
    private static NativeVoiceStartError MapStartError(Exception ex) => ex switch
    {
        // E_ACCESSDENIED — политика/приватность Windows закрыла микрофон.
        UnauthorizedAccessException => NativeVoiceStartError.PermissionDenied,
        // MF_E_NO_CAPTURE_DEVICES_AVAILABLE (0xC00DABE0) и ERROR_NOT_FOUND
        // (0x80070490) — устройства нет в системе или оно отключено.
        COMException { HResult: unchecked((int)0xC00DABE0) or unchecked((int)0x80070490) }
            => NativeVoiceStartError.NoDevice,
        _ => NativeVoiceStartError.Unavailable,
    };
}

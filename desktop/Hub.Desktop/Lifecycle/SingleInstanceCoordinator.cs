using System.IO;
using System.IO.Pipes;
using System.Security.Principal;
using System.Text;
using Hub.Desktop.DeepLinks;
using Hub.Desktop.Diagnostics;

namespace Hub.Desktop.Lifecycle;

public sealed class SingleInstanceCoordinator : IDisposable
{
    private const string DefaultApplicationId = "HUBIT.Desktop";
    private const string ActivateCommand = "ACTIVATE";
    private const string OpenDownloadsCommand = "OPEN_DOWNLOADS";
    private const string RouteCommandPrefix = "ROUTE:";
    private const int MaximumCommandLength = DesktopDeepLinkParser.MaximumInputLength + 16;
    private readonly CancellationTokenSource _listenerCancellation = new();
    private readonly Mutex _mutex;
    private readonly string _pipeName;
    private readonly bool _ownsMutex;
    private Task? _listenerTask;
    private bool _disposed;

    public SingleInstanceCoordinator()
        : this(DefaultApplicationId)
    {
    }

    internal SingleInstanceCoordinator(string applicationId)
    {
        var instanceName = BuildInstanceName(applicationId);
        _pipeName = instanceName;
        _mutex = new Mutex(initiallyOwned: true, $"Local\\{instanceName}", out var createdNew);
        _ownsMutex = createdNew;
        IsPrimary = createdNew;
    }

    public event EventHandler<DesktopLaunchRequestEventArgs>? ActivationRequested;

    public bool IsPrimary { get; }

    public void StartListening()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        if (!IsPrimary)
        {
            throw new InvalidOperationException("Only the primary instance can listen for activation.");
        }

        _listenerTask ??= ListenAsync(_listenerCancellation.Token);
    }

    public Task<bool> SignalPrimaryAsync(CancellationToken cancellationToken = default) =>
        SignalPrimaryAsync(DesktopLaunchRequest.Default, cancellationToken);

    public async Task<bool> SignalPrimaryAsync(
        DesktopLaunchRequest request,
        CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        ArgumentNullException.ThrowIfNull(request);

        if (IsPrimary)
        {
            throw new InvalidOperationException("The primary instance cannot signal itself.");
        }

        try
        {
            using var client = new NamedPipeClientStream(
                ".",
                _pipeName,
                PipeDirection.Out,
                PipeOptions.Asynchronous);
            await client.ConnectAsync(timeout: 3000, cancellationToken);

            await using var writer = new StreamWriter(
                client,
                new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
                bufferSize: 256,
                leaveOpen: false);
            await writer.WriteLineAsync(CreateActivationCommand(request));
            await writer.FlushAsync(cancellationToken);
            return true;
        }
        catch (Exception exception) when (exception is IOException or TimeoutException or OperationCanceledException)
        {
            DesktopLog.Error("Primary instance activation failed", exception);
            return false;
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _listenerCancellation.Cancel();
        _listenerCancellation.Dispose();

        if (_ownsMutex)
        {
            try
            {
                _mutex.ReleaseMutex();
            }
            catch (ApplicationException)
            {
                DesktopLog.Warning("Single-instance mutex was disposed from a non-owner thread");
            }
        }

        _mutex.Dispose();
    }

    private async Task ListenAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await using var server = new NamedPipeServerStream(
                    _pipeName,
                    PipeDirection.In,
                    maxNumberOfServerInstances: 1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await server.WaitForConnectionAsync(cancellationToken);

                using var reader = new StreamReader(
                    server,
                    Encoding.UTF8,
                    detectEncodingFromByteOrderMarks: false,
                    bufferSize: 256,
                    leaveOpen: false);
                var command = await ReadBoundedLineAsync(reader, cancellationToken);

                if (TryParseActivationCommand(command, out var request))
                {
                    DesktopLog.Info("Activation request received from secondary instance");
                    ActivationRequested?.Invoke(
                        this,
                        new DesktopLaunchRequestEventArgs(request));
                }
                else
                {
                    DesktopLog.Warning("Ignored unknown single-instance command");
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch (IOException exception)
            {
                DesktopLog.Error("Single-instance pipe listener failed", exception);
            }
        }
    }

    internal static string CreateActivationCommand(DesktopLaunchRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.StartInBackground)
        {
            return ActivateCommand;
        }

        if (request.OpenDownloads && request.Route is null)
        {
            return OpenDownloadsCommand;
        }

        if (!request.OpenDownloads
            && DesktopDeepLinkParser.TryParseInternalRoute(request.Route, out var route))
        {
            return RouteCommandPrefix + route;
        }

        return ActivateCommand;
    }

    internal static bool TryParseActivationCommand(
        string? command,
        out DesktopLaunchRequest request)
    {
        request = DesktopLaunchRequest.Default;
        if (string.Equals(command, ActivateCommand, StringComparison.Ordinal))
        {
            return true;
        }

        if (string.Equals(command, OpenDownloadsCommand, StringComparison.Ordinal))
        {
            request = DesktopLaunchRequest.Default with { OpenDownloads = true };
            return true;
        }

        if (command is null
            || command.Length > MaximumCommandLength
            || !command.StartsWith(RouteCommandPrefix, StringComparison.Ordinal)
            || !DesktopDeepLinkParser.TryParseInternalRoute(
                command[RouteCommandPrefix.Length..],
                out var route))
        {
            return false;
        }

        request = DesktopLaunchRequest.Default with { Route = route };
        return true;
    }

    private static async Task<string?> ReadBoundedLineAsync(
        TextReader reader,
        CancellationToken cancellationToken)
    {
        var result = new StringBuilder(capacity: 64);
        var buffer = new char[1];
        while (await reader.ReadAsync(buffer.AsMemory(), cancellationToken) > 0)
        {
            if (buffer[0] == '\n')
            {
                return result.ToString().TrimEnd('\r');
            }

            if (result.Length >= MaximumCommandLength)
            {
                return null;
            }

            result.Append(buffer[0]);
        }

        return result.Length == 0 ? null : result.ToString().TrimEnd('\r');
    }

    private static string BuildInstanceName(string applicationId)
    {
        if (string.IsNullOrWhiteSpace(applicationId))
        {
            throw new ArgumentException("Application id is required.", nameof(applicationId));
        }

        var userId = WindowsIdentity.GetCurrent().User?.Value ?? Environment.UserName;
        return $"{applicationId}.{userId}";
    }
}

public sealed class DesktopLaunchRequestEventArgs : EventArgs
{
    public DesktopLaunchRequestEventArgs(DesktopLaunchRequest request)
    {
        Request = request ?? throw new ArgumentNullException(nameof(request));
    }

    public DesktopLaunchRequest Request { get; }
}

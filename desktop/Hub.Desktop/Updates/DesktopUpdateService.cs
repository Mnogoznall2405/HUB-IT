using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Hub.Desktop.Configuration;
using Hub.Desktop.Diagnostics;
using Hub.Desktop.UpdateCore;

namespace Hub.Desktop.Updates;

public sealed class DesktopUpdateService : IDisposable
{
    private const long DownloadReserveBytes = 100L * 1024 * 1024;
    private const string RunnerFileName = "HUB.Desktop.UpdateRunner.exe";
    private readonly DesktopUpdateOptions _options;
    private readonly Version _currentVersion;
    private readonly HttpClient _httpClient;
    private readonly bool _ownsHttpClient;
    private readonly X509Certificate2 _trustCertificate;
    private readonly string _updatesFolder;
    private readonly string _packagesFolder;
    private readonly string _runnersFolder;
    private readonly Func<string, long> _getAvailableFreeSpace;
    private readonly CancellationTokenSource _shutdown = new();
    private Task? _loopTask;
    private Version? _lastPublishedVersion;

    public DesktopUpdateService(
        DesktopUpdateOptions options,
        Version? currentVersion = null,
        HttpClient? httpClient = null)
        : this(
            options,
            currentVersion,
            httpClient,
            DesktopUpdateTrust.LoadCertificate(),
            DesktopPaths.UpdatesFolder,
            null)
    {
    }

    internal DesktopUpdateService(
        DesktopUpdateOptions options,
        Version? currentVersion,
        HttpClient? httpClient,
        X509Certificate2 trustCertificate,
        string updatesFolder,
        Func<string, long>? getAvailableFreeSpace = null)
    {
        _options = options;
        _currentVersion = currentVersion
            ?? Assembly.GetExecutingAssembly().GetName().Version
            ?? new Version(0, 0, 0);
        _ownsHttpClient = httpClient is null;
        _httpClient = httpClient ?? CreateHttpClient();
        _trustCertificate = trustCertificate;
        _updatesFolder = Path.GetFullPath(updatesFolder);
        _packagesFolder = Path.Combine(_updatesFolder, "Packages");
        _runnersFolder = Path.Combine(_updatesFolder, "Runners");
        _getAvailableFreeSpace = getAvailableFreeSpace ?? GetAvailableFreeSpace;
    }

    public event EventHandler<DesktopUpdatePackage>? UpdateReady;

    public void Start()
    {
        if (!_options.Enabled || _loopTask is not null)
        {
            return;
        }

        _loopTask = Task.Run(() => RunLoopAsync(_shutdown.Token));
    }

    public async Task<DesktopUpdatePackage?> CheckOnceAsync(
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, _options.ManifestUri);
        using var response = await _httpClient.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }

        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength
            is > DesktopUpdateManifestVerifier.MaximumManifestBytes)
        {
            throw new InvalidDataException("Update manifest is too large.");
        }

        var manifestBytes = await ReadBoundedAsync(
            response.Content,
            DesktopUpdateManifestVerifier.MaximumManifestBytes,
            cancellationToken);
        if (!DesktopUpdateManifestVerifier.TryParse(
                manifestBytes,
                new Uri(_options.ManifestUri.GetLeftPart(UriPartial.Authority) + "/"),
                out var manifest,
                out var parseError))
        {
            throw new InvalidDataException($"Update manifest was rejected: {parseError}.");
        }

        if (!DesktopUpdateManifestVerifier.VerifySignature(manifest, _trustCertificate))
        {
            throw new InvalidDataException("Update manifest signature is invalid.");
        }

        if (!DesktopUpdateManifestVerifier.IsNewerThan(manifest, _currentVersion))
        {
            return null;
        }

        var package = await EnsurePackageAsync(
            manifest,
            manifestBytes,
            cancellationToken);
        return package with { DeferredUntil = ReadDeferredUntil(manifest.Version) };
    }

    public async Task DeferAsync(
        DesktopUpdatePackage package,
        DateTimeOffset deferredUntil,
        CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(_updatesFolder);
        var state = new DeferredUpdateState(
            DesktopUpdateManifestVerifier.FormatVersion(package.Manifest.Version),
            deferredUntil.UtcDateTime);
        var temporaryPath = Path.Combine(_updatesFolder, "state.json.tmp");
        var destinationPath = Path.Combine(_updatesFolder, "state.json");
        await File.WriteAllTextAsync(
            temporaryPath,
            JsonSerializer.Serialize(state),
            cancellationToken);
        File.Move(temporaryPath, destinationPath, overwrite: true);
    }

    public bool TryLaunchInstaller(
        DesktopUpdatePackage package,
        string applicationPath)
    {
        try
        {
            var installedRunnerPath = Path.Combine(AppContext.BaseDirectory, RunnerFileName);
            if (!File.Exists(installedRunnerPath))
            {
                DesktopLog.Warning("Update runner is missing");
                return false;
            }

            var runnerDirectory = Path.Combine(
                _runnersFolder,
                Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(runnerDirectory);
            var runnerPath = Path.Combine(runnerDirectory, RunnerFileName);
            File.Copy(installedRunnerPath, runnerPath, overwrite: false);

            var startInfo = new ProcessStartInfo(runnerPath)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = runnerDirectory,
            };
            startInfo.ArgumentList.Add("--parent-pid");
            startInfo.ArgumentList.Add(Environment.ProcessId.ToString());
            startInfo.ArgumentList.Add("--setup");
            startInfo.ArgumentList.Add(package.SetupPath);
            startInfo.ArgumentList.Add("--manifest");
            startInfo.ArgumentList.Add(package.ManifestPath);
            startInfo.ArgumentList.Add("--application");
            startInfo.ArgumentList.Add(applicationPath);

            _ = Process.Start(startInfo)
                ?? throw new InvalidOperationException("Update runner did not start.");
            DesktopLog.Info(
                $"Update runner started; version={DesktopUpdateManifestVerifier.FormatVersion(package.Manifest.Version)}");
            return true;
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Update runner failed to start", exception);
            return false;
        }
    }

    public void Dispose()
    {
        _shutdown.Cancel();
        _shutdown.Dispose();
        if (_ownsHttpClient)
        {
            _httpClient.Dispose();
        }

        _trustCertificate.Dispose();
    }

    private async Task RunLoopAsync(CancellationToken cancellationToken)
    {
        try
        {
            CleanupOldFiles();
            var initialDelay = RandomDelay(
                _options.InitialDelayMinimum,
                _options.InitialDelayMaximum);
            await Task.Delay(initialDelay, cancellationToken);

            while (!cancellationToken.IsCancellationRequested)
            {
                var delay = _options.CheckInterval;
                try
                {
                    var package = await CheckOnceAsync(cancellationToken);
                    if (package is not null && package.Manifest.Version != _lastPublishedVersion)
                    {
                        _lastPublishedVersion = package.Manifest.Version;
                        UpdateReady?.Invoke(this, package);
                        DesktopLog.Info(
                            $"Desktop update is ready; version={DesktopUpdateManifestVerifier.FormatVersion(package.Manifest.Version)}");
                    }
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    return;
                }
                catch (Exception exception)
                {
                    delay = _options.RetryDelay;
                    DesktopLog.Error("Desktop update check failed", exception);
                }

                await Task.Delay(delay, cancellationToken);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Normal shutdown.
        }
    }

    private async Task<DesktopUpdatePackage> EnsurePackageAsync(
        DesktopUpdateManifest manifest,
        byte[] manifestBytes,
        CancellationToken cancellationToken)
    {
        var versionText = DesktopUpdateManifestVerifier.FormatVersion(manifest.Version);
        var packageDirectory = Path.Combine(_packagesFolder, versionText);
        Directory.CreateDirectory(packageDirectory);
        var setupPath = Path.Combine(packageDirectory, Path.GetFileName(manifest.DownloadUri.LocalPath));
        var manifestPath = Path.Combine(packageDirectory, "manifest.json");

        if (await DesktopUpdateManifestVerifier.VerifyFileAsync(
                manifest,
                setupPath,
                cancellationToken))
        {
            await WriteManifestAtomicallyAsync(manifestPath, manifestBytes, cancellationToken);
            return new DesktopUpdatePackage(manifest, setupPath, manifestPath, null);
        }

        if (File.Exists(setupPath))
        {
            File.Delete(setupPath);
        }

        if (File.Exists(manifestPath))
        {
            File.Delete(manifestPath);
        }

        EnsureFreeSpace(packageDirectory, manifest.SizeBytes + DownloadReserveBytes);
        var partialPath = setupPath + ".partial";
        if (File.Exists(partialPath))
        {
            File.Delete(partialPath);
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, manifest.DownloadUri);
            using var response = await _httpClient.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken);
            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength is long contentLength
                && contentLength != manifest.SizeBytes)
            {
                throw new InvalidDataException("Update package length does not match manifest.");
            }

            await using (var source = await response.Content.ReadAsStreamAsync(cancellationToken))
            await using (var destination = new FileStream(
                partialPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                128 * 1024,
                useAsync: true))
            {
                var buffer = new byte[128 * 1024];
                long totalBytes = 0;
                while (true)
                {
                    var read = await source.ReadAsync(buffer, cancellationToken);
                    if (read == 0)
                    {
                        break;
                    }

                    totalBytes += read;
                    if (totalBytes > manifest.SizeBytes)
                    {
                        throw new InvalidDataException("Update package exceeded manifest size.");
                    }

                    await destination.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                }
            }

            if (!await DesktopUpdateManifestVerifier.VerifyFileAsync(
                    manifest,
                    partialPath,
                    cancellationToken))
            {
                throw new InvalidDataException("Downloaded update package verification failed.");
            }

            File.Move(partialPath, setupPath);
            await WriteManifestAtomicallyAsync(manifestPath, manifestBytes, cancellationToken);
            CleanupOldPackages(manifest.Version);
            return new DesktopUpdatePackage(manifest, setupPath, manifestPath, null);
        }
        catch
        {
            if (File.Exists(partialPath))
            {
                File.Delete(partialPath);
            }

            TryDeleteEmptyDirectory(packageDirectory);

            throw;
        }
    }

    private static async Task<byte[]> ReadBoundedAsync(
        HttpContent content,
        int maximumBytes,
        CancellationToken cancellationToken)
    {
        await using var stream = await content.ReadAsStreamAsync(cancellationToken);
        using var destination = new MemoryStream();
        var buffer = new byte[16 * 1024];
        while (true)
        {
            var read = await stream.ReadAsync(buffer, cancellationToken);
            if (read == 0)
            {
                break;
            }

            if (destination.Length + read > maximumBytes)
            {
                throw new InvalidDataException("Update manifest is too large.");
            }

            destination.Write(buffer, 0, read);
        }

        return destination.ToArray();
    }

    private static async Task WriteManifestAtomicallyAsync(
        string manifestPath,
        byte[] manifestBytes,
        CancellationToken cancellationToken)
    {
        var temporaryPath = manifestPath + ".tmp";
        await File.WriteAllBytesAsync(temporaryPath, manifestBytes, cancellationToken);
        File.Move(temporaryPath, manifestPath, overwrite: true);
    }

    private void EnsureFreeSpace(string path, long requiredBytes)
    {
        if (_getAvailableFreeSpace(path) < requiredBytes)
        {
            throw new IOException("Not enough free space for desktop update.");
        }
    }

    private static long GetAvailableFreeSpace(string path)
    {
        var root = Path.GetPathRoot(Path.GetFullPath(path))
            ?? throw new InvalidOperationException("Update drive is unavailable.");
        return new DriveInfo(root).AvailableFreeSpace;
    }

    private DateTimeOffset? ReadDeferredUntil(Version version)
    {
        try
        {
            var path = Path.Combine(_updatesFolder, "state.json");
            if (!File.Exists(path))
            {
                return null;
            }

            var state = JsonSerializer.Deserialize<DeferredUpdateState>(File.ReadAllText(path));
            return state is not null
                && string.Equals(
                    state.Version,
                    DesktopUpdateManifestVerifier.FormatVersion(version),
                    StringComparison.Ordinal)
                    ? new DateTimeOffset(
                        DateTime.SpecifyKind(state.DeferredUntilUtc, DateTimeKind.Utc))
                    : null;
        }
        catch
        {
            return null;
        }
    }

    private void CleanupOldFiles()
    {
        Directory.CreateDirectory(_packagesFolder);
        Directory.CreateDirectory(_runnersFolder);
        foreach (var partialPath in Directory.EnumerateFiles(
                     _packagesFolder,
                     "*.partial",
                     SearchOption.AllDirectories))
        {
            try
            {
                File.Delete(partialPath);
                var packageDirectory = Path.GetDirectoryName(partialPath);
                if (packageDirectory is not null)
                {
                    TryDeleteEmptyDirectory(packageDirectory);
                }
            }
            catch
            {
                // Cleanup is best-effort.
            }
        }

        foreach (var directory in Directory.EnumerateDirectories(_runnersFolder))
        {
            try
            {
                if (Directory.GetCreationTimeUtc(directory) < DateTime.UtcNow.AddDays(-1))
                {
                    Directory.Delete(directory, recursive: true);
                }
            }
            catch
            {
                // A previous runner may still be finishing.
            }
        }
    }

    private static void TryDeleteEmptyDirectory(string directory)
    {
        try
        {
            if (Directory.Exists(directory)
                && !Directory.EnumerateFileSystemEntries(directory).Any())
            {
                Directory.Delete(directory);
            }
        }
        catch
        {
            // Cleanup is best-effort.
        }
    }

    private void CleanupOldPackages(Version currentVersion)
    {
        var packages = Directory.EnumerateDirectories(_packagesFolder)
            .Select(path => new
            {
                Path = path,
                Parsed = Version.TryParse(Path.GetFileName(path), out var parsed)
                    ? parsed
                    : null,
            })
            .Where(item => item.Parsed is not null)
            .OrderByDescending(item => item.Parsed)
            .ToArray();
        foreach (var package in packages.Skip(2))
        {
            try
            {
                if (package.Parsed != currentVersion)
                {
                    Directory.Delete(package.Path, recursive: true);
                }
            }
            catch
            {
                // Cleanup is best-effort.
            }
        }
    }

    private static TimeSpan RandomDelay(TimeSpan minimum, TimeSpan maximum)
    {
        var range = maximum - minimum;
        return range <= TimeSpan.Zero
            ? minimum
            : minimum + TimeSpan.FromMilliseconds(Random.Shared.NextDouble() * range.TotalMilliseconds);
    }

    private static HttpClient CreateHttpClient()
    {
        var handler = new HttpClientHandler
        {
            AllowAutoRedirect = false,
            UseCookies = false,
        };
        return new HttpClient(handler)
        {
            Timeout = TimeSpan.FromMinutes(15),
        };
    }

    private sealed record DeferredUpdateState(string Version, DateTime DeferredUntilUtc);
}

using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using Hub.Desktop.Configuration;
using Hub.Desktop.UpdateCore;
using Hub.Desktop.Updates;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopUpdateServiceTests
{
    [Fact]
    public async Task DownloadsAndVerifiesNewerPackage()
    {
        var updateFolder = CreateTemporaryDirectory();
        try
        {
            using var rsa = RSA.Create(3072);
            using var certificate = CreateCertificate(rsa);
            var setupBytes = Encoding.UTF8.GetBytes("signed desktop setup");
            var manifestBytes = CreateSignedManifest(rsa, setupBytes);
            using var client = new HttpClient(new QueueHttpMessageHandler(
                Response(HttpStatusCode.OK, manifestBytes, "application/json"),
                Response(HttpStatusCode.OK, setupBytes, "application/octet-stream")));
            using var service = new DesktopUpdateService(
                CreateOptions(),
                new Version(0, 1, 6),
                client,
                new X509Certificate2(certificate.RawData),
                updateFolder);

            var package = await service.CheckOnceAsync();

            Assert.NotNull(package);
            Assert.Equal(new Version(0, 1, 7), package.Manifest.Version);
            Assert.Equal(setupBytes, await File.ReadAllBytesAsync(package.SetupPath));
            Assert.True(File.Exists(package.ManifestPath));
        }
        finally
        {
            Directory.Delete(updateFolder, recursive: true);
        }
    }

    [Fact]
    public async Task DoesNotDownloadCurrentOrOlderVersion()
    {
        var updateFolder = CreateTemporaryDirectory();
        try
        {
            using var rsa = RSA.Create(3072);
            using var certificate = CreateCertificate(rsa);
            var setupBytes = Encoding.UTF8.GetBytes("signed desktop setup");
            var handler = new QueueHttpMessageHandler(
                Response(
                    HttpStatusCode.OK,
                    CreateSignedManifest(rsa, setupBytes),
                    "application/json"));
            using var client = new HttpClient(handler);
            using var service = new DesktopUpdateService(
                CreateOptions(),
                new Version(0, 1, 7),
                client,
                new X509Certificate2(certificate.RawData),
                updateFolder);

            Assert.Null(await service.CheckOnceAsync());
            Assert.Equal(1, handler.RequestCount);
            Assert.Equal(["Автоматическое обновление"], service.InstalledReleaseNotes);
        }
        finally
        {
            Directory.Delete(updateFolder, recursive: true);
        }
    }

    [Fact]
    public async Task RejectsRedirectedFeed()
    {
        var updateFolder = CreateTemporaryDirectory();
        try
        {
            using var rsa = RSA.Create(3072);
            using var certificate = CreateCertificate(rsa);
            using var client = new HttpClient(new QueueHttpMessageHandler(
                new HttpResponseMessage(HttpStatusCode.Redirect)
                {
                    Headers = { Location = new Uri("https://example.com/latest.json") },
                }));
            using var service = new DesktopUpdateService(
                CreateOptions(),
                new Version(0, 1, 6),
                client,
                new X509Certificate2(certificate.RawData),
                updateFolder);

            await Assert.ThrowsAsync<HttpRequestException>(() => service.CheckOnceAsync());
        }
        finally
        {
            Directory.Delete(updateFolder, recursive: true);
        }
    }

    [Fact]
    public async Task DeletesPartialFileWhenPackageHashDoesNotMatch()
    {
        var updateFolder = CreateTemporaryDirectory();
        try
        {
            using var rsa = RSA.Create(3072);
            using var certificate = CreateCertificate(rsa);
            var setupBytes = Encoding.UTF8.GetBytes("signed desktop setup");
            var corruptBytes = Encoding.UTF8.GetBytes("corrupt desktop set");
            using var client = new HttpClient(new QueueHttpMessageHandler(
                Response(
                    HttpStatusCode.OK,
                    CreateSignedManifest(rsa, setupBytes),
                    "application/json"),
                Response(HttpStatusCode.OK, corruptBytes, "application/octet-stream")));
            using var service = new DesktopUpdateService(
                CreateOptions(),
                new Version(0, 1, 6),
                client,
                new X509Certificate2(certificate.RawData),
                updateFolder);

            await Assert.ThrowsAsync<InvalidDataException>(() => service.CheckOnceAsync());
            Assert.Empty(Directory.EnumerateFiles(updateFolder, "*.partial", SearchOption.AllDirectories));
            Assert.Empty(Directory.EnumerateDirectories(updateFolder, "0.1.7", SearchOption.AllDirectories));
        }
        finally
        {
            Directory.Delete(updateFolder, recursive: true);
        }
    }

    [Fact]
    public async Task RejectsDownloadBeforeRequestWhenFreeSpaceIsInsufficient()
    {
        var updateFolder = CreateTemporaryDirectory();
        try
        {
            using var rsa = RSA.Create(3072);
            using var certificate = CreateCertificate(rsa);
            var setupBytes = Encoding.UTF8.GetBytes("signed desktop setup");
            var handler = new QueueHttpMessageHandler(
                Response(
                    HttpStatusCode.OK,
                    CreateSignedManifest(rsa, setupBytes),
                    "application/json"));
            using var client = new HttpClient(handler);
            using var service = new DesktopUpdateService(
                CreateOptions(),
                new Version(0, 1, 6),
                client,
                new X509Certificate2(certificate.RawData),
                updateFolder,
                _ => 0);

            var exception = await Assert.ThrowsAsync<IOException>(() => service.CheckOnceAsync());

            Assert.Contains("free space", exception.Message, StringComparison.OrdinalIgnoreCase);
            Assert.Equal(1, handler.RequestCount);
            Assert.Empty(Directory.EnumerateFiles(updateFolder, "*.partial", SearchOption.AllDirectories));
        }
        finally
        {
            Directory.Delete(updateFolder, recursive: true);
        }
    }

    [Fact]
    public async Task RetriesInterruptedPackageFromTheBeginningOnNextCheck()
    {
        var updateFolder = CreateTemporaryDirectory();
        try
        {
            using var rsa = RSA.Create(3072);
            using var certificate = CreateCertificate(rsa);
            var setupBytes = Encoding.UTF8.GetBytes("signed desktop setup bytes for retry");
            var interruptedResponse = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StreamContent(new InterruptedReadStream(setupBytes)),
            };
            interruptedResponse.Content.Headers.ContentLength = setupBytes.LongLength;
            var manifestBytes = CreateSignedManifest(rsa, setupBytes);
            var handler = new QueueHttpMessageHandler(
                Response(HttpStatusCode.OK, manifestBytes, "application/json"),
                interruptedResponse,
                Response(HttpStatusCode.OK, manifestBytes, "application/json"),
                Response(HttpStatusCode.OK, setupBytes, "application/octet-stream"));
            using var client = new HttpClient(handler);
            using var service = new DesktopUpdateService(
                CreateOptions(),
                new Version(0, 1, 6),
                client,
                new X509Certificate2(certificate.RawData),
                updateFolder);

            await Assert.ThrowsAsync<IOException>(() => service.CheckOnceAsync());
            Assert.Empty(Directory.EnumerateFiles(updateFolder, "*.partial", SearchOption.AllDirectories));
            Assert.Empty(Directory.EnumerateDirectories(updateFolder, "0.1.7", SearchOption.AllDirectories));

            var package = await service.CheckOnceAsync();

            Assert.NotNull(package);
            Assert.Equal(setupBytes, await File.ReadAllBytesAsync(package.SetupPath));
            Assert.Equal(4, handler.RequestCount);
        }
        finally
        {
            Directory.Delete(updateFolder, recursive: true);
        }
    }

    [Fact]
    public async Task PersistsDeferralInSafeSettingsAndRestoresItOnNextCheck()
    {
        var updateFolder = CreateTemporaryDirectory();
        try
        {
            using var rsa = RSA.Create(3072);
            using var certificate = CreateCertificate(rsa);
            var setupBytes = Encoding.UTF8.GetBytes("signed desktop setup");
            var manifestBytes = CreateSignedManifest(rsa, setupBytes);
            var deferredUntil = DateTimeOffset.UtcNow.AddHours(24);

            using (var firstClient = new HttpClient(new QueueHttpMessageHandler(
                       Response(HttpStatusCode.OK, manifestBytes, "application/json"),
                       Response(HttpStatusCode.OK, setupBytes, "application/octet-stream"))))
            using (var firstService = new DesktopUpdateService(
                       CreateOptions(),
                       new Version(0, 1, 6),
                       firstClient,
                       new X509Certificate2(certificate.RawData),
                       updateFolder))
            {
                var package = await firstService.CheckOnceAsync();
                Assert.NotNull(package);
                await firstService.DeferAsync(package, deferredUntil);
            }

            using var secondClient = new HttpClient(new QueueHttpMessageHandler(
                Response(HttpStatusCode.OK, manifestBytes, "application/json")));
            using var secondService = new DesktopUpdateService(
                CreateOptions(),
                new Version(0, 1, 6),
                secondClient,
                new X509Certificate2(certificate.RawData),
                updateFolder);

            var restored = await secondService.CheckOnceAsync();

            Assert.NotNull(restored);
            Assert.Equal(deferredUntil, restored.DeferredUntil);
            Assert.False(File.Exists(Path.Combine(updateFolder, "state.json")));
            Assert.True(File.Exists(Path.Combine(updateFolder, "settings.json")));
        }
        finally
        {
            Directory.Delete(updateFolder, recursive: true);
        }
    }

    private static DesktopUpdateOptions CreateOptions() => new(
        Enabled: true,
        ManifestUri: new Uri("https://hubit.zsgp.ru/desktop-updates/stable/latest.json"),
        InitialDelayMinimum: TimeSpan.Zero,
        InitialDelayMaximum: TimeSpan.Zero,
        CheckInterval: TimeSpan.FromHours(12),
        RetryDelay: TimeSpan.FromMinutes(15));

    private static byte[] CreateSignedManifest(RSA rsa, byte[] setupBytes)
    {
        var hash = Convert.ToHexString(SHA256.HashData(setupBytes)).ToLowerInvariant();
        var manifest = new DesktopUpdateManifest(
            DesktopUpdateManifestVerifier.SchemaVersion,
            DesktopUpdateManifestVerifier.StableChannel,
            new Version(0, 1, 7),
            new DateTimeOffset(2026, 8, 11, 12, 0, 0, TimeSpan.Zero),
            "stable/0.1.7/HUB-Desktop-Setup-0.1.7-win-x64.exe",
            new Uri(
                "https://hubit.zsgp.ru/desktop-updates/stable/0.1.7/" +
                "HUB-Desktop-Setup-0.1.7-win-x64.exe"),
            setupBytes.LongLength,
            hash,
            ["Автоматическое обновление"],
            new DesktopUpdateSignature(
                DesktopUpdateManifestVerifier.SignatureAlgorithm,
                DesktopUpdateTrust.KeyId,
                "placeholder"));
        var signature = Convert.ToBase64String(rsa.SignData(
            DesktopUpdateManifestVerifier.CreateCanonicalPayload(manifest),
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pss));
        return JsonSerializer.SerializeToUtf8Bytes(new
        {
            schema_version = manifest.SchemaVersion,
            channel = manifest.Channel,
            version = DesktopUpdateManifestVerifier.FormatVersion(manifest.Version),
            published_at = "2026-08-11T12:00:00Z",
            relative_path = manifest.RelativePath,
            size_bytes = manifest.SizeBytes,
            sha256 = manifest.Sha256,
            release_notes = manifest.ReleaseNotes,
            signature = new
            {
                algorithm = manifest.Signature.Algorithm,
                key_id = manifest.Signature.KeyId,
                value = signature,
            },
        });
    }

    private static X509Certificate2 CreateCertificate(RSA rsa)
    {
        var request = new CertificateRequest(
            "CN=HUB Desktop Update Test",
            rsa,
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1);
        return request.CreateSelfSigned(
            DateTimeOffset.UtcNow.AddDays(-1),
            DateTimeOffset.UtcNow.AddDays(1));
    }

    private static HttpResponseMessage Response(
        HttpStatusCode statusCode,
        byte[] bytes,
        string contentType)
    {
        var response = new HttpResponseMessage(statusCode)
        {
            Content = new ByteArrayContent(bytes),
        };
        response.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(contentType);
        return response;
    }

    private static string CreateTemporaryDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), "hub-desktop-update-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }

    private sealed class QueueHttpMessageHandler(params HttpResponseMessage[] responses)
        : HttpMessageHandler
    {
        private readonly Queue<HttpResponseMessage> _responses = new(responses);

        public int RequestCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            RequestCount++;
            if (_responses.Count == 0)
            {
                throw new InvalidOperationException("Unexpected HTTP request.");
            }

            return Task.FromResult(_responses.Dequeue());
        }
    }

    private sealed class InterruptedReadStream(byte[] bytes) : MemoryStream(bytes)
    {
        private bool _returnedFirstChunk;

        public override ValueTask<int> ReadAsync(
            Memory<byte> buffer,
            CancellationToken cancellationToken = default)
        {
            if (_returnedFirstChunk)
            {
                throw new IOException("Simulated network interruption.");
            }

            _returnedFirstChunk = true;
            return base.ReadAsync(
                buffer[..Math.Min(5, buffer.Length)],
                cancellationToken);
        }
    }
}

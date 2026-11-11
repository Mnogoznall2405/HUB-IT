using System.Text;
using Hub.Agent.Core.Diagnostics;
using Hub.Agent.Core.Scan;
using Xunit;

namespace Hub.Agent.Tests;

public sealed class ScanStreamTests : IDisposable
{
    private readonly string _root;
    private readonly AgentLog _log;

    public ScanStreamTests()
    {
        _root = Path.Combine(AppContext.BaseDirectory, "scan-stream-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_root);
        _log = AgentLog.Create(Path.Combine(_root, "test.log"), mirrorToConsole: false);
    }

    [Fact]
    public void FindsCredentialsNearTheEndOfALargeFile()
    {
        var path = Path.Combine(_root, "big.txt");
        var filler = new string('x', 2_500_000);
        File.WriteAllText(path, filler + "\npassword: Secret123!\n", new UTF8Encoding(false));

        var engine = Engine();
        var (matches, excerpt) = ScanAgentService.ScanTextFile(path, engine, null);

        Assert.Contains(matches, item => Convert.ToString(item["pattern"]) == "password_strict");
        Assert.False(string.IsNullOrEmpty(excerpt));
        Assert.True(excerpt.Length <= 4000);
    }

    [Fact]
    public void ReadsCp1251FilesWithoutMojibake()
    {
        var path = Path.Combine(_root, "cp1251.txt");
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        File.WriteAllText(path, "пароль: Secret123!", Encoding.GetEncoding(1251));

        var engine = Engine();
        var (matches, _) = ScanAgentService.ScanTextFile(path, engine, null);

        Assert.Contains(matches, item => Convert.ToString(item["pattern"]) == "password_strict");
    }

    private ScanPatternEngine Engine()
    {
        var patterns = Path.Combine(_root, "patterns.yaml");
        File.WriteAllText(patterns, """
            patterns:
              - id: password_strict
                name: Пароль
                type: regex
                pattern: '(?i)(?:пароль|password|pass|pwd)\s*[:=\-—]\s*["'']?([A-Za-z0-9!@#$%^&*]{6,64})'
                weight: 1.0
                flags:
                  - ignorecase
            """);
        return ScanPatternEngine.Load(patterns, _log);
    }

    public void Dispose()
    {
        _log.Dispose();
        try
        {
            Directory.Delete(_root, recursive: true);
        }
        catch (Exception)
        {
            // best effort
        }
    }
}

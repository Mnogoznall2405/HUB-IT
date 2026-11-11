using Hub.Agent.Core.Diagnostics;
using Hub.Agent.Core.Scan;
using Xunit;

namespace Hub.Agent.Tests;

public sealed class ScanPatternTests : IDisposable
{
    private readonly string _root;
    private readonly AgentLog _log;

    public ScanPatternTests()
    {
        _root = Path.Combine(AppContext.BaseDirectory, "scan-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_root);
        _log = AgentLog.Create(Path.Combine(_root, "test.log"), mirrorToConsole: false);
    }

    [Fact]
    public void RepoPatternFileLoadsAllStrictPatterns()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "patterns_strict.yaml");
        Assert.True(File.Exists(path), path);

        var engine = ScanPatternEngine.Load(path, _log);

        Assert.True(engine.Patterns.Count >= 15, $"expected >=15 patterns, got {engine.Patterns.Count}");
        Assert.Contains(engine.Patterns, pattern => pattern.Id == "password_strict");
        Assert.Contains(engine.Patterns, pattern => pattern.Id == "dsp_official_use");
        Assert.Contains(engine.Patterns, pattern => pattern.Id == "dsp_with_exclusion");
    }

    [Fact]
    public void LoadsPatternsAndFindsSecrecyStamp()
    {
        var engine = ScanPatternEngine.Load(WritePatterns(), _log);
        var matches = engine.Scan("Документ. Для служебного пользования. Копировать запрещено.", null);

        Assert.Contains(matches, item => TextOf(item, "pattern") == "dsp_official_use");
    }

    [Fact]
    public void NormalizeRepairsSpacedCyrillicAndOcrLatins()
    {
        var engine = ScanPatternEngine.Load(WritePatterns(), _log);
        var matches = engine.Scan("д л я с л у ж е б н о г о п о л ь з о в а н и я", null);

        Assert.Contains(matches, item => TextOf(item, "pattern") == "dsp_official_use");
        Assert.Contains("служебного", ScanPatternEngine.Normalize("с л у ж е б н о г о"));
    }

    [Fact]
    public void FurnitureDspIsNotReported()
    {
        var engine = ScanPatternEngine.Load(WritePatterns(), _log);
        var matches = engine.Scan("Столешница ДСП 22 мм, кромка ПВХ", null);

        Assert.DoesNotContain(matches, item => TextOf(item, "pattern") == "dsp_with_exclusion");
    }

    [Fact]
    public void PasswordPatternFindsCredentialAndSnippet()
    {
        var engine = ScanPatternEngine.Load(WritePatterns(), _log);
        var matches = engine.Scan("login: user123\npassword: Secret123!", null);

        var hit = Assert.Single(matches, item => TextOf(item, "pattern") == "password_strict");
        Assert.Equal("1", TextOf(hit, "weight"));
        Assert.Contains("password", TextOf(hit, "snippet"));
    }

    [Fact]
    public void PatternFilterLimitsMatches()
    {
        var engine = ScanPatternEngine.Load(WritePatterns(), _log);
        var only = new HashSet<string>(StringComparer.Ordinal) { "dsp_official_use" };
        var matches = engine.Scan("password: Secret123! Для служебного пользования", only);

        Assert.All(matches, item => Assert.Equal("dsp_official_use", TextOf(item, "pattern")));
    }

    private static string TextOf(Dictionary<string, object?> item, string key)
        => Convert.ToString(item.GetValueOrDefault(key)) ?? string.Empty;

    private string WritePatterns()
    {
        var path = Path.Combine(_root, "patterns_strict.yaml");
        File.WriteAllText(path, """
            patterns:
              - id: password_strict
                name: Пароль
                type: regex
                pattern: '(?i)(?:пароль|password|pass|pwd)\s*[:=\-—]\s*["'']?([A-Za-z0-9!@#$%^&*]{6,64})'
                weight: 1.0
                flags:
                  - ignorecase
              - id: dsp_official_use
                name: ДСП
                type: regex
                pattern: '(?i)Для\s+служебного\s+пользования'
                weight: 1.0
                flags:
                  - ignorecase
              - id: dsp_with_exclusion
                name: ДСП (сокр.)
                type: regex
                pattern: '(?i)\b(?:дсп|D[сc][пp])\b'
                weight: 0.8
                flags:
                  - ignorecase
            """);
        return path;
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

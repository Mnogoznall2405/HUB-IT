using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Hub.Agent.Core.Diagnostics;
using Hub.Agent.Core.Support;
using YamlDotNet.Serialization;

namespace Hub.Agent.Core.Scan;

/// <summary>
/// Strict pattern engine (parity with scan_agent/agent.py: _load_pattern_defs,
/// _normalize_scan_text, scan_text and the DSP false-positive rules).
/// </summary>
public sealed class ScanPatternEngine
{
    private const int MaxMatches = 100;
    private const int SnippetRadius = 30;

    private static readonly Regex SpacedDspPhrase = new(
        @"(?i)д\s*л\s*я\s*с\s*л\s*у\s*ж\s*е\s*б\s*н\s*о\s*г\s*о\s*п\s*о\s*л\s*ь\s*з\s*о\s*в\s*а\s*н\s*и\s*я",
        RegexOptions.CultureInvariant);

    private static readonly Regex SpacedCyrillicWord = new(
        @"(?<!\w)(?:[а-яё][ \t]){3,}[а-яё](?!\w)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly Regex DspFurniture = new(
        @"(?i)(?:столешниц|мебел|шкаф|тумб|вешалк|сидень|обивк|каркас|фасад|материал|покр|пласт|панел|" +
        @"пенополиуретан|ламинат|оргтехник|плит[аыеу]?|дсп\s*лист|лист[аы]?\s*дсп|\bмдф\b|\bhdf\b|" +
        @"дсп\s*22\s*мм|дсп\s*[+с]\s*пластик|\b\d+\s*мм\b)",
        RegexOptions.CultureInvariant);

    // Construction-drawing vocabulary: "ДСП" in material schedules = particle board.
    private static readonly Regex DspConstruction = new(
        @"(?i)(?:ведомост[ьи]\s+материал|спецификаци|маркировк|" +
        @"железобетон|монолит|арматур|бетон|кирпич|кладк|стяжк|" +
        @"гипсокартон|\bгвл\b|\bгкл\b|утеплит|" +
        @"перекрыти|фундамент|кровл|стропил|разрез|" +
        @"этаж|в\s+осях|ос[ияеях]\s*\d|помещени|коридор|" +
        @"смет[аы]|подрядч|заказчик|генподряд|строител|" +
        @"проектн\w*\s+документац|рабоч\w*\s+документац|" +
        @"снип|штукатурк|облицовк|отделк|" +
        @"светильник|светодиодн|освещени|ватт|\bвт\b|ip\s*\d{2}|ламп|" +
        @"люмен|optima|flagman|надтап|астз|пылевлагозащ)",
        RegexOptions.CultureInvariant);

    // "дсп" followed by a digit/dash = luminaire model code (ДСП-40, ДСП52-32-101).
    private static readonly Regex DspModelRight = new(
        @"^\s*[-–—]?\s*\d{2}|^\s*[-–—]\s*\d",
        RegexOptions.CultureInvariant);

    // "дсп" glued/spaced after a registration number = cited letter's secrecy, not this doc's.
    private static readonly Regex DspRefNumLeft = new(
        @"(?:[\w]+(?:[/\\\-–—][\w]+)+|\d{3,}[\d/\\\-–—]*)\s*$",
        RegexOptions.CultureInvariant);

    private static readonly Regex HyphenInsideWord = new(@"(?<=\w)[\-‐‑–—]\s*(?=\w)", RegexOptions.CultureInvariant);
    private static readonly Regex Whitespace = new(@"\s+", RegexOptions.CultureInvariant);

    private static readonly char[] OcrLatin = "AaBCcEeHKMOoPpTXYxyD".ToCharArray();
    private static readonly char[] OcrCyrillic = "АаВСсЕеНКМОоРрТХУхуД".ToCharArray();

    private readonly List<Pattern> _patterns;
    private readonly AgentLog _log;

    public ScanPatternEngine(IReadOnlyList<Pattern> patterns, AgentLog log)
    {
        _patterns = patterns.ToList();
        _log = log;
    }

    public IReadOnlyList<Pattern> Patterns => _patterns;

    public sealed record Pattern(string Id, string Name, double Weight, Regex Regex);

    private sealed class PatternRow
    {
        public string? id { get; set; }
        public string? name { get; set; }
        public string? category { get; set; }
        public string? type { get; set; }
        public string? pattern { get; set; }
        public double? weight { get; set; }
        public List<string>? flags { get; set; }
    }

    private sealed class PatternFile
    {
        public List<PatternRow>? patterns { get; set; }
    }

    public static ScanPatternEngine Load(string patternsFile, AgentLog log)
    {
        var patterns = new List<Pattern>();
        if (!File.Exists(patternsFile))
        {
            log.Error($"Strict patterns file not found: {patternsFile}");
            return new ScanPatternEngine(patterns, log);
        }

        try
        {
            var text = AtomicFile.ReadAllTextWithFallback(patternsFile);
            var deserializer = new DeserializerBuilder().IgnoreUnmatchedProperties().Build();
            var file = deserializer.Deserialize<PatternFile>(text);
            foreach (var row in file?.patterns ?? new List<PatternRow>())
            {
                if (!string.Equals(Text.Sanitize(row.type) is { Length: > 0 } type ? type : "regex", "regex", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var id = Text.Sanitize(row.id);
                var raw = row.pattern ?? string.Empty;
                if (id.Length == 0 || raw.Length == 0)
                {
                    continue;
                }

                var options = RegexOptions.CultureInvariant;
                foreach (var flag in row.flags ?? new List<string>())
                {
                    switch (Text.Sanitize(flag).ToLowerInvariant())
                    {
                        case "ignorecase":
                        case "i":
                            options |= RegexOptions.IgnoreCase;
                            break;
                        case "dotall":
                        case "s":
                            options |= RegexOptions.Singleline;
                            break;
                        case "multiline":
                        case "m":
                            options |= RegexOptions.Multiline;
                            break;
                    }
                }

                try
                {
                    var name = Text.Sanitize(row.name);
                    patterns.Add(new Pattern(id, name.Length > 0 ? name : id, row.weight ?? 1.0, new Regex(raw, options)));
                }
                catch (Exception ex)
                {
                    log.Warn($"Pattern compile failed id={id}: {ex.Message}");
                }
            }
        }
        catch (Exception ex)
        {
            log.Error($"Strict patterns parse failed: {ex.Message}");
        }

        if (patterns.Count == 0)
        {
            log.Error($"No strict regex patterns loaded from {patternsFile}");
        }
        else
        {
            log.Info($"Loaded strict patterns: file={patternsFile} count={patterns.Count}");
        }

        return new ScanPatternEngine(patterns, log);
    }

    public List<Dictionary<string, object?>> Scan(string text, HashSet<string>? allowedIds)
    {
        var source = text ?? string.Empty;
        if (source.Trim().Length == 0 || _patterns.Count == 0)
        {
            return new List<Dictionary<string, object?>>();
        }

        var active = allowedIds is null
            ? _patterns
            : _patterns.Where(item => allowedIds.Contains(item.Id)).ToList();
        if (active.Count == 0)
        {
            return new List<Dictionary<string, object?>>();
        }

        var sources = new List<string> { source };
        var normalized = Normalize(source);
        if (normalized.Length > 0 && !string.Equals(normalized, source, StringComparison.Ordinal))
        {
            sources.Add(normalized);
        }

        var found = new List<Dictionary<string, object?>>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var pattern in active)
        {
            foreach (var candidate in sources)
            {
                foreach (Match match in pattern.Regex.Matches(candidate))
                {
                    if (!match.Success)
                    {
                        continue;
                    }

                    var contextStart = Math.Max(0, match.Index - 80);
                    var contextEnd = Math.Min(candidate.Length, match.Index + match.Length + 80);
                    var context = candidate[contextStart..contextEnd];
                    if (pattern.Id == "dsp_with_exclusion"
                        && (DspFurniture.IsMatch(context)
                            || DspConstruction.IsMatch(context)
                            || DspRefNumLeft.IsMatch(candidate[contextStart..match.Index])
                            || DspModelRight.IsMatch(candidate[(match.Index + match.Length)..Math.Min(candidate.Length, match.Index + match.Length + 40)])))
                    {
                        continue;
                    }

                    var key = $"{pattern.Id}|{Normalize(match.Value).ToLowerInvariant()}|{Snippet(candidate, match.Index, match.Index + match.Length)}";
                    if (!seen.Add(key))
                    {
                        continue;
                    }

                    found.Add(new Dictionary<string, object?>
                    {
                        ["pattern"] = pattern.Id,
                        ["pattern_name"] = pattern.Name,
                        ["weight"] = pattern.Weight.ToString(CultureInfo.InvariantCulture),
                        ["value"] = match.Value,
                        ["snippet"] = Snippet(candidate, match.Index, match.Index + match.Length),
                    });

                    if (found.Count >= MaxMatches)
                    {
                        return Collapse(found);
                    }
                }
            }
        }

        return Collapse(found);
    }

    private static List<Dictionary<string, object?>> Collapse(List<Dictionary<string, object?>> matches)
    {
        var ids = matches.Select(item => Text.Sanitize(item.GetValueOrDefault("pattern"))).ToHashSet(StringComparer.Ordinal);
        if (ids.Contains("dsp_official_use"))
        {
            return matches
                .Where(item => Text.Sanitize(item.GetValueOrDefault("pattern")) is not ("dsp_ocr_variant" or "dsp_ocr_context"))
                .ToList();
        }

        if (ids.Contains("dsp_ocr_variant"))
        {
            return matches
                .Where(item => Text.Sanitize(item.GetValueOrDefault("pattern")) != "dsp_ocr_context")
                .ToList();
        }

        return matches;
    }

    public static string Normalize(string value)
    {
        var text = (value ?? string.Empty).Normalize(NormalizationForm.FormKC)
            .Replace('ё', 'е')
            .Replace('Ё', 'Е')
            .Replace("\u00ad", string.Empty)
            .Replace("\u200b", string.Empty);

        text = HyphenInsideWord.Replace(text, string.Empty);
        text = SpacedDspPhrase.Replace(text, "Для служебного пользования");
        text = SpacedCyrillicWord.Replace(text, match => Whitespace.Replace(match.Value, string.Empty));

        var builder = new StringBuilder(text.Length);
        foreach (var symbol in text)
        {
            var index = Array.IndexOf(OcrLatin, symbol);
            builder.Append(index >= 0 ? OcrCyrillic[index] : symbol);
        }

        return Whitespace.Replace(builder.ToString(), " ").Trim();
    }

    public static string Snippet(string text, int start, int end)
    {
        var left = Math.Max(0, start - SnippetRadius);
        var right = Math.Min(text.Length, end + SnippetRadius);
        return text[left..right].Replace("\n", " ").Trim();
    }
}

using Hub.Desktop.Diagnostics;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopRedactionTests
{
    [Fact]
    public void RemovesCredentialsHeadersAndUrlQueries()
    {
        const string input = """
            Authorization: Bearer bearer-secret
            Cookie: session=cookie-secret; refresh=refresh-secret
            https://hubit.zsgp.ru/chat?token=query-secret&message=42
            {"access_token":"json-secret","refresh_token":"refresh-json-secret"}
            password=form-secret
            """;

        var redacted = DesktopRedaction.Redact(input);

        Assert.DoesNotContain("bearer-secret", redacted);
        Assert.DoesNotContain("cookie-secret", redacted);
        Assert.DoesNotContain("refresh-secret", redacted);
        Assert.DoesNotContain("query-secret", redacted);
        Assert.DoesNotContain("json-secret", redacted);
        Assert.DoesNotContain("form-secret", redacted);
        Assert.Contains("https://hubit.zsgp.ru/chat", redacted);
        Assert.DoesNotContain("?", redacted);
    }
}

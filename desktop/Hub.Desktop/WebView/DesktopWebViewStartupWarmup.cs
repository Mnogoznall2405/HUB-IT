namespace Hub.Desktop.WebView;

public static class DesktopWebViewStartupWarmup
{
    public static bool ShouldWarmup(bool startedHidden, bool alreadyWarmed) =>
        startedHidden && !alreadyWarmed;

    public static bool ShouldDeferWebViewCreation(bool startedHidden) => startedHidden;
}

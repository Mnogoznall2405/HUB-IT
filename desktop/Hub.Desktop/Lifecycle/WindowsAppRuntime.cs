using Microsoft.Windows.ApplicationModel.DynamicDependency;

namespace Hub.Desktop.Lifecycle;

internal static class WindowsAppRuntime
{
    public static bool TryInitialize(out int hresult)
    {
        var minimumVersion = new PackageVersion(Microsoft.WindowsAppSDK.Runtime.Version.UInt64);
        return Bootstrap.TryInitialize(
            Microsoft.WindowsAppSDK.Release.MajorMinor,
            Microsoft.WindowsAppSDK.Release.VersionTag,
            minimumVersion,
            out hresult);
    }

    public static void Shutdown()
    {
        Bootstrap.Shutdown();
    }
}

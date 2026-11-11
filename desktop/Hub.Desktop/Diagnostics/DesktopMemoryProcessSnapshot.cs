using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace Hub.Desktop.Diagnostics;

internal sealed record DesktopMemoryProcessSnapshot(
    DesktopMemoryProcessDescriptor[] Processes,
    string Route)
{
    public static DesktopMemoryProcessSnapshot? TryCapture(WebView2? view)
    {
        try
        {
            // The property itself throws once recovery disposes the old control.
            var core = view?.CoreWebView2;
            if (core is null)
            {
                return null;
            }

            return new DesktopMemoryProcessSnapshot(
                [
                    new DesktopMemoryProcessDescriptor(
                        Environment.ProcessId,
                        DesktopMemoryProcessKind.Host),
                    .. core.Environment.GetProcessInfos().Select(process =>
                        new DesktopMemoryProcessDescriptor(
                            process.ProcessId,
                            MapProcessKind(process.Kind))),
                ],
                core.Source);
        }
        catch (Exception exception) when (
            exception is InvalidOperationException
            or System.Runtime.InteropServices.COMException)
        {
            // Includes ObjectDisposedException while the WebView is being replaced.
            return null;
        }
    }

    private static DesktopMemoryProcessKind MapProcessKind(
        CoreWebView2ProcessKind kind) => kind switch
    {
        CoreWebView2ProcessKind.Browser => DesktopMemoryProcessKind.Browser,
        CoreWebView2ProcessKind.Renderer => DesktopMemoryProcessKind.Renderer,
        CoreWebView2ProcessKind.Gpu => DesktopMemoryProcessKind.Gpu,
        CoreWebView2ProcessKind.Utility or CoreWebView2ProcessKind.SandboxHelper =>
            DesktopMemoryProcessKind.Utility,
        _ => DesktopMemoryProcessKind.Other,
    };
}

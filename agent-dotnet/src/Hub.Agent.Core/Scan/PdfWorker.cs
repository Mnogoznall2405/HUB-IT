using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Hub.Agent.Core.Diagnostics;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;
using PdfPigDocument = UglyToad.PdfPig.PdfDocument;
using PdfSharpDocument = PdfSharp.Pdf.PdfDocument;

namespace Hub.Agent.Core.Scan;

/// <summary>
/// Short-lived PDF worker (parity with scan_agent/pdf_worker.py): dedicated
/// process, 256 MB job limit, 20 s timeout, first 3 pages as a slice, text layer
/// up to 10 pages / 256k chars.
/// </summary>
public static class PdfWorker
{
    public const int MaxInputBytes = 256 * 1024 * 1024;
    public const int MaxSliceBytes = 16 * 1024 * 1024;
    public const int MaxTextChars = 256_000;
    public const int OcrPageLimit = 3;
    public const int TextPageLimit = 10;
    public const int TimeoutSeconds = 20;

    public sealed record Result(string FileHash, string Text, string SliceB64, int Pages, string Reason);

    public static int Run(string path, TextWriter output)
    {
        Result result;
        IntPtr job = IntPtr.Zero;
        try
        {
            job = LimitMemory();
        }
        catch (Exception)
        {
            result = new Result(string.Empty, string.Empty, string.Empty, 0, "pdf_memory_limit_unavailable");
            output.Write(JsonSerializer.Serialize(result));
            return 0;
        }

        try
        {
            result = Analyze(path);
        }
        catch (OutOfMemoryException)
        {
            result = new Result(string.Empty, string.Empty, string.Empty, 0, "pdf_memory_limit");
        }
        catch (Exception)
        {
            result = new Result(string.Empty, string.Empty, string.Empty, 0, "pdf_worker_failed");
        }
        finally
        {
            if (job != IntPtr.Zero)
            {
                CloseHandle(job);
            }
        }

        output.Write(JsonSerializer.Serialize(result));
        return 0;
    }

    public static Result Analyze(string path)
    {
        FileInfo info;
        try
        {
            info = new FileInfo(path);
            if (!info.Exists)
            {
                return new Result(string.Empty, string.Empty, string.Empty, 0, "pdf_read_failed");
            }

            if (info.Length > MaxInputBytes)
            {
                return new Result(string.Empty, string.Empty, string.Empty, 0, "pdf_input_too_large");
            }
        }
        catch (Exception)
        {
            return new Result(string.Empty, string.Empty, string.Empty, 0, "pdf_read_failed");
        }

        var hash = HashFile(path);
        if (hash.Length == 0)
        {
            return new Result(string.Empty, string.Empty, string.Empty, 0, "pdf_input_too_large");
        }

        var text = string.Empty;
        var reason = "pdf_slice_creation_failed";

        try
        {
            var textParts = new List<string>();
            var charsLeft = MaxTextChars;
            var pageLimit = TextPageLimit;

            using (var document = PdfPigDocument.Open(path))
            {
                var pageCount = document.NumberOfPages;
                for (var pageNumber = 1; pageNumber <= Math.Min(pageLimit, pageCount); pageNumber++)
                {
                    var pageText = document.GetPage(pageNumber).Text ?? string.Empty;
                    if (pageText.Length > charsLeft)
                    {
                        textParts.Add(pageText[..charsLeft]);
                        return new Result(hash, string.Join("\n", textParts).Trim(), string.Empty, 0, "pdf_text_too_large");
                    }

                    textParts.Add(pageText);
                    charsLeft -= pageText.Length;
                }

                text = string.Join("\n", textParts).Trim();

                var pages = Math.Min(OcrPageLimit, pageCount);
                if (pages > 0)
                {
                    var slice = CreateSlice(path, pages);
                    if (slice.Length > 0 && slice.Length <= MaxSliceBytes)
                    {
                        return new Result(hash, text, Convert.ToBase64String(slice), pages, string.Empty);
                    }

                    reason = slice.Length > MaxSliceBytes ? "pdf_slice_too_large" : "pdf_slice_creation_failed";
                }
            }
        }
        catch (Exception)
        {
            // Text layer may still be available even if slicing failed.
        }

        return new Result(hash, text, string.Empty, 0, reason);
    }

    public static byte[] CreateSlice(string path, int pages)
    {
        try
        {
            using var source = PdfReader.Open(path, PdfDocumentOpenMode.Import);
            using var output = new PdfSharpDocument();
            var count = Math.Min(Math.Max(0, pages), source.PageCount);
            for (var index = 0; index < count; index++)
            {
                output.AddPage(source.Pages[index]);
            }

            using var stream = new MemoryStream();
            output.Save(stream, closeStream: false);
            return stream.ToArray();
        }
        catch (Exception)
        {
            return Array.Empty<byte>();
        }
    }

    public static string HashFile(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            using var sha = SHA256.Create();
            var buffer = new byte[1024 * 1024];
            long total = 0;
            while (true)
            {
                var read = stream.Read(buffer, 0, buffer.Length);
                if (read <= 0)
                {
                    break;
                }

                total += read;
                if (total > MaxInputBytes)
                {
                    return string.Empty;
                }

                sha.TransformBlock(buffer, 0, read, null, 0);
            }

            sha.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
            return Convert.ToHexString(sha.Hash ?? Array.Empty<byte>()).ToLowerInvariant();
        }
        catch (Exception)
        {
            return string.Empty;
        }
    }

    public static Result AnalyzeViaWorker(string path, AgentLog log)
    {
        var executable = ResolveWorkerExecutable();
        if (executable is null)
        {
            log.Warn("PDF worker executable was not found");
            return new Result(string.Empty, string.Empty, string.Empty, 0, "pdf_worker_failed");
        }

        try
        {
            var info = new ProcessStartInfo
            {
                FileName = executable,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = new UTF8Encoding(false),
                StandardErrorEncoding = new UTF8Encoding(false),
            };
            info.ArgumentList.Add("--pdf-worker");
            info.ArgumentList.Add(path);

            using var process = Process.Start(info);
            if (process is null)
            {
                return new Result(string.Empty, string.Empty, string.Empty, 0, "pdf_worker_failed");
            }

            var stdout = process.StandardOutput.ReadToEndAsync();
            var stderr = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(TimeoutSeconds * 1000))
            {
                try
                {
                    process.Kill(entireProcessTree: true);
                }
                catch (Exception)
                {
                    // ignore
                }

                return new Result(string.Empty, string.Empty, string.Empty, 0, "pdf_timeout");
            }

            var output = stdout.GetAwaiter().GetResult();
            _ = stderr.GetAwaiter().GetResult();
            if (output.Length == 0)
            {
                return new Result(string.Empty, string.Empty, string.Empty, 0, "pdf_worker_failed");
            }

            return JsonSerializer.Deserialize<Result>(output)
                   ?? new Result(string.Empty, string.Empty, string.Empty, 0, "pdf_worker_failed");
        }
        catch (Exception ex)
        {
            log.Warn($"PDF worker failed: {ex.Message}");
            return new Result(string.Empty, string.Empty, string.Empty, 0, "pdf_worker_failed");
        }
    }

    private static string? ResolveWorkerExecutable()
    {
        var current = Environment.ProcessPath;
        if (!string.IsNullOrWhiteSpace(current)
            && Path.GetFileName(current).Equals("ITInventAgent.exe", StringComparison.OrdinalIgnoreCase))
        {
            return current;
        }

        var candidate = Path.Combine(AppContext.BaseDirectory, "ITInventAgent.exe");
        return File.Exists(candidate) ? candidate : null;
    }

    // ---- Win32 job memory limit -------------------------------------------------

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectExtendedLimitInformation
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    private const uint JobObjectLimitProcessMemory = 0x00000100;
    private const int JobObjectExtendedLimitInformationClass = 9;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr securityAttributes, string? name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        int infoClass,
        ref JobObjectExtendedLimitInformation info,
        uint length);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    private static IntPtr LimitMemory()
    {
        var job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero)
        {
            throw new InvalidOperationException("CreateJobObject failed");
        }

        var info = new JobObjectExtendedLimitInformation
        {
            BasicLimitInformation = new JobObjectBasicLimitInformation
            {
                LimitFlags = JobObjectLimitProcessMemory,
            },
            ProcessMemoryLimit = (UIntPtr)MaxInputBytes,
        };

        if (!SetInformationJobObject(job, JobObjectExtendedLimitInformationClass, ref info, (uint)Marshal.SizeOf<JobObjectExtendedLimitInformation>())
            || !AssignProcessToJobObject(job, GetCurrentProcess()))
        {
            CloseHandle(job);
            throw new InvalidOperationException("Job memory limit failed");
        }

        return job;
    }
}

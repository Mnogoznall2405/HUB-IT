using System.Text;

namespace Hub.Agent.Core.Support;

public static class AtomicFile
{
    static AtomicFile()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
    }

    public static void WriteAllText(string path, string content)
    {
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var tempPath = $"{path}.tmp.{Guid.NewGuid():N}";
        File.WriteAllText(tempPath, content, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        File.Move(tempPath, path, overwrite: true);
    }

    public static string ReadAllTextWithFallback(string path)
    {
        if (!File.Exists(path))
        {
            return string.Empty;
        }

        foreach (var encoding in new[] { new UTF8Encoding(false), Encoding.UTF8, Encoding.GetEncoding(1251) })
        {
            try
            {
                return File.ReadAllText(path, encoding);
            }
            catch (Exception)
            {
                // try the next encoding
            }
        }

        return string.Empty;
    }
}

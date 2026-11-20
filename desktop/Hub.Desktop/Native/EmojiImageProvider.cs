using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Windows.Media.Imaging;

namespace Hub.Desktop.Native;

/// <summary>
/// Цветные Twemoji-иконки для самостоятельных эмодзи UI (пикер, реакции, иконки меню).
/// PNG лежат в Assets/Emoji/&lt;codepoints&gt;.png (Content, копируется в вывод).
/// Имя файла — codepoints в нижнем hex через «-», variation selector FE0F опускается
/// (у jsdelivr-набора файлы без VS16). Промах — null, XAML показывает текст-фоллбэк.
/// </summary>
internal static class EmojiImageProvider
{
    private static readonly ConcurrentDictionary<string, BitmapImage?> Cache = new(StringComparer.Ordinal);

    private static readonly string[] SearchDirs = BuildSearchDirs();

    /// <summary>Замороженный BitmapImage для эмодзи или null, если ассета нет.</summary>
    public static BitmapImage? GetImage(string? emoji)
    {
        if (string.IsNullOrEmpty(emoji))
        {
            return null;
        }

        return Cache.GetOrAdd(emoji, Load);
    }

    /// <summary>«😀» → «1f600», «❤️» → «2764», «👁️» → «1f441» (FE0F отбрасывается).</summary>
    internal static string ToFileName(string emoji)
    {
        var builder = new StringBuilder(emoji.Length * 2);
        foreach (var rune in emoji.EnumerateRunes())
        {
            if (rune.Value is 0xFE0F or 0xFE0E)
            {
                continue;
            }

            if (builder.Length > 0)
            {
                builder.Append('-');
            }

            builder.Append(rune.Value.ToString("x", CultureInfo.InvariantCulture));
        }

        return builder.ToString();
    }

    /// <summary>Есть ли в строке хоть один потенциально эмодзи-символ (быстрая проверка для селекторов шаблонов).</summary>
    internal static bool LooksLikeEmoji(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return false;
        }

        foreach (var rune in value!.EnumerateRunes())
        {
            var cp = rune.Value;
            if (cp is >= 0x1F000 or (>= 0x2190 and <= 0x2BFF) or 0xFE0F)
            {
                return true;
            }
        }

        return false;
    }

    private static BitmapImage? Load(string emoji)
    {
        var fileName = ToFileName(emoji);
        if (fileName.Length == 0)
        {
            return null;
        }

        foreach (var dir in SearchDirs)
        {
            var path = Path.Combine(dir, fileName + ".png");
            if (!File.Exists(path))
            {
                continue;
            }

            try
            {
                var image = new BitmapImage();
                image.BeginInit();
                image.CacheOption = BitmapCacheOption.OnLoad;
                image.UriSource = new Uri(path, UriKind.Absolute);
                image.EndInit();
                image.Freeze();
                return image;
            }
            catch
            {
                // Битый/не-PNG файл — не мешаем отрисовке, показываем текст-фоллбэк.
            }
        }

        return null;
    }

    private static string[] BuildSearchDirs()
    {
        var dirs = new List<string>(2);
        var baseDir = AppContext.BaseDirectory;
        if (!string.IsNullOrEmpty(baseDir))
        {
            dirs.Add(Path.Combine(baseDir, "Assets", "Emoji"));
        }

        var assemblyDir = Path.GetDirectoryName(typeof(EmojiImageProvider).Assembly.Location);
        if (!string.IsNullOrEmpty(assemblyDir)
            && !string.Equals(assemblyDir, baseDir?.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
        {
            dirs.Add(Path.Combine(assemblyDir, "Assets", "Emoji"));
        }

        return dirs.ToArray();
    }
}

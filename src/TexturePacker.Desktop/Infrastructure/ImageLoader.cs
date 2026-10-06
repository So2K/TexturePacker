using System.IO;
using System.Windows.Media.Imaging;

namespace TexturePacker.Desktop.Infrastructure;

internal static class ImageLoader
{
    public static BitmapSource FromPng(byte[] pngBytes)
    {
        using var stream = new MemoryStream(pngBytes, writable: false);
        var bitmap = new BitmapImage();
        bitmap.BeginInit();
        bitmap.CacheOption = BitmapCacheOption.OnLoad;
        bitmap.StreamSource = stream;
        bitmap.EndInit();
        bitmap.Freeze();
        return bitmap;
    }
}

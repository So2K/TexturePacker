using System.Globalization;
using System.Windows.Data;
using TexturePacker.Core;

namespace TexturePacker.Desktop.Controls;

public sealed class LayoutValueConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        var operation = parameter?.ToString();
        if (operation == "half") return value is double width ? width / 2 : 0d;
        if (operation == "badge") return value is string id && id.Length > 0 ? id[..1].ToUpperInvariant() : "";
        if (operation == "tile") return value is string tile && tile.StartsWith("atlas_") && int.TryParse(tile.AsSpan(6), out var index) ? (index + 1).ToString() : "";
        if (operation == "dimensions") return value is string info ? info.Split('·')[0].Trim().Replace('×', 'x') + " px" : "";
        if (value is not TextureMode mode) return "";
        if (operation == "column") return (int)mode * 2;
        if (operation == "action") return mode == TextureMode.InvertMap ? "INVERT / CONVERT MAP" : "PROCESS TEXTURES";
        return mode switch
        {
            TextureMode.ChannelPacking => "CHANNELS",
            TextureMode.CombineAlpha => "+ ALPHA",
            TextureMode.Convert16To8 => "TIF 16→8",
            TextureMode.Atlas => "ATLAS",
            TextureMode.InvertMap => "GLOSS ⇄ ROUGH",
            _ => ""
        };
    }
    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) => Binding.DoNothing;
}

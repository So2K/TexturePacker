using System.Globalization;
using ImageMagick;

namespace TexturePacker.Core;

/// <summary>
/// Processes local texture files without a browser, a server, or color/contrast normalization.
/// Scalar maps always use the source red component, including the map used as an alpha mask.
/// </summary>
public sealed class TextureProcessor
{
    public const int MaxDimension = 16_384;
    public const long MaxPixels = 67_108_864;
    public const long MaxInputBytes = 512L * 1024 * 1024;
    public const int MaxAtlasSide = 20;
    public const int DefaultOutputSize = 1024;

    // Previews and export share the same gate so importing many 8K maps cannot decode them all at once.
    private static readonly SemaphoreSlim ProcessingGate = new(1, 1);
    private static readonly string[] ChannelIds = ["R", "G", "B", "A"];

    static TextureProcessor()
    {
        ResourceLimits.Width = MaxDimension;
        ResourceLimits.Height = MaxDimension;
        ResourceLimits.Area = (ulong)MaxPixels;
        ResourceLimits.Memory = 512UL * 1024 * 1024;
        ResourceLimits.Disk = 1024UL * 1024 * 1024;
        ResourceLimits.MaxMemoryRequest = 256UL * 1024 * 1024;
        ResourceLimits.MaxProfileSize = 16UL * 1024 * 1024;
        ResourceLimits.Thread = (ulong)Math.Clamp(Environment.ProcessorCount, 1, 8);
    }

    public async Task<TextureResult> ProcessAsync(
        TextureMode mode,
        IReadOnlyList<TextureInput> inputs,
        PackOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(inputs);
        if (!Enum.IsDefined(mode)) throw new ArgumentOutOfRangeException(nameof(mode));
        var snapshot = inputs.ToArray();
        ValidateInputs(mode, snapshot);
        await ProcessingGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            return await Task.Run(() => Process(mode, snapshot, options ?? new(), cancellationToken), cancellationToken)
                .ConfigureAwait(false);
        }
        catch (OutOfMemoryException error)
        {
            throw new TextureProcessingException("There is not enough memory for this texture. Reduce the texture dimensions or atlas grid size.", error);
        }
        finally
        {
            ProcessingGate.Release();
        }
    }

    public async Task<TexturePreview> CreatePreviewAsync(
        string path,
        int maxSize = 256,
        CancellationToken cancellationToken = default)
    {
        if (maxSize is < 1 or > 2048)
            throw new ArgumentOutOfRangeException(nameof(maxSize), "Preview size must be between 1 and 2048 pixels.");
        await ProcessingGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            return await Task.Run(() =>
            {
                var info = Inspect(path, cancellationToken);
                using var image = Load(info, cancellationToken);
                if (image.Width > maxSize || image.Height > maxSize)
                {
                    var scale = (double)maxSize / Math.Max(image.Width, image.Height);
                    Resize(image, Math.Max(1, (int)Math.Floor(image.Width * scale)),
                        Math.Max(1, (int)Math.Floor(image.Height * scale)), cancellationToken);
                }
                return new TexturePreview(Encode(image, cancellationToken), info.Width, info.Height, info.Depth);
            }, cancellationToken).ConfigureAwait(false);
        }
        catch (OutOfMemoryException error)
        {
            throw new TextureProcessingException("There is not enough memory to preview this texture. Use a smaller source image.", error);
        }
        finally
        {
            ProcessingGate.Release();
        }
    }

    private static TextureResult Process(TextureMode mode, TextureInput[] inputs, PackOptions options, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        return mode switch
        {
            TextureMode.ChannelPacking => PackChannels(inputs, token),
            TextureMode.CombineAlpha => CombineAlpha(inputs, token),
            TextureMode.Convert16To8 => ConvertTiff(inputs, token),
            TextureMode.Atlas => BuildAtlas(inputs, options, token),
            TextureMode.InvertMap => Invert(inputs, options.Invert ?? new(), token),
            _ => throw new ArgumentOutOfRangeException(nameof(mode))
        };
    }

    private static TextureResult PackChannels(TextureInput[] inputs, CancellationToken token)
    {
        var infos = InspectInputs(inputs, token);
        var width = infos.Count == 0 ? DefaultOutputSize : infos.Values.Min(i => i.Width);
        var height = infos.Count == 0 ? DefaultOutputSize : infos.Values.Min(i => i.Height);
        var output = AllocateRgba(width, height);
        for (var channel = 0; channel < ChannelIds.Length; channel++)
        {
            token.ThrowIfCancellationRequested();
            var slot = inputs.FirstOrDefault(i => i.Id == ChannelIds[channel]);
            if (slot is not null && infos.TryGetValue(slot.Id, out var info))
            {
                using var image = Load(info, token);
                Resize(image, width, height, token);
                using var pixels = image.GetPixels();
                for (var y = 0; y < height; y++)
                {
                    token.ThrowIfCancellationRequested();
                    var red = pixels.ToByteArray(0, y, (uint)width, 1, "R")!;
                    for (var x = 0; x < width; x++) output[((y * width + x) * 4) + channel] = red[x];
                }
            }
            else
            {
                var fill = slot?.FillWhite == true ? (byte)255 : (byte)0;
                for (var p = channel; p < output.Length; p += 4)
                {
                    if ((p & 0x3FFFF) < 4) token.ThrowIfCancellationRequested();
                    output[p] = fill;
                }
            }
        }
        return Result(output, width, height, token);
    }

    private static TextureResult CombineAlpha(TextureInput[] inputs, CancellationToken token)
    {
        var infos = InspectInputs(inputs, token);
        infos.TryGetValue("base", out var baseInfo);
        var width = baseInfo?.Width ?? (infos.Count == 0 ? DefaultOutputSize : infos.Values.Min(i => i.Width));
        var height = baseInfo?.Height ?? (infos.Count == 0 ? DefaultOutputSize : infos.Values.Min(i => i.Height));
        var output = AllocateRgba(width, height);
        var baseSlot = inputs.FirstOrDefault(i => i.Id == "base");
        var alphaSlot = inputs.FirstOrDefault(i => i.Id == "alpha");
        if (baseInfo is not null)
        {
            using var image = Load(baseInfo, token);
            Resize(image, width, height, token);
            using var pixels = image.GetPixels();
            for (var y = 0; y < height; y++)
            {
                token.ThrowIfCancellationRequested();
                var rgb = pixels.ToByteArray(0, y, (uint)width, 1, "RGB")!;
                for (var x = 0; x < width; x++)
                {
                    var p = (y * width + x) * 4;
                    output[p] = rgb[x * 3];
                    output[p + 1] = rgb[x * 3 + 1];
                    output[p + 2] = rgb[x * 3 + 2];
                }
            }
        }
        else if (baseSlot?.FillWhite == true)
        {
            for (var p = 0; p < output.Length; p += 4)
            {
                if ((p & 0x3FFFF) == 0) token.ThrowIfCancellationRequested();
                output[p] = output[p + 1] = output[p + 2] = 255;
            }
        }

        if (infos.TryGetValue("alpha", out var alphaInfo))
        {
            using var image = Load(alphaInfo, token);
            Resize(image, width, height, token);
            using var pixels = image.GetPixels();
            for (var y = 0; y < height; y++)
            {
                token.ThrowIfCancellationRequested();
                var red = pixels.ToByteArray(0, y, (uint)width, 1, "R")!;
                for (var x = 0; x < width; x++) output[(y * width + x) * 4 + 3] = red[x];
            }
        }
        else if (alphaSlot?.FillWhite == true)
        {
            for (var p = 3; p < output.Length; p += 4)
            {
                if ((p & 0x3FFFF) == 3) token.ThrowIfCancellationRequested();
                output[p] = 255;
            }
        }
        return Result(output, width, height, token);
    }

    private static TextureResult ConvertTiff(TextureInput[] inputs, CancellationToken token)
    {
        var input = inputs.FirstOrDefault(i => i.Id == "tif" && HasFile(i));
        if (input is null) throw new TextureProcessingException("Select a TIFF texture to convert.");
        var info = Inspect(input.FilePath!, token);
        if (info.Format != MagickFormat.Tiff)
            throw new TextureProcessingException("The 16-bit converter requires a .tif or .tiff file.");
        using var image = Load(info, token);
        return new TextureResult(Encode(image, token), (int)image.Width, (int)image.Height);
    }

    private static TextureResult Invert(TextureInput[] inputs, InvertChannels channels, CancellationToken token)
    {
        var input = inputs.FirstOrDefault(i => i.Id == "invert_src" && HasFile(i)) ?? inputs.FirstOrDefault(HasFile);
        if (input is null) throw new TextureProcessingException("Select a texture map to invert.");
        var info = Inspect(input.FilePath!, token);
        using var image = Load(info, token);
        var output = AllocateRgba(info.Width, info.Height);
        using var pixels = image.GetPixels();
        for (var y = 0; y < info.Height; y++)
        {
            token.ThrowIfCancellationRequested();
            var row = pixels.ToByteArray(0, y, (uint)info.Width, 1, "RGBA")!;
            for (var p = 0; p < row.Length; p += 4)
            {
                row[p] = channels.R ? (byte)(255 - row[p]) : row[p];
                row[p + 1] = channels.G ? (byte)(255 - row[p + 1]) : row[p + 1];
                row[p + 2] = channels.B ? (byte)(255 - row[p + 2]) : row[p + 2];
                row[p + 3] = channels.A ? (byte)(255 - row[p + 3]) : row[p + 3];
            }
            Buffer.BlockCopy(row, 0, output, y * info.Width * 4, row.Length);
        }
        return Result(output, info.Width, info.Height, token);
    }

    private static TextureResult BuildAtlas(TextureInput[] inputs, PackOptions options, CancellationToken token)
    {
        if (options.AtlasColumns is < 1 or > MaxAtlasSide || options.AtlasRows is < 1 or > MaxAtlasSide)
            throw new TextureProcessingException($"Atlas columns and rows must be between 1 and {MaxAtlasSide}.");
        var active = inputs.Where(HasFile).ToArray();
        if (active.Length == 0) throw new TextureProcessingException("Select at least one texture for the atlas.");
        var cellInfo = Inspect(active[0].FilePath!, token);
        var width = (long)cellInfo.Width * options.AtlasColumns;
        var height = (long)cellInfo.Height * options.AtlasRows;
        ValidateDimensions(width, height, "Atlas");
        using var atlas = new MagickImage(MagickColors.Black, (uint)width, (uint)height);
        AttachCancellation(atlas, token);
        foreach (var input in active)
        {
            token.ThrowIfCancellationRequested();
            var index = ParseAtlasIndex(input.Id);
            if (index >= options.AtlasColumns * options.AtlasRows)
                throw new TextureProcessingException($"Atlas slot {index + 1} is outside the selected grid.");
            var info = input == active[0] ? cellInfo : Inspect(input.FilePath!, token);
            using var image = Load(info, token);
            Resize(image, cellInfo.Width, cellInfo.Height, token);
            // The web version paints onto opaque black. Keep transparent maps opaque in the atlas too.
            RunMagick(() => atlas.Composite(image, index % options.AtlasColumns * cellInfo.Width,
                index / options.AtlasColumns * cellInfo.Height, CompositeOperator.Over), "Unable to compose the atlas", token);
        }
        return new TextureResult(Encode(atlas, token), (int)width, (int)height);
    }

    private static Dictionary<string, SourceInfo> InspectInputs(TextureInput[] inputs, CancellationToken token)
    {
        var result = new Dictionary<string, SourceInfo>(StringComparer.Ordinal);
        foreach (var input in inputs.Where(HasFile)) result.Add(input.Id, Inspect(input.FilePath!, token));
        return result;
    }

    private static SourceInfo Inspect(string path, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        var format = FormatForPath(path);
        try
        {
            using var stream = Open(path);
            using var image = new MagickImage();
            AttachCancellation(image, token);
            image.Ping(stream, Settings(format));
            token.ThrowIfCancellationRequested();
            ValidateDimensions(image.Width, image.Height, Path.GetFileName(path));
            var rotates = format is MagickFormat.Jpeg or MagickFormat.WebP && image.Orientation is
                OrientationType.LeftTop or OrientationType.RightTop or OrientationType.RightBottom or OrientationType.LeftBottom;
            return new SourceInfo(path, format, (int)(rotates ? image.Height : image.Width),
                (int)(rotates ? image.Width : image.Height), (int)image.Depth);
        }
        catch (MagickResourceLimitErrorException error)
        {
            token.ThrowIfCancellationRequested();
            throw new TextureProcessingException($"'{Path.GetFileName(path)}' exceeds the image resource limits. Use at most {MaxDimension:N0} pixels per side and 67,108,864 total pixels.", error);
        }
        catch (MagickException error)
        {
            token.ThrowIfCancellationRequested();
            throw new TextureProcessingException($"Cannot decode '{Path.GetFileName(path)}'. The texture may be corrupt or unsupported.", error);
        }
        catch (IOException error)
        {
            throw new TextureProcessingException($"Cannot read '{Path.GetFileName(path)}'. Check that the file exists and is available.", error);
        }
        catch (UnauthorizedAccessException error)
        {
            throw new TextureProcessingException($"Access to '{Path.GetFileName(path)}' was denied.", error);
        }
    }

    private static MagickImage Load(SourceInfo info, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        var image = new MagickImage();
        AttachCancellation(image, token);
        try
        {
            using var stream = Open(info.Path);
            image.Read(stream, Settings(info.Format));
            token.ThrowIfCancellationRequested();
            // Browser image decoders apply JPEG/WebP EXIF orientation before reporting dimensions.
            if (info.Format is MagickFormat.Jpeg or MagickFormat.WebP) image.AutoOrient();
            ValidateDimensions(image.Width, image.Height, Path.GetFileName(info.Path));
            if (image.Width != info.Width || image.Height != info.Height)
                throw new TextureProcessingException($"'{Path.GetFileName(info.Path)}' changed while processing. Select the file again.");
            // Grayscale and RGB textures retain their numeric values. Convert only other color models.
            if (image.ColorSpace is not (ColorSpace.sRGB or ColorSpace.RGB or ColorSpace.Gray or ColorSpace.LinearGray))
                image.ColorSpace = ColorSpace.sRGB;

            return image;
        }
        catch (Exception error)
        {
            image.Dispose();
            token.ThrowIfCancellationRequested();
            if (error is TextureProcessingException) throw;
            if (error is MagickException or IOException or UnauthorizedAccessException)
                throw new TextureProcessingException($"Cannot read '{Path.GetFileName(info.Path)}'. The image may be corrupt or exceed available image resources.", error);
            throw;
        }
    }

    private static FileStream Open(string path)
    {
        var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length > MaxInputBytes)
        {
            stream.Dispose();
            throw new TextureProcessingException($"'{Path.GetFileName(path)}' exceeds the 512 MiB input file limit.");
        }
        return stream;
    }

    private static MagickReadSettings Settings(MagickFormat format) => new()
    {
        Format = format,
        FrameIndex = 0,
        FrameCount = 1
    };

    private static void Resize(MagickImage image, int width, int height, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (image.Width == width && image.Height == height) return;
        image.FilterType = FilterType.Triangle;
        RunMagick(() => image.Resize(new MagickGeometry((uint)width, (uint)height) { IgnoreAspectRatio = true }),
            "Unable to resize the texture", token);
    }

    private static byte[] Encode(MagickImage image, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        image.Depth = 8;
        image.ColorType = ColorType.TrueColorAlpha;
        image.Settings.SetDefine(MagickFormat.Png, "bit-depth", "8");
        image.Settings.SetDefine(MagickFormat.Png, "color-type", "6");
        image.Settings.SetDefine(MagickFormat.Png, "exclude-chunks", "date,time");
        byte[]? bytes = null;
        RunMagick(() => bytes = image.ToByteArray(MagickFormat.Png), "Unable to encode the PNG texture", token);
        return bytes!;
    }

    private static TextureResult Result(byte[] pixels, int width, int height, CancellationToken token)
    {
        using var image = FromRgba(pixels, width, height, token);
        return new TextureResult(Encode(image, token), width, height);
    }

    private static MagickImage FromRgba(byte[] bytes, int width, int height, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        var image = new MagickImage();
        AttachCancellation(image, token);
        try
        {
            RunMagick(() => image.ReadPixels(bytes, new PixelReadSettings((uint)width, (uint)height, StorageType.Char, PixelMapping.RGBA)),
                "Unable to allocate the texture", token);
            return image;
        }
        catch
        {
            image.Dispose();
            throw;
        }
    }

    private static byte[] AllocateRgba(int width, int height)
    {
        ValidateDimensions(width, height, "Output");
        return new byte[checked(width * height * 4)];
    }

    private static void ValidateDimensions(long width, long height, string label)
    {
        if (width < 1 || height < 1 || width > MaxDimension || height > MaxDimension || width * height > MaxPixels)
            throw new TextureProcessingException($"{label}: dimensions must be between 1 and {MaxDimension:N0} pixels per side, with at most 67,108,864 total pixels.");
    }

    private static void ValidateInputs(TextureMode mode, TextureInput[] inputs)
    {
        if (inputs.Length > MaxAtlasSide * MaxAtlasSide)
            throw new TextureProcessingException("Too many texture inputs.");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var input in inputs)
        {
            if (input is null || string.IsNullOrWhiteSpace(input.Id))
                throw new TextureProcessingException("Every texture input needs a slot identifier.");
            if (!ids.Add(input.Id)) throw new TextureProcessingException($"Texture slot '{input.Id}' was supplied more than once.");
            var valid = mode switch
            {
                TextureMode.ChannelPacking => ChannelIds.Contains(input.Id, StringComparer.Ordinal),
                TextureMode.CombineAlpha => input.Id is "base" or "alpha",
                TextureMode.Convert16To8 => input.Id == "tif",
                TextureMode.InvertMap => input.Id == "invert_src",
                TextureMode.Atlas => IsAtlasId(input.Id),
                _ => false
            };
            if (!valid) throw new TextureProcessingException($"Texture slot '{input.Id}' does not belong to {mode} mode.");
        }
    }

    private static bool HasFile(TextureInput input) => !string.IsNullOrWhiteSpace(input.FilePath);
    private static bool IsAtlasId(string id) => id.StartsWith("atlas_", StringComparison.Ordinal)
        && int.TryParse(id.AsSpan(6), NumberStyles.None, CultureInfo.InvariantCulture, out var index)
        && index is >= 0 and < MaxAtlasSide * MaxAtlasSide;
    private static int ParseAtlasIndex(string id) => IsAtlasId(id) ? int.Parse(id.AsSpan(6), CultureInfo.InvariantCulture)
        : throw new TextureProcessingException($"Invalid atlas slot '{id}'.");

    private static MagickFormat FormatForPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new TextureProcessingException("Select an image file.");
        return Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".png" => MagickFormat.Png,
            ".jpg" or ".jpeg" => MagickFormat.Jpeg,
            ".tif" or ".tiff" => MagickFormat.Tiff,
            ".bmp" => MagickFormat.Bmp,
            ".tga" => MagickFormat.Tga,
            ".webp" => MagickFormat.WebP,
            _ => throw new TextureProcessingException("Unsupported file type. Select PNG, JPEG, TIFF, BMP, TGA, or WebP.")
        };
    }

    private static void AttachCancellation(MagickImage image, CancellationToken token)
        => image.Progress += (_, progress) => progress.Cancel = token.IsCancellationRequested;

    private static void RunMagick(Action action, string message, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        try
        {
            action();
            token.ThrowIfCancellationRequested();
        }
        catch (MagickException error)
        {
            token.ThrowIfCancellationRequested();
            throw new TextureProcessingException($"{message}. The image may exceed available image resources.", error);
        }
    }

    private sealed record SourceInfo(string Path, MagickFormat Format, int Width, int Height, int Depth);
}

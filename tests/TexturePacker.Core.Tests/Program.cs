using ImageMagick;
using TexturePacker.Core;

if (args.Length == 2 && args[0] == "--generate-fixtures")
{
    Fixtures.Generate(Path.GetFullPath(args[1]));
    Console.WriteLine("Generated independent input fixtures.");
    return 0;
}

var suite = new CoreRegressionSuite();
return await suite.RunAsync();

internal sealed class CoreRegressionSuite
{
    private readonly TextureProcessor _processor = new();
    private readonly string _fixtures = Path.Combine(AppContext.BaseDirectory, "fixtures");
    private readonly string _scratch = Path.Combine(Path.GetTempPath(), "TexturePacker-Core-Tests-" + Guid.NewGuid().ToString("N"));
    private int _passed;
    private int _failed;

    public async Task<int> RunAsync()
    {
        Directory.CreateDirectory(_scratch);
        try
        {
            await Check("packing uses red channels and preserves hidden RGB", ChannelPacking);
            await Check("all fallback fills generate a 1024 x 1024 texture", FallbackPacking);
            await Check("packing chooses independent minimum dimensions and resizes", MinimumDimensions);
            await Check("smooth resize weights source RGB by source alpha", TransparentResize);
            await Check("alpha composition uses base dimensions independently of slot order", AlphaComposition);
            await Check("alpha without base uses mask dimensions and fallback RGB", AlphaWithoutBase);
            await Check("alpha composition supports all fallback fills", AlphaFallbacks);
            await Check("sparse rectangular atlas keeps holes and composites alpha over black", SparseAtlas);
            await Check("atlas cell size comes from first populated input", FirstAtlasCell);
            await Check("inversion changes only selected channels", SelectedInversion);
            await Check("16-bit TIFF uses standard ImageMagick quantization with exact endpoints", Gray16Conversion);
            await Check("16-bit RGBA TIFF keeps all channels with standard 8-bit scaling", Rgba16Conversion);
            await Check("TIFF16 scalar maps use the same standard quantization", TiffPacking);
            await Check("16-bit RGBA PNG uses the same standard 8-bit scaling", Png16Conversion);
            await Check("WhiteIsZero16, Gray4 and grayscale alpha TIFF decode correctly", TiffPhotometrics);
            await Check("signed and floating-point TIFF samples decode without auto-levels", ExtendedTiffSamples);
            await Check("JPEG EXIF orientation matches browser dimensions", ExifOrientation);
            await Check("preview is bounded, reports original metadata, and unlocks files", Preview);
            await Check("PNG JPEG TIFF BMP TGA WebP decode through the library", SupportedFormats);
            await Check("corrupt, missing and unsupported files fail clearly", InvalidFiles);
            await Check("dimensions, pixel count, atlas bounds and duplicate slots are rejected", Bounds);
            await Check("pre-canceled processing and previews honor cancellation", PreCancellation);
            await Check("queued and active native work honor cancellation", QueuedCancellation);
            Console.WriteLine($"{_passed} passed; {_failed} failed.");
            return _failed == 0 ? 0 : 1;
        }
        finally
        {
            // Only remove this run's fresh, absolute scratch directory inside the system temp directory.
            var allowed = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (Path.GetFullPath(_scratch).StartsWith(allowed, StringComparison.OrdinalIgnoreCase)
                && Path.GetFileName(_scratch).StartsWith("TexturePacker-Core-Tests-", StringComparison.Ordinal)
                && Directory.Exists(_scratch)) Directory.Delete(_scratch, recursive: true);
        }
    }

    private async Task Check(string name, Func<Task> check)
    {
        try
        {
            await check();
            _passed++;
            Console.WriteLine($"PASS {name}");
        }
        catch (Exception error)
        {
            _failed++;
            Console.Error.WriteLine($"FAIL {name}: {error}");
        }
    }

    private string File(string name) => Path.Combine(_fixtures, name);
    private TextureInput Input(string id, string? file = null, bool white = false) => new(id, file is null ? null : File(file), white);

    private async Task ChannelPacking()
    {
        var result = await _processor.ProcessAsync(TextureMode.ChannelPacking,
            [Input("R", "rgba-2x2.png"), Input("G", "rgba-2x2.png"), Input("B", white: true), Input("A", white: true)]);
        var pixels = Decode(result, 2, 2);
        Equal(pixels, [10, 10, 255, 255, 80, 80, 255, 255, 170, 170, 255, 255, 255, 255, 255, 255]);
    }

    private async Task FallbackPacking()
    {
        var result = await _processor.ProcessAsync(TextureMode.ChannelPacking,
            [Input("R", white: true), Input("G"), Input("B", white: true), Input("A")]);
        var pixels = Decode(result, 1024, 1024);
        EveryPixel(pixels, [255, 0, 255, 0]);
        var omitted = await _processor.ProcessAsync(TextureMode.ChannelPacking, []);
        EveryPixel(Decode(omitted, 1024, 1024), [0, 0, 0, 0]);
    }

    private async Task MinimumDimensions()
    {
        var result = await _processor.ProcessAsync(TextureMode.ChannelPacking,
            [Input("R", "opaque-3x1.png"), Input("G", "mask-1x2.png"), Input("B"), Input("A", white: true)]);
        var pixels = Decode(result, 1, 1);
        Assert(pixels[0] == 20 && pixels[2] == 0 && pixels[3] == 255, "The constant source and fallbacks changed during resize.");
        Assert(pixels[1] is > 40 and < 210, "Smooth downsampling should combine both mask rows.");
    }

    private async Task AlphaComposition()
    {
        var result = await _processor.ProcessAsync(TextureMode.CombineAlpha,
            [Input("alpha", "mask-1x2.png"), Input("base", "rgba-2x2.png")]);
        Equal(Decode(result, 2, 2), [10, 200, 99, 40, 80, 11, 220, 40, 170, 90, 44, 210, 255, 0, 13, 210]);
        var afterEmptyMask = await _processor.ProcessAsync(TextureMode.CombineAlpha,
            [Input("alpha", white: true), Input("base", "opaque-3x1.png")]);
        EveryPixel(Decode(afterEmptyMask, 3, 1), [20, 45, 100, 255]);
    }

    private async Task TransparentResize()
    {
        var result = await _processor.ProcessAsync(TextureMode.ChannelPacking,
            [Input("R", "rgba-2x2.png"), Input("G", "mask-1x2.png"), Input("B", "rgba-2x2.png"), Input("A", "rgba-2x2.png")]);
        Equal(Decode(result, 1, 2), [33, 40, 33, 33, 255, 210, 255, 255]);
    }

    private async Task AlphaWithoutBase()
    {
        var result = await _processor.ProcessAsync(TextureMode.CombineAlpha,
            [Input("base", white: true), Input("alpha", "mask-1x2.png")]);
        Equal(Decode(result, 1, 2), [255, 255, 255, 40, 255, 255, 255, 210]);
    }

    private async Task AlphaFallbacks()
    {
        var result = await _processor.ProcessAsync(TextureMode.CombineAlpha,
            [Input("base", white: true), Input("alpha", white: true)]);
        EveryPixel(Decode(result, 1024, 1024), [255, 255, 255, 255]);
    }

    private async Task SparseAtlas()
    {
        var result = await _processor.ProcessAsync(TextureMode.Atlas,
            [Input("atlas_1", "half-alpha-1x1.png"), Input("atlas_5", "opaque-3x1.png")], new(3, 2));
        var pixels = Decode(result, 3, 2);
        Equal(pixels, [0, 0, 0, 255, 100, 50, 25, 255, 0, 0, 0, 255,
            0, 0, 0, 255, 0, 0, 0, 255, 20, 45, 100, 255]);
    }

    private async Task FirstAtlasCell()
    {
        var result = await _processor.ProcessAsync(TextureMode.Atlas,
            [Input("atlas_0"), Input("atlas_3", "opaque-3x1.png"), Input("atlas_1", "half-alpha-1x1.png")], new(2, 2));
        var pixels = Decode(result, 6, 2);
        Assert(pixels.Length == 48, "The first populated slot must determine the 3 x 1 cell dimensions.");
        var maximumGrid = await _processor.ProcessAsync(TextureMode.Atlas, [Input("atlas_399", "half-alpha-1x1.png")], new(20, 20));
        Assert(maximumGrid.Width == 20 && maximumGrid.Height == 20, "The original 20 x 20 grid must remain supported.");
    }

    private async Task SelectedInversion()
    {
        var result = await _processor.ProcessAsync(TextureMode.InvertMap,
            [Input("invert_src", "rgba-2x2.png")], new(Invert: new(false, true, false, true)));
        Equal(Decode(result, 2, 2), [10, 55, 99, 0, 80, 244, 220, 127, 170, 165, 44, 255, 255, 255, 13, 0]);
        var defaultResult = await _processor.ProcessAsync(TextureMode.InvertMap, [Input("invert_src", "rgba-2x2.png")]);
        Equal(Decode(defaultResult, 2, 2), [245, 55, 156, 255, 175, 244, 35, 128, 85, 165, 211, 0, 0, 255, 242, 255]);
    }

    private async Task Gray16Conversion()
    {
        var result = await _processor.ProcessAsync(TextureMode.Convert16To8, [Input("tif", "gray16-8x1.tiff")]);
        var values = new byte[] { 0, 1, 1, 1, 127, 128, 255, 255 };
        var expected = values.SelectMany(value => new byte[] { value, value, value, 255 }).ToArray();
        Equal(Decode(result, 8, 1), expected);
    }

    private async Task Rgba16Conversion()
    {
        var result = await _processor.ProcessAsync(TextureMode.Convert16To8, [Input("tif", "rgba16-2x1.tiff")]);
        Equal(Decode(result, 2, 1), [2, 255, 18, 255, 128, 127, 254, 1]);
    }

    private async Task TiffPacking()
    {
        var result = await _processor.ProcessAsync(TextureMode.ChannelPacking,
            [Input("R", "rgba16-2x1.tiff"), Input("G"), Input("B"), Input("A", white: true)]);
        Equal(Decode(result, 2, 1), [2, 0, 0, 255, 128, 0, 0, 255]);
    }

    private async Task TiffPhotometrics()
    {
        foreach (var (name, expected) in new (string, byte[])[]
        {
            ("white16.tif", [255,255,255,255,0,0,0,255]),
            ("black4.tif", [0,0,0,255,255,255,255,255]),
            ("gray-alpha8.tif", [40,40,40,80,210,210,210,0]),
            ("gray-alpha16.tif", [2,2,2,128,254,254,254,1])
        })
        {
            var result = await _processor.ProcessAsync(TextureMode.Convert16To8, [Input("tif", name)]);
            Equal(Decode(result, 2, 1), expected);
        }
    }

    private async Task Png16Conversion()
    {
        var source = await System.IO.File.ReadAllBytesAsync(File("rgba16-2x1.png"));
        Assert(source[24] == 16 && source[25] == 6, "The input fixture must be a 16-bit RGBA PNG.");
        var result = await _processor.ProcessAsync(TextureMode.InvertMap,
            [Input("invert_src", "rgba16-2x1.png")], new(Invert: new(false,false,false,false)));
        Equal(Decode(result, 2, 1), [2,255,18,255,128,127,254,1]);
    }

    private async Task ExtendedTiffSamples()
    {
        var signed = await _processor.ProcessAsync(TextureMode.Convert16To8, [Input("tif", "signed16.tif")]);
        Equal(Decode(signed, 2, 1), [128,128,128,255,0,0,0,255]);
        var floating = await _processor.ProcessAsync(TextureMode.Convert16To8, [Input("tif", "float32.tif")]);
        Equal(Decode(floating, 2, 1), [64,64,64,255,191,191,191,255]);
    }

    private async Task ExifOrientation()
    {
        var result = await _processor.ProcessAsync(TextureMode.InvertMap,
            [Input("invert_src", "orientation6.jpg")], new(Invert: new(false,false,false,false)));
        Decode(result, 2, 3);
        var preview = await _processor.CreatePreviewAsync(File("orientation6.jpg"));
        Assert(preview.Width == 2 && preview.Height == 3, "EXIF-oriented preview metadata should match browser dimensions.");
        using var thumbnail = new MagickImage(preview.PngBytes);
        Assert(thumbnail.Width == 2 && thumbnail.Height == 3, "EXIF-oriented preview pixels should match browser dimensions.");
    }

    private async Task Preview()
    {
        var local = Path.Combine(_scratch, "preview.tiff");
        System.IO.File.Copy(File("gray16-8x1.tiff"), local);
        var preview = await _processor.CreatePreviewAsync(local, 3);
        Assert(preview.Width == 8 && preview.Height == 1 && preview.BitDepth == 16, "Preview metadata must describe the original TIFF.");
        using var png = new MagickImage(preview.PngBytes);
        Assert(png.Width == 3 && png.Height == 1, "Preview thumbnail exceeded its bound.");
        Assert(preview.PngBytes[24] == 8 && preview.PngBytes[25] == 6, "Preview must use an 8-bit RGBA PNG.");
        using var reopened = new FileStream(local, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
        Assert(reopened.Length > 0, "Source was not unlocked after preview.");
    }

    private async Task SupportedFormats()
    {
        foreach (var name in new[] { "opaque-3x1.png", "opaque-3x1.jpg", "gray16-8x1.tiff", "opaque-3x1.bmp", "opaque-3x1.tga", "opaque-3x1.webp" })
        {
            var preview = await _processor.CreatePreviewAsync(File(name));
            Assert(preview.Width > 0 && preview.Height > 0 && preview.PngBytes.Length > 0, $"No decoded pixels for {name}.");
            using var unlocked = new FileStream(File(name), FileMode.Open, FileAccess.ReadWrite, FileShare.None);
            Assert(unlocked.Length > 0, $"Decoder left {name} locked.");
        }
    }

    private async Task InvalidFiles()
    {
        var corrupt = Path.Combine(_scratch, "corrupt.png");
        await System.IO.File.WriteAllTextAsync(corrupt, "not an image");
        await Throws<TextureProcessingException>(() => _processor.CreatePreviewAsync(corrupt));
        await Throws<TextureProcessingException>(() => _processor.CreatePreviewAsync(Path.Combine(_scratch, "missing.png")));
        await Throws<TextureProcessingException>(() => _processor.CreatePreviewAsync(Path.Combine(_scratch, "unsupported.svg")));
        await Throws<TextureProcessingException>(() => _processor.ProcessAsync(TextureMode.Convert16To8, [Input("tif", "opaque-3x1.png")]));
        await Throws<TextureProcessingException>(() => _processor.ProcessAsync(TextureMode.Atlas, []));
        await Throws<TextureProcessingException>(() => _processor.ProcessAsync(TextureMode.InvertMap, []));
    }

    private async Task Bounds()
    {
        var oversizedWidth = Path.Combine(_scratch, "oversized-width.tiff");
        Fixtures.WriteSparseTiff(oversizedWidth, TextureProcessor.MaxDimension + 1, 1);
        await Throws<TextureProcessingException>(() => _processor.CreatePreviewAsync(oversizedWidth));
        var oversizedPixels = Path.Combine(_scratch, "oversized-pixels.tiff");
        Fixtures.WriteSparseTiff(oversizedPixels, 9000, 9000);
        await Throws<TextureProcessingException>(() => _processor.CreatePreviewAsync(oversizedPixels));
        var oversizedAtlas = Path.Combine(_scratch, "oversized-atlas-source.tiff");
        Fixtures.WriteSparseTiff(oversizedAtlas, 1024, 1024);
        await Throws<TextureProcessingException>(() => _processor.ProcessAsync(TextureMode.Atlas,
            [new("atlas_0", oversizedAtlas, false)], new(16, 16)));
        await Throws<TextureProcessingException>(() => _processor.ProcessAsync(TextureMode.Atlas, [Input("atlas_0", "opaque-3x1.png")], new(21, 1)));
        await Throws<TextureProcessingException>(() => _processor.ProcessAsync(TextureMode.Atlas, [Input("atlas_5", "opaque-3x1.png")], new(2, 2)));
        await Throws<TextureProcessingException>(() => _processor.ProcessAsync(TextureMode.ChannelPacking, [Input("R"), Input("R")]));
        await Throws<TextureProcessingException>(() => _processor.ProcessAsync(TextureMode.ChannelPacking, [Input("not-a-channel")]));
        await Throws<ArgumentOutOfRangeException>(() => _processor.CreatePreviewAsync(File("opaque-3x1.png"), 0));
        var largeFile = Path.Combine(_scratch, "oversized-file.png");
        using (var stream = new FileStream(largeFile, FileMode.CreateNew)) stream.SetLength(TextureProcessor.MaxInputBytes + 1);
        await Throws<TextureProcessingException>(() => _processor.CreatePreviewAsync(largeFile));
    }

    private async Task PreCancellation()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        await Throws<OperationCanceledException>(() => _processor.ProcessAsync(TextureMode.ChannelPacking, [], cancellationToken: cts.Token));
        await Throws<OperationCanceledException>(() => _processor.CreatePreviewAsync(File("rgba-2x2.png"), cancellationToken: cts.Token));
    }

    private async Task QueuedCancellation()
    {
        var large = Path.Combine(_scratch, "large.png");
        using (var image = new MagickImage(MagickColors.Gray, 2048, 2048)) image.Write(large);
        using var activeCts = new CancellationTokenSource();
        using var queuedCts = new CancellationTokenSource();
        var active = _processor.ProcessAsync(TextureMode.Atlas, [new("atlas_0", large, false)], new(4, 4), activeCts.Token);
        Assert(!active.IsCompleted, "The large native operation completed before cancellation could be exercised.");
        var queued = _processor.CreatePreviewAsync(File("rgba-2x2.png"), cancellationToken: queuedCts.Token);
        queuedCts.Cancel();
        await Throws<OperationCanceledException>(() => queued);
        activeCts.Cancel();
        await Throws<OperationCanceledException>(() => active);
        using (var unlocked = new FileStream(large, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            Assert(unlocked.Length > 0, "Cancellation left the image file locked.");
        // The gate must be released after both cancellation paths.
        var after = await _processor.CreatePreviewAsync(File("rgba-2x2.png"));
        Assert(after.Width == 2, "Processing did not recover after cancellation.");
    }

    private static byte[] Decode(TextureResult result, int width, int height)
    {
        Assert(result.Width == width && result.Height == height, $"Expected {width} x {height}; got {result.Width} x {result.Height}.");
        Assert(result.PngBytes.Length > 26 && result.PngBytes[24] == 8 && result.PngBytes[25] == 6, "Output is not an 8-bit RGBA PNG.");
        using var image = new MagickImage(result.PngBytes);
        Assert(image.Width == width && image.Height == height, "PNG metadata differs from the returned dimensions.");
        using var pixels = image.GetPixels();
        return pixels.ToByteArray("RGBA")!;
    }

    private static void Equal(byte[] actual, byte[] expected)
    {
        Assert(actual.Length == expected.Length, $"Expected {expected.Length} values; got {actual.Length}.");
        for (var i = 0; i < expected.Length; i++)
            Assert(actual[i] == expected[i], $"Pixel {i / 4}, component {i % 4}: expected {expected[i]}; got {actual[i]}.");
    }

    private static void EveryPixel(byte[] actual, byte[] expected)
    {
        for (var i = 0; i < actual.Length; i++)
            Assert(actual[i] == expected[i % 4], $"Pixel {i / 4}, component {i % 4}: expected {expected[i % 4]}; got {actual[i]}.");
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private static async Task Throws<T>(Func<Task> action) where T : Exception
    {
        try { await action(); }
        catch (T) { return; }
        throw new InvalidOperationException($"Expected {typeof(T).Name}.");
    }
}

internal static class Fixtures
{
    public static void Generate(string directory)
    {
        Directory.CreateDirectory(directory);
        WriteRgba(directory, "rgba-2x2.png", 2, 2, [10, 200, 99, 255, 80, 11, 220, 128, 170, 90, 44, 0, 255, 0, 13, 255]);
        WriteRgba(directory, "mask-1x2.png", 1, 2, [40, 200, 250, 255, 210, 10, 11, 255]);
        WriteRgba(directory, "half-alpha-1x1.png", 1, 1, [200, 100, 50, 128]);
        foreach (var extension in new[] { "png", "jpg", "bmp", "tga", "webp" })
            WriteRgba(directory, "opaque-3x1." + extension, 3, 1, [20, 45, 100, 255, 20, 45, 100, 255, 20, 45, 100, 255]);
        WriteTiff(directory, "gray16-8x1.tiff", 8, 1, "R", [0, 255, 256, 257, 32767, 32768, 65534, 65535]);
        WriteTiff(directory, "rgba16-2x1.tiff", 2, 1, "RGBA", [0x01ff, 0xffff, 0x1234, 0xffff, 0x80ff, 0x7fff, 0xff00, 0x00ff]);
        WriteTiff(directory, "rgba16-2x1.png", 2, 1, "RGBA", [0x01ff, 0xffff, 0x1234, 0xffff, 0x80ff, 0x7fff, 0xff00, 0x00ff]);
    }

    private static void WriteRgba(string directory, string name, uint width, uint height, byte[] pixels)
    {
        using var image = new MagickImage(pixels, new PixelReadSettings(width, height, StorageType.Char, PixelMapping.RGBA));
        image.Depth = 8;
        image.Settings.SetDefine(MagickFormat.Png, "color-type", "6");
        image.Write(Path.Combine(directory, name));
    }

    private static void WriteTiff(string directory, string name, uint width, uint height, string mapping, ushort[] pixels)
    {
        using var image = new MagickImage();
        image.ReadPixels(pixels, new PixelReadSettings(width, height, StorageType.Quantum, mapping));
        if (mapping == "R") image.ColorType = ColorType.Grayscale;
        image.Depth = 16;
        image.Settings.Compression = CompressionMethod.NoCompression;
        image.Settings.SetDefine(MagickFormat.Tiff, "alpha", "unassociated");
        image.Settings.SetDefine(MagickFormat.Png, "bit-depth", "16");
        image.Settings.SetDefine(MagickFormat.Png, "color-type", "6");
        image.Write(Path.Combine(directory, name));
    }

    public static void WriteSparseTiff(string path, uint width, uint height)
    {
        using var stream = System.IO.File.Create(path);
        using var writer = new BinaryWriter(stream);
        writer.Write((byte)'I'); writer.Write((byte)'I'); writer.Write((ushort)42); writer.Write(8U);
        writer.Write((ushort)9);
        Entry(writer, 256, 4, width); Entry(writer, 257, 4, height); Entry(writer, 258, 3, 8);
        Entry(writer, 259, 3, 1); Entry(writer, 262, 3, 1); Entry(writer, 273, 4, 122);
        Entry(writer, 277, 3, 1); Entry(writer, 278, 4, height); Entry(writer, 279, 4, checked(width * height));
        writer.Write(0U); writer.Write((byte)0);
        writer.Flush();
        stream.SetLength(122L + (long)width * height);
    }

    private static void Entry(BinaryWriter writer, ushort tag, ushort type, uint value)
    {
        writer.Write(tag); writer.Write(type); writer.Write(1U); writer.Write(value);
    }
}

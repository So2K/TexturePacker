namespace TexturePacker.Core;

public enum TextureMode
{
    ChannelPacking,
    CombineAlpha,
    Convert16To8,
    Atlas,
    InvertMap
}

public sealed record TextureInput(string Id, string? FilePath, bool FillWhite);
public sealed record InvertChannels(bool R = true, bool G = true, bool B = true, bool A = false);
public sealed record PackOptions(int AtlasColumns = 4, int AtlasRows = 4, InvertChannels? Invert = null);
public sealed record TextureResult(byte[] PngBytes, int Width, int Height);

/// <summary>Original image metadata together with a PNG thumbnail bounded by the requested size.</summary>
public sealed record TexturePreview(byte[] PngBytes, int Width, int Height, int BitDepth);

/// <summary>A validation or decoder error that is suitable for displaying in the application.</summary>
public sealed class TextureProcessingException : Exception
{
    public TextureProcessingException(string message) : base(message) { }
    public TextureProcessingException(string message, Exception innerException) : base(message, innerException) { }
}

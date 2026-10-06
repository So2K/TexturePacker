import { ColorSpace, ImageMagick, initializeImageMagick, MagickColors, MagickFormat, MagickReadSettings, ResourceLimits } from '@imagemagick/magick-wasm';
import wasmUrl from '@imagemagick/magick-wasm/magick.wasm?url';
import { MAX_DIMENSION, MAX_PIXELS, validateDimensions } from './packer';

let initialization: Promise<void> | undefined;
function initialize() {
  return initialization ??= initializeImageMagick(new URL(wasmUrl, import.meta.url)).then(() => {
    ResourceLimits.width = BigInt(MAX_DIMENSION);
    ResourceLimits.height = BigInt(MAX_DIMENSION);
    ResourceLimits.memory = 512n * 1024n * 1024n;
    ResourceLimits.maxMemoryRequest = 512n * 1024n * 1024n;
    ResourceLimits.area = BigInt(MAX_PIXELS);
    ResourceLimits.disk = 0n;
  }).catch(error => { initialization = undefined; throw error; });
}

export async function decodeTiff(bytes: Uint8Array, format: 'TIFF' | 'PNG' = 'TIFF') {
  await initialize();
  const settings = new MagickReadSettings({ format: format === 'TIFF' ? MagickFormat.Tiff : MagickFormat.Png, frameIndex: 0, frameCount: 1 });
  return ImageMagick.read(MagickColors.Black, 1, 1, image => {
    // Ping validates size without allocating the decompressed image.
    image.ping(bytes, settings);
    validateDimensions(image.width, image.height);
    image.read(bytes, settings);
    validateDimensions(image.width, image.height);
    const numericColorSpaces: ColorSpace[] = [ColorSpace.sRGB, ColorSpace.RGB, ColorSpace.Gray, ColorSpace.LinearGray];
    if (!numericColorSpaces.includes(image.colorSpace)) image.colorSpace = ColorSpace.sRGB;
    const width = image.width, height = image.height;
    const data = image.getPixels(pixels => pixels.toByteArray(0, 0, width, height, 'RGBA'));
    if (!data || data.length !== width * height * 4) throw new Error('TIFF pixel data is incomplete.');
    return { width, height, data };
  });
}

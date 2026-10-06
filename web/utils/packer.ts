import UPNG from 'upng-js';
import { encode as encodePng } from 'fast-png';
import { decodeTga } from '@lunapaint/tga-codec';
import { ChannelState, AppMode, PackResult, PackOptions } from '../types';

export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.tif,.tiff,.bmp,.tga,.webp';
export const MAX_DIMENSION = 16_384;
export const MAX_PIXELS = 67_108_864;
interface Pixels { width: number; height: number; data: Uint8Array | Uint8ClampedArray }

export function validateDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('The image has invalid dimensions.');
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) throw new Error('Image is too large. Use at most 16,384 pixels per side and 64 megapixels.');
}

function context(width: number, height: number) {
  validateDimensions(width, height);
  const canvas = typeof document === 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Your browser could not create an image canvas.');
  return { canvas, ctx };
}

function toCanvas(image: Pixels): HTMLCanvasElement | OffscreenCanvas {
  const { canvas, ctx } = context(image.width, image.height);
  const pixels = ctx.createImageData(image.width, image.height);
  pixels.data.set(image.data);
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

export async function decodeTexture(file: File): Promise<Pixels> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!extension || !IMAGE_ACCEPT.split(',').includes(`.${extension}`)) throw new Error('Choose a PNG, JPEG, TIFF, BMP, TGA or WebP image.');
  if (file.size > 512 * 1024 * 1024) throw new Error('File is too large. Choose an image smaller than 512 MB.');
  try {
    if (extension === 'tif' || extension === 'tiff') {
      const { decodeTiff } = await import('./tiff-decoder');
      return await decodeTiff(new Uint8Array(await file.arrayBuffer()));
    }
    if (extension === 'png') {
      const buffer = await file.arrayBuffer();
      if (buffer.byteLength < 24) throw new Error('Invalid PNG header.');
      const header = new DataView(buffer);
      if (header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a) throw new Error('Invalid PNG header.');
      validateDimensions(header.getUint32(16), header.getUint32(20));
      if (buffer.byteLength > 24 && header.getUint8(24) === 16) {
        const { decodeTiff } = await import('./tiff-decoder');
        return await decodeTiff(new Uint8Array(buffer), 'PNG');
      }
      const png = UPNG.decode(buffer);
      return { width: png.width, height: png.height, data: new Uint8Array(UPNG.toRGBA8(png)[0]) };
    }
    if (extension === 'tga') {
      const buffer = await file.arrayBuffer();
      if (buffer.byteLength < 18) throw new Error('Invalid TGA header.');
      const header = new DataView(buffer);
      validateDimensions(header.getUint16(12, true), header.getUint16(14, true));
      const { image } = await decodeTga(new Uint8Array(buffer), { detectAmbiguousAlphaChannel: true });
      return image;
    }
    if (typeof document === 'undefined') {
      const image = await createImageBitmap(file, { colorSpaceConversion: 'none' });
      try {
        const { ctx } = context(image.width, image.height);
        ctx.drawImage(image, 0, 0);
        return { width: image.width, height: image.height, data: ctx.getImageData(0, 0, image.width, image.height).data };
      } finally { image.close(); }
    }
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('The image could not be decoded.'));
        img.src = url;
      });
      const { ctx } = context(image.naturalWidth, image.naturalHeight);
      ctx.drawImage(image, 0, 0);
      return { width: image.naturalWidth, height: image.naturalHeight, data: ctx.getImageData(0, 0, image.naturalWidth, image.naturalHeight).data };
    } finally { URL.revokeObjectURL(url); }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid or unsupported image data.';
    throw new Error(`${file.name}: ${message.includes('@ error/') ? 'The image is corrupt or unsupported.' : message}`);
  }
}

export async function generatePreview(file: File): Promise<string> {
  const image = await decodeTexture(file);
  const scale = Math.min(1, 512 / Math.max(image.width, image.height));
  const { canvas, ctx } = context(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  ctx.drawImage(toCanvas(image), 0, 0, canvas.width, canvas.height);
  const blob = 'convertToBlob' in canvas ? await canvas.convertToBlob({ type: 'image/png' }) : await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create image preview.')), 'image/png'));
  return URL.createObjectURL(blob);
}

function resize(image: Pixels, width: number, height: number): Uint8Array | Uint8ClampedArray {
  if (image.width === width && image.height === height) return image.data;
  const { ctx } = context(width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(toCanvas(image), 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

function encode(data: Uint8Array, width: number, height: number): PackResult {
  // Lossless non-paletted PNG preserves channel values even when alpha is zero.
  const png = encodePng({ data, width, height, channels: 4, depth: 8 });
  return { url: URL.createObjectURL(new Blob([png], { type: 'image/png' })), width, height };
}

export async function packTextures(mode: AppMode, channels: ChannelState[], options: PackOptions = {}): Promise<PackResult> {
  if (mode === AppMode.Atlas) return packAtlas(channels, options);
  const images = new Map<string, Pixels>();
  for (const slot of channels) if (slot.file) images.set(slot.id, await decodeTexture(slot.file));
  const fallback = (id: string) => channels.find(slot => slot.id === id)?.fallback === 'white' ? 255 : 0;
  if (mode === AppMode.Convert16to8 || mode === AppMode.InvertMap) {
    const id = mode === AppMode.Convert16to8 ? 'tif' : 'invert_src';
    const slot = channels.find(slot => slot.id === id);
    const image = images.get(id);
    if (!image) throw new Error(mode === AppMode.Convert16to8 ? 'Choose a TIFF file first.' : 'Choose a texture to invert first.');
    if (mode === AppMode.Convert16to8 && !/\.tiff?$/i.test(slot!.file!.name)) throw new Error('Choose a .tif or .tiff file for TIFF conversion.');
    const data = new Uint8Array(image.data);
    if (mode === AppMode.InvertMap) {
      const invert = options.invertChannels ?? { r: true, g: true, b: true, a: false };
      const flags = [invert.r, invert.g, invert.b, invert.a];
      for (let i = 0; i < data.length; i++) if (flags[i % 4]) data[i] = 255 - data[i];
    }
    return encode(data, image.width, image.height);
  }
  const base = images.get('base'), loaded = [...images.values()];
  const width = mode === AppMode.CombineAlpha && base ? base.width : loaded.length ? Math.min(...loaded.map(image => image.width)) : 1024;
  const height = mode === AppMode.CombineAlpha && base ? base.height : loaded.length ? Math.min(...loaded.map(image => image.height)) : 1024;
  validateDimensions(width, height);
  const data = new Uint8Array(width * height * 4);
  const resized = new Map([...images].map(([id, image]) => [id, resize(image, width, height)]));
  if (mode === AppMode.CombineAlpha) {
    const rgb = resized.get('base'), alpha = resized.get('alpha');
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) data[i + c] = rgb ? rgb[i + c] : fallback('base');
      data[i + 3] = alpha ? alpha[i] : fallback('alpha');
    }
  } else {
    const ids = ['R', 'G', 'B', 'A'];
    for (let c = 0; c < 4; c++) {
      const source = resized.get(ids[c]), fill = fallback(ids[c]);
      for (let i = 0; i < data.length; i += 4) data[i + c] = source ? source[i] : fill;
    }
  }
  return encode(data, width, height);
}

async function packAtlas(channels: ChannelState[], options: PackOptions): Promise<PackResult> {
  const cols = options.atlasCols ?? 4, rows = options.atlasRows ?? 4;
  if (![cols, rows].every(value => Number.isInteger(value) && value >= 1 && value <= 20)) throw new Error('Atlas columns and rows must be whole numbers from 1 to 20.');
  const active = channels.filter(slot => slot.file);
  if (!active.length) throw new Error('Add at least one texture to the atlas.');
  let first: Pixels | null = await decodeTexture(active[0].file!);
  const cellWidth = first.width, cellHeight = first.height;
  const width = cellWidth * cols, height = cellHeight * rows;
  // Reject oversized output before decoding the remaining source images.
  validateDimensions(width, height);
  const data = new Uint8Array(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (const slot of active) {
    const index = Number(slot.id.replace('atlas_', ''));
    if (!Number.isInteger(index) || index < 0 || index >= cols * rows) continue;
    const image = first ?? await decodeTexture(slot.file!);
    const pixels = resize(image, cellWidth, cellHeight);
    first = null;
    const x = index % cols * cellWidth, y = Math.floor(index / cols) * cellHeight;
    for (let sy = 0; sy < cellHeight; sy++) for (let sx = 0; sx < cellWidth; sx++) {
      const src = (sy * cellWidth + sx) * 4, dst = ((y + sy) * width + x + sx) * 4;
      for (let c = 0; c < 3; c++) data[dst + c] = Math.round(pixels[src + c] * pixels[src + 3] / 255);
    }
  }
  return encode(data, width, height);
}

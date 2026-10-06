import { ChannelState, AppMode, PackResult, PackOptions } from '../types';
import * as UTIF from 'utif';

const loadImage = (file: File): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
};

/**
 * Generates an 8-bit PNG preview for a TIFF file.
 * Browsers can't render TIFF natively, so we decode it manually.
 */
export const generateTifPreview = async (file: File): Promise<string> => {
  try {
    const buffer = await file.arrayBuffer();
    const ifds = UTIF.decode(buffer);
    if (!ifds || ifds.length === 0) throw new Error("Invalid TIFF");
    
    const ifd = ifds[0];
    UTIF.decodeImage(buffer, ifd);
    const rgba = UTIF.toRGBA8(ifd);

    const canvas = document.createElement('canvas');
    canvas.width = ifd.width;
    canvas.height = ifd.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Canvas failure");

    const imageData = ctx.createImageData(ifd.width, ifd.height);
    imageData.data.set(rgba);
    ctx.putImageData(imageData, 0, 0);

    // Create a small-ish preview for efficiency
    const previewCanvas = document.createElement('canvas');
    const scale = Math.min(1, 512 / Math.max(ifd.width, ifd.height));
    previewCanvas.width = ifd.width * scale;
    previewCanvas.height = ifd.height * scale;
    const pCtx = previewCanvas.getContext('2d');
    if (pCtx) {
      pCtx.drawImage(canvas, 0, 0, previewCanvas.width, previewCanvas.height);
      return previewCanvas.toDataURL('image/png');
    }
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.error("TIF Preview failed:", e);
    throw e;
  }
};

export const packTextures = async (
  mode: AppMode,
  channels: ChannelState[],
  options?: PackOptions
): Promise<PackResult> => {
  // Handle Map Inversion (e.g. Glossiness <-> Roughness, DirectX <-> OpenGL Normal)
  if (mode === AppMode.InvertMap) {
    const slot = channels.find(c => c.id === 'invert_src') || channels.find(c => c.file !== null);
    if (!slot?.file) throw new Error("Please select a texture map to invert");

    const invertChannels = options?.invertChannels || { r: true, g: true, b: true, a: false };
    
    let width = 1024;
    let height = 1024;
    let rgba: Uint8ClampedArray;

    const isTiff = slot.file.name.toLowerCase().endsWith('.tif') || slot.file.name.toLowerCase().endsWith('.tiff');
    if (isTiff) {
      const buffer = await slot.file.arrayBuffer();
      const ifds = UTIF.decode(buffer);
      if (!ifds || ifds.length === 0) throw new Error("Invalid TIFF file");
      const ifd = ifds[0];
      UTIF.decodeImage(buffer, ifd);
      rgba = new Uint8ClampedArray(UTIF.toRGBA8(ifd));
      width = ifd.width;
      height = ifd.height;
    } else {
      const img = await loadImage(slot.file);
      width = img.naturalWidth;
      height = img.naturalHeight;
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = width;
      tempCanvas.height = height;
      const tCtx = tempCanvas.getContext('2d');
      if (!tCtx) throw new Error("Canvas context failed");
      tCtx.drawImage(img, 0, 0);
      URL.revokeObjectURL(img.src);
      rgba = tCtx.getImageData(0, 0, width, height).data;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Canvas context failed");

    const outputData = ctx.createImageData(width, height);
    for (let i = 0; i < rgba.length; i += 4) {
      outputData.data[i] = invertChannels.r ? (255 - rgba[i]) : rgba[i];
      outputData.data[i + 1] = invertChannels.g ? (255 - rgba[i + 1]) : rgba[i + 1];
      outputData.data[i + 2] = invertChannels.b ? (255 - rgba[i + 2]) : rgba[i + 2];
      outputData.data[i + 3] = invertChannels.a ? (255 - rgba[i + 3]) : rgba[i + 3];
    }

    ctx.putImageData(outputData, 0, 0);

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve({
          url: URL.createObjectURL(blob!),
          width,
          height,
        });
      }, 'image/png');
    });
  }

  // Handle TIF 16-bit to 8-bit PNG specifically
  if (mode === AppMode.Convert16to8) {
    const slot = channels.find(c => c.id === 'tif');
    if (!slot?.file) throw new Error("Please select a TIF file");

    const buffer = await slot.file.arrayBuffer();
    const ifds = UTIF.decode(buffer);
    if (!ifds || ifds.length === 0) throw new Error("Invalid TIFF file");
    
    const ifd = ifds[0];
    UTIF.decodeImage(buffer, ifd);
    const rgba = UTIF.toRGBA8(ifd); // Automatically converts 16-bit to 8-bit RGBA

    const width = ifd.width;
    const height = ifd.height;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Canvas failed");

    const imageData = ctx.createImageData(width, height);
    imageData.data.set(rgba);
    ctx.putImageData(imageData, 0, 0);

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve({
          url: URL.createObjectURL(blob!),
          width,
          height
        });
      }, 'image/png');
    });
  }

  // Atlas / Tiling Logic
  if (mode === AppMode.Atlas) {
    const activeSlots = channels.filter(c => c.file !== null);
    if (activeSlots.length === 0) throw new Error("Please select at least one texture");

    const cols = options?.atlasCols || 4;
    const rows = options?.atlasRows || 4;

    // Determine cell size from the first available texture
    let cellWidth = 512;
    let cellHeight = 512;
    
    const firstActive = activeSlots[0];
    const isTiff = firstActive.file?.name.toLowerCase().endsWith('.tif') || firstActive.file?.name.toLowerCase().endsWith('.tiff');
    if (isTiff) {
      const buffer = await firstActive.file!.arrayBuffer();
      const ifds = UTIF.decode(buffer);
      if (ifds && ifds.length > 0) {
        cellWidth = ifds[0].width;
        cellHeight = ifds[0].height;
      }
    } else {
      const img = await loadImage(firstActive.file!);
      cellWidth = img.naturalWidth;
      cellHeight = img.naturalHeight;
      URL.revokeObjectURL(img.src);
    }

    const totalWidth = cellWidth * cols;
    const totalHeight = cellHeight * rows;

    const canvas = document.createElement('canvas');
    canvas.width = totalWidth;
    canvas.height = totalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Canvas failed");

    // Fill background
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, totalWidth, totalHeight);

    for (const ch of channels) {
      if (!ch.file) continue;
      
      const index = parseInt(ch.id.replace('atlas_', ''));
      const row = Math.floor(index / cols);
      const col = index % cols;
      
      const x = col * cellWidth;
      const y = row * cellHeight;

      const isTiff = ch.file.name.toLowerCase().endsWith('.tif') || ch.file.name.toLowerCase().endsWith('.tiff');
      if (isTiff) {
        const buffer = await ch.file.arrayBuffer();
        const ifds = UTIF.decode(buffer);
        UTIF.decodeImage(buffer, ifds[0]);
        const rgba8 = UTIF.toRGBA8(ifds[0]);
        
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = ifds[0].width;
        tempCanvas.height = ifds[0].height;
        const tCtx = tempCanvas.getContext('2d');
        const tData = tCtx!.createImageData(tempCanvas.width, tempCanvas.height);
        tData.data.set(rgba8);
        tCtx!.putImageData(tData, 0, 0);
        
        ctx.drawImage(tempCanvas, x, y, cellWidth, cellHeight);
      } else {
        const img = await loadImage(ch.file);
        ctx.drawImage(img, x, y, cellWidth, cellHeight);
        URL.revokeObjectURL(img.src);
      }
    }

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve({
          url: URL.createObjectURL(blob!),
          width: totalWidth,
          height: totalHeight
        });
      }, 'image/png');
    });
  }

  // Standard Packing Logic
  const activeChannels = channels.filter(c => c.file !== null);
  let width = 1024;
  let height = 1024;

  // 1. Determine Dimensions
  if (activeChannels.length > 0) {
    const loadedSizes = await Promise.all(
      activeChannels.map(async (c) => {
        const isTiff = c.file?.name.toLowerCase().endsWith('.tif') || c.file?.name.toLowerCase().endsWith('.tiff');
        if (isTiff) {
          const buffer = await c.file!.arrayBuffer();
          const ifds = UTIF.decode(buffer);
          if (ifds && ifds.length > 0) return { w: ifds[0].width, h: ifds[0].height };
          return { w: 1024, h: 1024 };
        }
        try {
          const img = await loadImage(c.file!);
          const w = img.naturalWidth;
          const h = img.naturalHeight;
          URL.revokeObjectURL(img.src);
          return { w, h };
        } catch (e) {
          return { w: 1024, h: 1024 };
        }
      })
    );

    if (mode === AppMode.CombineAlpha) {
      const baseChannel = channels.find(c => c.id === 'base');
      const baseIdx = channels.findIndex(c => c.id === 'base');
      if (baseChannel && baseChannel.file) {
        width = loadedSizes[baseIdx].w;
        height = loadedSizes[baseIdx].h;
      } else {
        width = Math.min(...loadedSizes.map(s => s.w));
        height = Math.min(...loadedSizes.map(s => s.h));
      }
    } else {
      width = Math.min(...loadedSizes.map(s => s.w));
      height = Math.min(...loadedSizes.map(s => s.h));
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas context failed");

  // Helper to get image data for both regular images and TIFs
  const getPixels = async (file: File): Promise<Uint8ClampedArray> => {
    const isTiff = file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff');
    if (isTiff) {
      const buffer = await file.arrayBuffer();
      const ifds = UTIF.decode(buffer);
      UTIF.decodeImage(buffer, ifds[0]);
      const rgba8 = UTIF.toRGBA8(ifds[0]);
      
      // If dimensions match, return directly
      if (ifds[0].width === width && ifds[0].height === height) return rgba8;
      
      // Resize TIF if needed using a temporary canvas
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = ifds[0].width;
      tempCanvas.height = ifds[0].height;
      const tCtx = tempCanvas.getContext('2d');
      const tData = tCtx!.createImageData(tempCanvas.width, tempCanvas.height);
      tData.data.set(rgba8);
      tCtx!.putImageData(tData, 0, 0);
      
      const resizeCanvas = document.createElement('canvas');
      resizeCanvas.width = width;
      resizeCanvas.height = height;
      const rCtx = resizeCanvas.getContext('2d');
      rCtx!.drawImage(tempCanvas, 0, 0, width, height);
      return rCtx!.getImageData(0, 0, width, height).data;
    } else {
      const img = await loadImage(file);
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = width;
      tempCanvas.height = height;
      const tCtx = tempCanvas.getContext('2d');
      tCtx!.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(img.src);
      return tCtx!.getImageData(0, 0, width, height).data;
    }
  };

  const outputData = ctx.createImageData(width, height);

  if (mode === AppMode.CombineAlpha) {
    const baseSlot = channels.find(c => c.id === 'base');
    const alphaSlot = channels.find(c => c.id === 'alpha');

    let basePixels: Uint8ClampedArray | null = null;
    let alphaPixels: Uint8ClampedArray | null = null;

    if (baseSlot?.file) basePixels = await getPixels(baseSlot.file);
    if (alphaSlot?.file) alphaPixels = await getPixels(alphaSlot.file);

    for (let i = 0; i < outputData.data.length; i += 4) {
      if (basePixels) {
        outputData.data[i] = basePixels[i];
        outputData.data[i + 1] = basePixels[i + 1];
        outputData.data[i + 2] = basePixels[i + 2];
      } else {
        const val = baseSlot?.fallback === 'white' ? 255 : 0;
        outputData.data[i] = val; outputData.data[i + 1] = val; outputData.data[i + 2] = val;
      }
      if (alphaPixels) {
        outputData.data[i + 3] = alphaPixels[i];
      } else {
        outputData.data[i + 3] = alphaSlot?.fallback === 'white' ? 255 : 0;
      }
    }
  } else {
    const channelMap: Record<string, Uint8ClampedArray | null> = {};
    for (const ch of channels) {
      if (ch.file) channelMap[ch.id] = await getPixels(ch.file);
    }
    for (let i = 0; i < outputData.data.length; i += 4) {
      outputData.data[i] = channelMap['R'] ? channelMap['R'][i] : (channels.find(c => c.id === 'R')?.fallback === 'white' ? 255 : 0);
      outputData.data[i + 1] = channelMap['G'] ? channelMap['G'][i] : (channels.find(c => c.id === 'G')?.fallback === 'white' ? 255 : 0);
      outputData.data[i + 2] = channelMap['B'] ? channelMap['B'][i] : (channels.find(c => c.id === 'B')?.fallback === 'white' ? 255 : 0);
      outputData.data[i + 3] = channelMap['A'] ? channelMap['A'][i] : (channels.find(c => c.id === 'A')?.fallback === 'white' ? 255 : 0);
    }
  }

  ctx.putImageData(outputData, 0, 0);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve({ url: URL.createObjectURL(blob!), width, height });
    }, 'image/png');
  });
};
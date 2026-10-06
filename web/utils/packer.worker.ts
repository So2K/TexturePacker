import { generatePreview, packTextures } from './packer';
import { AppMode, ChannelState, PackOptions } from '../types';

self.onmessage = async (event: MessageEvent<{ mode: AppMode; channels: ChannelState[]; options: PackOptions; kind?: 'preview'; file?: File }>) => {
  try {
    const result = event.data.kind === 'preview' ? { url: await generatePreview(event.data.file!), width: 0, height: 0 } : await packTextures(event.data.mode, event.data.channels, event.data.options);
    const blob = await (await fetch(result.url)).blob();
    URL.revokeObjectURL(result.url);
    self.postMessage({ blob, width: result.width, height: result.height });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Processing failed.' });
  }
};

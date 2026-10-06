import { AppMode, ChannelState, PackOptions, PackResult } from '../types';
import { generatePreview, packTextures } from './packer';

export function processInWorker(mode: AppMode, channels: ChannelState[], options: PackOptions, signal?: AbortSignal): Promise<PackResult> {
  if (signal?.aborted) return Promise.reject(new DOMException('Processing cancelled.', 'AbortError'));
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return packTextures(mode, channels, options);
  return runWorker({ mode, channels: channels.map(slot => ({ ...slot, previewUrl: null })), options }, signal);
}

function runWorker(payload: unknown, signal?: AbortSignal): Promise<PackResult> {
  if (signal?.aborted) return Promise.reject(new DOMException('Processing cancelled.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./packer.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener('abort', cancel);
      worker.onmessage = null;
      worker.onerror = null;
    };
    const cancel = () => { cleanup(); reject(new DOMException('Processing cancelled.', 'AbortError')); };
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event: MessageEvent<{ blob: Blob; width: number; height: number; error?: string }>) => {
      cleanup();
      if (event.data.error) { reject(new Error(event.data.error)); return; }
      resolve({ url: URL.createObjectURL(event.data.blob), width: event.data.width, height: event.data.height });
    };
    worker.onerror = () => { cleanup(); reject(new Error('The texture processing worker could not start. Refresh the page and try again.')); };
    try { worker.postMessage(payload); } catch (error) { cleanup(); reject(error); }
  });
}

// Limit preview workers so a multi-file drop cannot start hundreds of decoders at once.
interface PreviewJob { file: File; signal?: AbortSignal; queuedAbort: () => void; resolve: (url: string) => void; reject: (error: unknown) => void }
const previewQueue: PreviewJob[] = [];
let previewWorkers = 0;
function drainPreviews() {
  while (previewWorkers < 2 && previewQueue.length) {
    const job = previewQueue.shift()!;
    job.signal?.removeEventListener('abort', job.queuedAbort);
    if (job.signal?.aborted) { job.reject(new DOMException('Import cancelled.', 'AbortError')); continue; }
    previewWorkers++;
    void runWorker({ kind: 'preview', file: job.file }, job.signal).then(result => job.resolve(result.url), job.reject).finally(() => { previewWorkers--; drainPreviews(); });
  }
}
export function previewInWorker(file: File, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return Promise.reject(new DOMException('Import cancelled.', 'AbortError'));
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    if (!signal) return generatePreview(file);
    return new Promise((resolve, reject) => {
      const cancel = () => reject(new DOMException('Import cancelled.', 'AbortError'));
      signal.addEventListener('abort', cancel, { once: true });
      void generatePreview(file).then(url => {
        signal.removeEventListener('abort', cancel);
        if (signal.aborted) URL.revokeObjectURL(url);
        else resolve(url);
      }, error => { signal.removeEventListener('abort', cancel); reject(error); });
    });
  }
  return new Promise((resolve, reject) => {
    const job: PreviewJob = { file, signal, resolve, reject, queuedAbort: () => {
      const index = previewQueue.indexOf(job);
      if (index >= 0) previewQueue.splice(index, 1);
      signal?.removeEventListener('abort', job.queuedAbort);
      reject(new DOMException('Import cancelled.', 'AbortError'));
    } };
    signal?.addEventListener('abort', job.queuedAbort, { once: true });
    previewQueue.push(job);
    drainPreviews();
  });
}

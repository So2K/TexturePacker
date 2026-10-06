import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChannelInput from './components/ChannelInput';
import { AppMode, ChannelState, FallbackColor, PackResult, PackOptions } from './types';
import { IMAGE_ACCEPT } from './utils/packer';
import { previewInWorker, processInWorker } from './utils/process-worker';
import './index.css';

const modes = [
  { id: AppMode.ChannelPacking, icon: '▦', title: 'RGBA channels', description: 'Combine grayscale maps into one RGBA texture.', note: 'The red component of each source fills its output channel. Sources resize to the smallest width and height.' },
  { id: AppMode.CombineAlpha, icon: '◩', title: 'Add alpha', description: 'Combine a color texture with an alpha mask.', note: 'The base texture sets the output size. The mask’s red component becomes alpha; its size adjusts to the base.' },
  { id: AppMode.Convert16to8, icon: '⇩', title: 'TIFF 16 → 8', description: 'Convert a high bit depth TIFF to an 8-bit PNG.', note: 'Converts integer 16-bit samples to 8-bit values. The original image dimensions are preserved.' },
  { id: AppMode.Atlas, icon: '▤', title: 'Texture atlas', description: 'Arrange textures in a regular grid.', note: 'The first loaded slot sets the cell size. Empty cells stay opaque black. Slots are ordered from left to right.' },
  { id: AppMode.InvertMap, icon: '◐', title: 'Invert channels', description: 'Convert roughness, gloss and normal maps.', note: 'Each selected channel becomes 255 − value. All other channels and the image dimensions are preserved.' },
] as const;
const slot = (id: string, label: string, fallback: FallbackColor = 'black', colorClass = ''): ChannelState => ({ id, label, fallback, colorClass, file: null, previewUrl: null });
const atlas = (cols: number, rows: number) => Array.from({ length: cols * rows }, (_, index) => slot(`atlas_${index}`, `Slot ${index + 1}`));
const initial = (): Record<AppMode, ChannelState[]> => ({
  [AppMode.ChannelPacking]: [slot('R', 'Red channel', 'white', 'red'), slot('G', 'Green channel', 'white', 'green'), slot('B', 'Blue channel', 'black', 'blue'), slot('A', 'Alpha channel', 'white')],
  [AppMode.CombineAlpha]: [slot('base', 'Base texture · RGB'), slot('alpha', 'Alpha mask', 'white')],
  [AppMode.Convert16to8]: [slot('tif', 'Source TIFF')],
  [AppMode.Atlas]: atlas(4, 4),
  [AppMode.InvertMap]: [slot('invert_src', 'Source texture')],
});
const presets: { title: string; options: NonNullable<PackOptions['invertChannels']> }[] = [
  { title: 'Gloss ⇄ rough', options: { r: true, g: true, b: true, a: false } },
  { title: 'Flip normal Y', options: { r: false, g: true, b: false, a: false } },
  { title: 'Invert alpha', options: { r: false, g: false, b: false, a: true } },
  { title: 'Invert all', options: { r: true, g: true, b: true, a: true } },
];

export default function App() {
  const [mode, setMode] = useState(AppMode.ChannelPacking);
  const [states, setStates] = useState(initial);
  const [grid, setGrid] = useState({ cols: 4, rows: 4 });
  const [gridInputs, setGridInputs] = useState({ cols: '4', rows: '4' });
  const [invert, setInvert] = useState(presets[0].options);
  const [result, setResult] = useState<PackResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState('fit');
  const urls = useRef(new Set<string>());
  const revision = useRef(0);
  const requests = useRef(new Map<string, number>());
  const previewControllers = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);
  const dragDepth = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const active = states[mode];
  const info = modes.find(item => item.id === mode)!;
  const loaded = active.filter(item => item.file).length;
  const release = useCallback((url: string | null) => {
    if (url && urls.current.delete(url)) URL.revokeObjectURL(url);
  }, []);
  const invalidate = useCallback(() => {
    revision.current++;
    setError('');
    setResult(previous => { release(previous?.url ?? null); return null; });
  }, [release]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      for (const abort of previewControllers.current.values()) abort.abort();
      previewControllers.current.clear();
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
    };
  }, []);

  const updateFile = useCallback(async (id: string, file: File | null) => {
    const targetMode = mode;
    const key = `${targetMode}/${id}`;
    const token = (requests.current.get(key) ?? 0) + 1;
    requests.current.set(key, token);
    previewControllers.current.get(key)?.abort();
    previewControllers.current.delete(key);
    invalidate();
    if (!file) {
      setStates(previous => ({ ...previous, [targetMode]: previous[targetMode].map(item => {
        if (item.id !== id) return item;
        release(item.previewUrl);
        return { ...item, file: null, previewUrl: null };
      }) }));
      return;
    }
    if (targetMode === AppMode.Convert16to8 && !/\.tiff?$/i.test(file.name)) { setError('Choose a .tif or .tiff file for TIFF conversion.'); return; }
    const abort = new AbortController();
    previewControllers.current.set(key, abort);
    setPending(value => value + 1);
    try {
      const url = await previewInWorker(file, abort.signal);
      if (!mounted.current || requests.current.get(key) !== token) { URL.revokeObjectURL(url); return; }
      urls.current.add(url);
      setStates(previous => {
        if (!previous[targetMode].some(item => item.id === id)) { release(url); return previous; }
        return { ...previous, [targetMode]: previous[targetMode].map(item => {
          if (item.id !== id) return item;
          release(item.previewUrl);
          return { ...item, file, previewUrl: url };
        }) };
      });
    } catch (error) {
      if (mounted.current && requests.current.get(key) === token && !abort.signal.aborted) setError(error instanceof Error ? error.message : 'The image could not be loaded.');
    } finally {
      if (previewControllers.current.get(key) === abort) previewControllers.current.delete(key);
      if (mounted.current) setPending(value => value - 1);
    }
  }, [mode, invalidate, release]);

  const updateFallback = (id: string, fallback: FallbackColor) => {
    invalidate();
    setStates(previous => ({ ...previous, [mode]: previous[mode].map(item => item.id === id ? { ...item, fallback } : item) }));
  };
  const cancelLoads = (targetMode: AppMode) => {
    for (const [key, token] of requests.current) if (key.startsWith(`${targetMode}/`)) requests.current.set(key, token + 1);
    for (const [key, abort] of previewControllers.current) if (key.startsWith(`${targetMode}/`)) {
      abort.abort();
      previewControllers.current.delete(key);
    }
  };
  const changeGrid = (cols: number, rows: number) => {
    cols = Math.max(1, Math.min(20, Math.trunc(cols) || 1));
    rows = Math.max(1, Math.min(20, Math.trunc(rows) || 1));
    setGridInputs({ cols: String(cols), rows: String(rows) });
    if (cols === grid.cols && rows === grid.rows) return;
    cancelLoads(AppMode.Atlas);
    invalidate();
    setStates(previous => {
      const next = atlas(cols, rows);
      previous[AppMode.Atlas].forEach((item, index) => {
        const x = index % grid.cols, y = Math.floor(index / grid.cols);
        if (x < cols && y < rows) next[y * cols + x] = { ...next[y * cols + x], file: item.file, previewUrl: item.previewUrl };
        else release(item.previewUrl);
      });
      return { ...previous, [AppMode.Atlas]: next };
    });
    setGrid({ cols, rows });
  };
  const clear = () => {
    invalidate();
    cancelLoads(mode);
    setStates(previous => ({ ...previous, [mode]: previous[mode].map(item => { release(item.previewUrl); return { ...item, file: null, previewUrl: null }; }) }));
  };
  const changeInvert = (options: typeof invert) => { invalidate(); setInvert(options); };
  const process = async () => {
    if (processing || pending) return;
    invalidate();
    const version = revision.current;
    const abort = new AbortController();
    controller.current = abort;
    setProcessing(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 20));
      const output = await processInWorker(mode, active, { atlasCols: grid.cols, atlasRows: grid.rows, invertChannels: invert }, abort.signal);
      if (!mounted.current || revision.current !== version) { URL.revokeObjectURL(output.url); return; }
      urls.current.add(output.url);
      setResult(output);
    } catch (error) {
      if (mounted.current && revision.current === version && !(error instanceof DOMException && error.name === 'AbortError')) setError(error instanceof Error ? error.message : 'Processing failed.');
    } finally { if (controller.current === abort) { controller.current = null; if (mounted.current) setProcessing(false); } }
  };
  const download = () => {
    if (!result) return;
    const names: Record<AppMode, string> = { [AppMode.ChannelPacking]: 'packed_rgba', [AppMode.CombineAlpha]: 'texture_alpha', [AppMode.Convert16to8]: 'tiff_8bit', [AppMode.Atlas]: 'texture_atlas', [AppMode.InvertMap]: 'inverted_texture' };
    const link = document.createElement('a');
    link.href = result.url;
    link.download = `${names[mode]}_${result.width}x${result.height}.png`;
    link.click();
  };
  const sourcePreview = useMemo(() => active.find(item => item.previewUrl)?.previewUrl, [active]);
  const busy = processing || pending > 0;
  const canProcess = !busy && (loaded > 0 || mode === AppMode.ChannelPacking || mode === AppMode.CombineAlpha);
  const cancelProcess = () => { controller.current?.abort(); controller.current = null; invalidate(); setProcessing(false); };
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 's') { event.preventDefault(); if (result && !busy) download(); }
      if (key === 'enter') { event.preventDefault(); if (canProcess) void process(); }
      if (key === 'o') {
        event.preventDefault();
        if (!processing) {
          const target = active.find(item => !item.file) ?? active[0];
          document.querySelector<HTMLInputElement>(`[data-slot="${target.id}"] input[type="file"]`)?.click();
        }
      }
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  });

  return <div className="app"
    onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
    onDropCapture={() => { dragDepth.current = 0; setDragging(false); }}
    onDrop={event => { event.preventDefault(); if (processing) return; const empty = active.filter(item => !item.file); Array.from(event.dataTransfer.files).slice(0, empty.length).forEach((file, index) => void updateFile(empty[index].id, file)); }}>
    <header className="app-header"><div className="brand-mark" aria-hidden="true">▦</div><strong>Texture Packer</strong><span className="edition">Web</span><div className="header-links"><a href="https://github.com/So2K/TexturePacker/releases/latest/download/TexturePacker-win-x64.zip" target="_blank" rel="noreferrer">↓ Download for Windows</a><a className="github-link" href="https://github.com/So2K/TexturePacker" target="_blank" rel="noreferrer">GitHub ↗</a></div></header>
    <div className="workspace">
      <aside className="navigation"><div className="nav-caption">TEXTURE TOOLS</div><nav aria-label="Texture tools">{modes.map(item => <button key={item.id} className={mode === item.id ? 'selected' : ''} aria-current={mode === item.id ? 'page' : undefined} disabled={processing} onClick={() => { invalidate(); setMode(item.id); }}><span aria-hidden="true">{item.icon}</span>{item.title}</button>)}</nav><div className="nav-footer"><span className="privacy-dot" />Processed on your device<p>Free and open source · MIT</p></div></aside>
      <main className="source-panel"><div className="section-heading"><div><h1>{info.title}</h1><p>{info.description}</p></div></div>
        {mode === AppMode.Atlas && <section className="settings-card"><h2>Atlas layout</h2><div className="grid-settings">{(['cols', 'rows'] as const).map(key => <label key={key}>{key === 'cols' ? 'Columns' : 'Rows'}<input type="number" min="1" max="20" value={gridInputs[key]} disabled={processing} onChange={event => setGridInputs(previous => ({ ...previous, [key]: event.target.value }))} onBlur={() => changeGrid(Number(gridInputs.cols), Number(gridInputs.rows))} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); changeGrid(Number(gridInputs.cols), Number(gridInputs.rows)); } }} /></label>)}</div><div className="preset-row">{[[2,2],[3,3],[4,4],[2,3]].map(([cols, rows]) => <button key={`${cols}x${rows}`} aria-pressed={grid.cols === cols && grid.rows === rows} disabled={processing} onClick={() => changeGrid(cols, rows)}>{cols} × {rows}</button>)}</div></section>}
        {mode === AppMode.InvertMap && <section className="settings-card"><h2>Conversion presets</h2><div className="preset-grid">{presets.map(preset => <button key={preset.title} aria-pressed={Object.entries(preset.options).every(([key,value]) => invert[key as keyof typeof invert] === value)} disabled={processing} onClick={() => changeInvert(preset.options)}>{preset.title}</button>)}</div><h2 className="channel-heading">Channels to invert</h2><div className="invert-channels">{(['r','g','b','a'] as const).map((key, index) => <label key={key}><input type="checkbox" checked={invert[key]} disabled={processing} onChange={event => changeInvert({ ...invert, [key]: event.target.checked })} />{['Red','Green','Blue','Alpha'][index]}</label>)}</div></section>}
        {mode === AppMode.Atlas ? <section className="settings-card"><div className="section-row"><h2>Texture slots</h2><span>{loaded} / {active.length} filled</span></div><p className="settings-note">Click a cell to choose a texture, or drop multiple files to fill cells in order.</p><div className="atlas-scroll"><div className="atlas-grid" style={{ minWidth: grid.cols * 48, gridTemplateColumns: `repeat(${grid.cols}, minmax(0,1fr))` }}>{active.map((item, index) => <div className="atlas-cell" data-slot={item.id} key={item.id} onDragOver={event => { event.preventDefault(); event.stopPropagation(); }} onDrop={event => { event.preventDefault(); event.stopPropagation(); if (!processing) Array.from(event.dataTransfer.files).slice(0, active.length-index).forEach((file, offset) => void updateFile(active[index + offset].id, file)); }}><label className={processing ? 'disabled' : ''} title={item.file?.name ?? `Choose slot ${index + 1}`}><input type="file" accept={IMAGE_ACCEPT} disabled={processing} aria-label={`Slot ${index + 1} file`} onChange={event => { if (event.target.files?.[0]) void updateFile(item.id,event.target.files[0]); event.target.value = ''; }} />{item.previewUrl ? <img src={item.previewUrl} alt={`Slot ${index + 1}`} /> : <span>{index + 1}<small>＋</small></span>}</label>{item.file && <button className="cell-remove" disabled={processing} aria-label={`Remove slot ${index + 1}`} onClick={() => void updateFile(item.id,null)}>×</button>}</div>)}</div></div></section> : <div className="source-list">{active.map(item => <ChannelInput key={item.id} channel={item} onFileChange={updateFile} onFallbackChange={updateFallback} allowFallback={mode === AppMode.ChannelPacking || mode === AppMode.CombineAlpha} tiffOnly={mode === AppMode.Convert16to8} disabled={processing} />)}</div>}
        <div className="mode-note"><span aria-hidden="true">ⓘ</span><p>{info.note}</p></div><button className="clear-button" disabled={processing || (!loaded && !pending)} onClick={clear}>Clear sources</button>
      </main>
      <section className="preview-panel" aria-label="Output preview"><div className="preview-toolbar"><h2>{result ? 'Output preview' : 'Preview'}</h2><select aria-label="Preview zoom" value={zoom} onChange={event => setZoom(event.target.value)}><option value="fit">Fit</option><option value="1">100%</option><option value="2">200%</option><option value="4">400%</option></select><span>{result ? `${result.width} × ${result.height} px` : 'PNG · 8-bit RGBA'}</span></div><div className={`preview-viewport ${zoom !== 'fit' && result ? 'zoomed' : ''}`}>{result ? <img className={`output-image ${zoom !== 'fit' ? 'zoomed' : ''}`} style={zoom !== 'fit' ? { width: result.width * Number(zoom), height: result.height * Number(zoom) } : undefined} src={result.url} alt="Processed texture" /> : sourcePreview && mode !== AppMode.Atlas ? <div className="source-preview"><img src={sourcePreview} alt="Source texture preview" /><span>Source · process to preview output</span></div> : <div className="empty-preview"><div className="empty-icon" aria-hidden="true">▦</div><h3>Your texture, ready to go</h3><p>Add sources and process to see the result.</p><span>PNG · JPEG · TIFF · BMP · TGA · WebP</span></div>}{processing && <div className="processing-overlay" role="status"><span className="spinner" />Processing textures…</div>}</div>
        <div className="output-actions">{error && <div className="error-message" role="alert">{error}</div>}<div className="action-status" aria-live="polite">{processing ? 'Processing textures…' : pending ? 'Loading sources…' : result ? 'Ready to export' : `${loaded} source${loaded === 1 ? '' : 's'} loaded`}</div><div className="action-buttons">{processing && <button className="secondary-button" onClick={cancelProcess}>Cancel</button>}<button className="primary-button" disabled={!canProcess} onClick={() => void process()}>{processing ? 'Processing…' : 'Process textures'}</button><button className="secondary-button" disabled={!result || busy} onClick={download}>↓ Export PNG</button></div><p className="output-note">Your textures stay on your device.</p></div>
      </section>
    </div>
    {dragging && <div className="drop-overlay"><div>Drop textures to fill empty slots</div></div>}
  </div>;
}

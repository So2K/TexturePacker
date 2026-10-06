import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChannelInput from './components/ChannelInput';
import { AppMode, ChannelState, FallbackColor, PackResult, PackOptions } from './types';
import { IMAGE_ACCEPT } from './utils/packer';
import { previewInWorker, processInWorker } from './utils/process-worker';
import './index.css';

const modes = [
  { id: AppMode.ChannelPacking, icon: '▦', title: 'Channels', description: 'Combine grayscale maps into one RGBA texture.', note: 'The red component of each source fills its output channel. Sources resize to the smallest width and height.' },
  { id: AppMode.CombineAlpha, icon: '◩', title: '+ Alpha', description: 'Combine a color texture with an alpha mask.', note: 'The base texture sets the output size. The mask’s red component becomes alpha; its size adjusts to the base.' },
  { id: AppMode.Convert16to8, icon: '⇩', title: 'TIF 16→8', description: 'Convert a high bit depth TIFF to an 8-bit PNG.', note: 'Converts integer 16-bit samples to 8-bit values. The original image dimensions are preserved.' },
  { id: AppMode.Atlas, icon: '▤', title: 'Atlas', description: 'Arrange textures in a regular grid.', note: 'The first loaded slot sets the cell size. Empty cells stay opaque black. Slots are ordered from left to right.' },
  { id: AppMode.InvertMap, icon: '◐', title: 'Gloss ⇄ Rough', description: 'Convert roughness, gloss and normal maps.', note: 'Each selected channel becomes 255 − value. All other channels and the image dimensions are preserved.' },
] as const;
const slot = (id: string, label: string, fallback: FallbackColor = 'black', colorClass = ''): ChannelState => ({ id, label, fallback, colorClass, file: null, previewUrl: null });
const atlas = (cols: number, rows: number) => Array.from({ length: cols * rows }, (_, index) => slot(`atlas_${index}`, `Slot ${index + 1}`));
const initial = (): Record<AppMode, ChannelState[]> => ({
  [AppMode.ChannelPacking]: [slot('R', 'Red Channel', 'white', 'red'), slot('G', 'Green Channel', 'white', 'green'), slot('B', 'Blue Channel', 'black', 'blue'), slot('A', 'Alpha Channel', 'white')],
  [AppMode.CombineAlpha]: [slot('base', 'Base Texture (RGB)'), slot('alpha', 'Alpha Mask (Grayscale)', 'white')],
  [AppMode.Convert16to8]: [slot('tif', 'Source 16-bit TIF')],
  [AppMode.Atlas]: atlas(4, 4),
  [AppMode.InvertMap]: [slot('invert_src', 'Source Texture Map (Gloss / Rough / Normal)')],
});
const presets: { title: string; options: NonNullable<PackOptions['invertChannels']> }[] = [
  { title: 'Gloss ⇄ Rough', options: { r: true, g: true, b: true, a: false } },
  { title: 'Flip Normal Y', options: { r: false, g: true, b: false, a: false } },
  { title: 'Invert Alpha', options: { r: false, g: false, b: false, a: true } },
  { title: 'Invert All', options: { r: true, g: true, b: true, a: true } },
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
      if (result && ['+', '=', '-', '0'].includes(key)) {
        event.preventDefault();
        if (key === '0') setZoom('fit');
        else if (key === '-') setZoom(previous => previous === '4' ? '2' : previous === '2' ? '1' : 'fit');
        else setZoom(previous => previous === 'fit' ? '1' : previous === '1' ? '2' : '4');
      }
      if (key === 's') { event.preventDefault(); if (result && !busy) download(); }
      if (key === 'enter') { event.preventDefault(); if (canProcess) void process(); }
      if (key === 'o') {
        event.preventDefault();
        if (!processing) {
          const target = active.find(item => !item.file) ?? active[0];
          (document.querySelector<HTMLInputElement>(`[data-slot="${target.id}"] input[type="file"]`) ?? document.querySelector<HTMLInputElement>('[aria-label="Atlas texture file"]'))?.click();
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
    <header className="app-header"><div className="brand"><div className="brand-mark">TX</div><h1>Texture Packer <span>Pro</span></h1></div><span className="header-caption">High Bit-Depth Utility</span></header>
    <div className="workspace">
      <aside className="source-panel">
        <nav className="mode-tabs" aria-label="Texture tools">{modes.map(item => <button key={item.id} aria-pressed={mode === item.id} disabled={processing} onClick={() => { invalidate(); setMode(item.id); }}>{item.title}</button>)}</nav>
        <div className="input-content">
          {mode === AppMode.Atlas ? <div className="atlas-settings">
            <section><h2>Grid Size</h2><div className="grid-settings">{(['cols','rows'] as const).map(key => <label key={key}>{key === 'cols' ? 'Columns' : 'Rows'}<input type="number" min="1" max="20" value={gridInputs[key]} disabled={processing} onChange={event => setGridInputs(previous => ({ ...previous, [key]: event.target.value }))} onBlur={() => changeGrid(Number(gridInputs.cols),Number(gridInputs.rows))} onKeyDown={event => { if(event.key === 'Enter') { event.preventDefault(); changeGrid(Number(gridInputs.cols),Number(gridInputs.rows)); } }} /></label>)}</div><div className="grid-presets">{[[2,2],[3,3],[4,4],[2,3]].map(([cols,rows]) => <button key={`${cols}x${rows}`} aria-pressed={grid.cols === cols && grid.rows === rows} disabled={processing} onClick={() => changeGrid(cols,rows)}>{cols}x{rows}</button>)}</div></section>
            <div className="information-pane"><p>Drag and drop textures directly onto the grid cells in the viewport to the right.</p></div>
            <button className="clear-slots" disabled={processing} onClick={clear}>Clear All Slots</button>
            <input className="visually-hidden" type="file" accept={IMAGE_ACCEPT} aria-label="Atlas texture file" disabled={processing} onChange={event => { const target=active.find(item=>!item.file)??active[0]; if(event.target.files?.[0]) void updateFile(target.id,event.target.files[0]); event.target.value=''; }} />
          </div> : <>
            {mode === AppMode.InvertMap && <div className="inversion-settings">
              <section><h2>Presets</h2><div className="invert-presets">{presets.map((preset,index) => <button key={preset.title} aria-pressed={Object.entries(preset.options).every(([key,value]) => invert[key as keyof typeof invert] === value)} disabled={processing} onClick={() => changeInvert(preset.options)}><strong>{preset.title}</strong><span>{['RGB Invert (1 - x)','DirectX ⇄ OpenGL (G)','Alpha Mask (1 - A)','Full RGBA Inversion'][index]}</span></button>)}</div></section>
              <section><div className="channel-heading"><h2>Channels to Invert</h2><span>255 - X</span></div><div className="invert-channels">{(['r','g','b','a'] as const).map((key,index) => <label key={key} className={invert[key]?'checked':''}><input type="checkbox" checked={invert[key]} disabled={processing} onChange={event=>changeInvert({...invert,[key]:event.target.checked})}/><i className={['red','green','blue','alpha'][index]}/>{['Red','Green','Blue','Alpha'][index]}</label>)}</div></section>
              <div className="information-pane inversion-note"><p>Inverts pixel values using <code>255 - Value</code> (One-Minus). Perfect for converting Glossiness to Roughness, Smoothness to Roughness, or flipping DirectX/OpenGL Normal map Y green channel.</p></div>
            </div>}
            <div className="source-list">{active.map(item=><ChannelInput key={item.id} channel={item} onFileChange={updateFile} onFallbackChange={updateFallback} tiffOnly={mode===AppMode.Convert16to8} disabled={processing}/>)}</div>
          </>}
        </div>
        <div className="process-actions"><button className="primary-button" aria-label="Process textures" disabled={!canProcess} onClick={()=>void process()}>{processing?<><span className="spinner"/>Processing…</>:mode===AppMode.InvertMap?'Invert / Convert Map':'Process Textures'}</button>{processing&&<button className="cancel-button" onClick={cancelProcess}>Cancel</button>}{pending>0&&mode!==AppMode.Atlas&&<button className="cancel-button" onClick={clear}>Clear sources</button>}</div>
      </aside>
      <main className="preview-panel">
        <div className="preview-toolbar"><div className="viewport-status"><i className={processing?'working':''}/><span>Viewport 1.0</span><span className="visually-hidden" aria-live="polite">{pending?'Loading sources…':`${loaded} sources loaded`}</span></div><div className="toolbar-actions">{result&&<><span className="output-size">{result.width} x {result.height} px</span><button className="download-button" disabled={busy} onClick={download}>Download Output</button></>}</div></div>
        <div className="viewport-area" role="region" aria-label="Texture preview. Ctrl+Plus and Ctrl+Minus zoom. Ctrl+0 fits the image."><div className={`checker-preview ${zoom!=='fit'&&result?'zoomed':''} ${mode===AppMode.Atlas&&!result?'atlas-preview':''}`}>
          {result?<img className={`output-image ${zoom!=='fit'?'zoomed':''}`} style={zoom!=='fit'?{width:result.width*Number(zoom),height:result.height*Number(zoom)}:undefined} src={result.url} alt="Processed texture"/>:mode===AppMode.Atlas?<div className="atlas-grid" style={{gridTemplateColumns:`repeat(${grid.cols},minmax(0,1fr))`,gridTemplateRows:`repeat(${grid.rows},minmax(0,1fr))`,height:`calc(min(70vh,70vw) * ${grid.rows/grid.cols})`}}>
            {active.map((item,index)=><div className="atlas-cell" data-slot={item.id} key={item.id} onDragOver={event=>{event.preventDefault();event.stopPropagation();}} onDrop={event=>{event.preventDefault();event.stopPropagation();if(!processing)Array.from(event.dataTransfer.files).slice(0,active.length-index).forEach((file,offset)=>void updateFile(active[index+offset].id,file));}}><label title={item.file?.name??`Choose slot ${index+1}`}><input type="file" accept={IMAGE_ACCEPT} disabled={processing} aria-label={`Slot ${index+1} file`} onChange={event=>{if(event.target.files?.[0])void updateFile(item.id,event.target.files[0]);event.target.value='';}}/>{item.previewUrl?<img src={item.previewUrl} alt={`Slot ${index+1}`}/>:<span>{index+1}</span>}</label>{item.file&&<button className="cell-remove" disabled={processing} aria-label={`Remove slot ${index+1}`} onClick={()=>void updateFile(item.id,null)}>×</button>}</div>)}
          </div>:mode===AppMode.InvertMap&&sourcePreview?<div className="source-preview"><img src={sourcePreview} alt="Source Preview"/><span>Source Texture (Click Process to Invert)</span></div>:<div className="empty-preview"><svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 002 2v12a2 2 0 002 2z" strokeWidth="1"/></svg><p>Empty Workspace</p></div>}
        </div>{processing&&<div className="processing-overlay" role="status"><span className="spinner"/>Processing textures…</div>}</div>
        {error&&<div className="error-message" role="alert">{error}</div>}
      </main>
    </div>
    {dragging&&<div className="drop-overlay"><div>Drop anywhere to fill empty slots</div></div>}
  </div>;
}

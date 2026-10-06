import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ChannelInput from './components/ChannelInput';
import { ChannelState, AppMode, FallbackColor, PackResult } from './types';
import { packTextures, generateTifPreview } from './utils/packer';

const createPackingState = (): ChannelState[] => [
  { id: 'R', file: null, previewUrl: null, fallback: 'white', label: 'Red Channel', colorClass: 'text-red-500 border-red-500' },
  { id: 'G', file: null, previewUrl: null, fallback: 'white', label: 'Green Channel', colorClass: 'text-green-500 border-green-500' },
  { id: 'B', file: null, previewUrl: null, fallback: 'black', label: 'Blue Channel', colorClass: 'text-blue-500 border-blue-500' },
  { id: 'A', file: null, previewUrl: null, fallback: 'white', label: 'Alpha Channel', colorClass: 'text-zinc-400 border-zinc-400' },
];

const createCombineAlphaState = (): ChannelState[] => [
  { id: 'base', file: null, previewUrl: null, fallback: 'black', label: 'Base Texture (RGB)', colorClass: 'text-indigo-400 border-indigo-400' },
  { id: 'alpha', file: null, previewUrl: null, fallback: 'white', label: 'Alpha Mask (Grayscale)', colorClass: 'text-zinc-400 border-zinc-400' },
];

const createConvert16State = (): ChannelState[] => [
  { id: 'tif', file: null, previewUrl: null, fallback: 'black', label: 'Source 16-bit TIF', colorClass: 'text-emerald-400 border-emerald-400' },
];

const createInvertState = (): ChannelState[] => [
  { id: 'invert_src', file: null, previewUrl: null, fallback: 'black', label: 'Source Texture Map (Gloss / Rough / Normal)', colorClass: 'text-amber-400 border-amber-400' },
];

const createAtlasState = (cols: number, rows: number): ChannelState[] => Array.from({ length: cols * rows }, (_, i) => ({
  id: `atlas_${i}`,
  file: null,
  previewUrl: null,
  fallback: 'black',
  label: `Slot ${i + 1}`,
  colorClass: 'text-zinc-400 border-zinc-400'
}));

function App() {
  const [mode, setMode] = useState<AppMode>(AppMode.ChannelPacking);
  const [packingState, setPackingState] = useState<ChannelState[]>(createPackingState());
  const [combineState, setCombineState] = useState<ChannelState[]>(createCombineAlphaState());
  const [convert16State, setConvert16State] = useState<ChannelState[]>(createConvert16State());
  const [invertState, setInvertState] = useState<ChannelState[]>(createInvertState());
  const [invertChannels, setInvertChannels] = useState<{ r: boolean; g: boolean; b: boolean; a: boolean }>({
    r: true,
    g: true,
    b: true,
    a: false,
  });
  const [atlasGrid, setAtlasGrid] = useState({ cols: 4, rows: 4 });
  const [atlasInputCols, setAtlasInputCols] = useState("4");
  const [atlasInputRows, setAtlasInputRows] = useState("4");
  const [atlasState, setAtlasState] = useState<ChannelState[]>(createAtlasState(4, 4));
  const [result, setResult] = useState<PackResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDraggingGlobal, setIsDraggingGlobal] = useState(false);

  const handleGridChange = (cols: number, rows: number) => {
    setAtlasState(prev => {
      const newState = createAtlasState(cols, rows);
      for (let i = 0; i < prev.length; i++) {
        const oldCol = i % atlasGrid.cols;
        const oldRow = Math.floor(i / atlasGrid.cols);
        if (oldCol < cols && oldRow < rows) {
          const newIndex = oldRow * cols + oldCol;
          newState[newIndex].file = prev[i].file;
          newState[newIndex].previewUrl = prev[i].previewUrl;
        }
      }
      return newState;
    });
    setAtlasGrid({ cols, rows });
    setAtlasInputCols(cols.toString());
    setAtlasInputRows(rows.toString());
    setResult(null);
  };

  const activeChannels = useMemo(() => {
    if (mode === AppMode.ChannelPacking) return packingState;
    if (mode === AppMode.CombineAlpha) return combineState;
    if (mode === AppMode.Convert16to8) return convert16State;
    if (mode === AppMode.InvertMap) return invertState;
    return atlasState;
  }, [mode, packingState, combineState, convert16State, invertState, atlasState]);

  const updateChannels = useCallback(async (id: string, file: File | null) => {
    let setter;
    if (mode === AppMode.ChannelPacking) setter = setPackingState;
    else if (mode === AppMode.CombineAlpha) setter = setCombineState;
    else if (mode === AppMode.Convert16to8) setter = setConvert16State;
    else if (mode === AppMode.InvertMap) setter = setInvertState;
    else setter = setAtlasState;

    let previewUrl: string | null = null;
    if (file) {
      const isTiff = file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff');
      if (isTiff) {
        try {
          previewUrl = await generateTifPreview(file);
        } catch (e) {
          console.error("Could not generate TIF preview");
          previewUrl = null;
        }
      } else {
        previewUrl = URL.createObjectURL(file);
      }
    }

    setter(prev => prev.map(ch => {
      if (ch.id !== id) return ch;
      if (ch.previewUrl && !ch.previewUrl.startsWith('data:')) URL.revokeObjectURL(ch.previewUrl);
      return { ...ch, file, previewUrl };
    }));
    setResult(null);
  }, [mode]);

  const updateFallback = useCallback((id: string, fallback: FallbackColor) => {
    let setter;
    if (mode === AppMode.ChannelPacking) setter = setPackingState;
    else if (mode === AppMode.CombineAlpha) setter = setCombineState;
    else if (mode === AppMode.Convert16to8) setter = setConvert16State;
    else if (mode === AppMode.InvertMap) setter = setInvertState;
    else setter = setAtlasState;

    setter(prev => prev.map(ch => ch.id === id ? { ...ch, fallback } : ch));
    setResult(null);
  }, [mode]);

  const onGlobalDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingGlobal(true);
  };

  const onGlobalDragLeave = () => {
    setIsDraggingGlobal(false);
  };

  const onGlobalDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingGlobal(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files) as File[];
      
      // Keep track of filled slots locally during the loop
      let currentChannels = [...activeChannels];
      
      for (const file of droppedFiles) {
        const emptySlotIdx = currentChannels.findIndex(ch => ch.file === null);
        if (emptySlotIdx !== -1) {
          const targetId = currentChannels[emptySlotIdx].id;
          currentChannels[emptySlotIdx] = { ...currentChannels[emptySlotIdx], file }; // Mark as filled
          await updateChannels(targetId, file);
        }
      }
    }
  };

  const handlePack = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      await new Promise(r => setTimeout(r, 100));
      const res = await packTextures(mode, activeChannels, {
        atlasCols: atlasGrid.cols,
        atlasRows: atlasGrid.rows,
        invertChannels,
      });
      setResult(res);
    } catch (err: any) {
      setError(err.message || "Operation failed");
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadResult = () => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.url;
    a.download = `converted_${Date.now()}_${result.width}x${result.height}.png`;
    a.click();
  };

  return (
    <div 
      className="flex flex-col h-full bg-zinc-950 text-zinc-100 overflow-hidden font-sans relative"
      onDragOver={onGlobalDragOver}
      onDragLeave={onGlobalDragLeave}
      onDrop={onGlobalDrop}
    >
      {isDraggingGlobal && (
        <div className="absolute inset-0 pointer-events-none border-4 border-dashed border-indigo-500/50 flex items-center justify-center bg-indigo-500/10 z-50 backdrop-blur-[2px]">
          <div className="bg-zinc-900 border border-indigo-500/50 px-6 py-3 rounded-xl shadow-2xl text-sm font-bold uppercase tracking-widest text-indigo-400">
            Drop anywhere to fill empty slots
          </div>
        </div>
      )}
      <header className="flex-none h-14 border-b border-zinc-800 bg-zinc-950 px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-indigo-600 rounded flex items-center justify-center font-bold text-xs">TX</div>
          <h1 className="font-bold text-lg tracking-tight">Texture Packer <span className="text-zinc-500 font-normal">Pro</span></h1>
        </div>
        <div className="flex gap-4 items-center text-zinc-600 text-[10px] font-bold uppercase tracking-widest">
          High Bit-Depth Utility
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <aside 
          className={`w-[380px] flex-none border-r border-zinc-800 p-6 overflow-y-auto transition-colors relative ${
            isDraggingGlobal ? 'bg-indigo-500/5' : 'bg-zinc-900/10'
          }`}
        >

          <div className="flex bg-zinc-900 p-1 rounded-lg mb-6 border border-zinc-800 flex-wrap gap-1">
            <button 
              onClick={() => { setMode(AppMode.ChannelPacking); setResult(null); }}
              className={`flex-1 py-1.5 px-1 text-[10px] font-bold uppercase tracking-tighter rounded-md transition-all ${mode === AppMode.ChannelPacking ? 'bg-zinc-700 text-white shadow-md' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Channels
            </button>
            <button 
              onClick={() => { setMode(AppMode.CombineAlpha); setResult(null); }}
              className={`flex-1 py-1.5 px-1 text-[10px] font-bold uppercase tracking-tighter rounded-md transition-all ${mode === AppMode.CombineAlpha ? 'bg-zinc-700 text-white shadow-md' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              + Alpha
            </button>
            <button 
              onClick={() => { setMode(AppMode.Convert16to8); setResult(null); }}
              className={`flex-1 py-1.5 px-1 text-[10px] font-bold uppercase tracking-tighter rounded-md transition-all ${mode === AppMode.Convert16to8 ? 'bg-emerald-600 text-white shadow-md' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              TIF 16→8
            </button>
            <button 
              onClick={() => { setMode(AppMode.Atlas); setResult(null); }}
              className={`flex-1 py-1.5 px-1 text-[10px] font-bold uppercase tracking-tighter rounded-md transition-all ${mode === AppMode.Atlas ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Atlas
            </button>
            <button 
              onClick={() => { setMode(AppMode.InvertMap); setResult(null); }}
              className={`flex-1 py-1.5 px-1 text-[10px] font-bold uppercase tracking-tighter rounded-md transition-all ${mode === AppMode.InvertMap ? 'bg-amber-600 text-white shadow-md' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Gloss ⇄ Rough
            </button>
          </div>

          <div className="space-y-4">
            {mode === AppMode.Atlas ? (
              <div className="space-y-6">
                <div>
                  <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Grid Size</h3>
                  <div className="flex gap-2 mb-3">
                    <div className="flex-1">
                      <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Columns</label>
                      <input 
                        type="number" 
                        min="1" 
                        max="20"
                        value={atlasInputCols}
                        onChange={(e) => setAtlasInputCols(e.target.value)}
                        onBlur={() => handleGridChange(Math.max(1, parseInt(atlasInputCols) || 1), atlasGrid.rows)}
                        onKeyDown={(e) => e.key === 'Enter' && handleGridChange(Math.max(1, parseInt(atlasInputCols) || 1), atlasGrid.rows)}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Rows</label>
                      <input 
                        type="number" 
                        min="1" 
                        max="20"
                        value={atlasInputRows}
                        onChange={(e) => setAtlasInputRows(e.target.value)}
                        onBlur={() => handleGridChange(atlasGrid.cols, Math.max(1, parseInt(atlasInputRows) || 1))}
                        onKeyDown={(e) => e.key === 'Enter' && handleGridChange(atlasGrid.cols, Math.max(1, parseInt(atlasInputRows) || 1))}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <button onClick={() => handleGridChange(2, 2)} className={`py-1.5 text-[10px] font-bold rounded-lg border transition-colors ${atlasGrid.cols === 2 && atlasGrid.rows === 2 ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800'}`}>2x2</button>
                    <button onClick={() => handleGridChange(3, 3)} className={`py-1.5 text-[10px] font-bold rounded-lg border transition-colors ${atlasGrid.cols === 3 && atlasGrid.rows === 3 ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800'}`}>3x3</button>
                    <button onClick={() => handleGridChange(4, 4)} className={`py-1.5 text-[10px] font-bold rounded-lg border transition-colors ${atlasGrid.cols === 4 && atlasGrid.rows === 4 ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800'}`}>4x4</button>
                    <button onClick={() => handleGridChange(2, 3)} className={`py-1.5 text-[10px] font-bold rounded-lg border transition-colors ${atlasGrid.cols === 2 && atlasGrid.rows === 3 ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800'}`}>2x3</button>
                  </div>
                </div>
                <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4">
                  <p className="text-xs text-indigo-300 leading-relaxed font-medium">
                    Drag and drop textures directly onto the grid cells in the viewport to the right.
                  </p>
                </div>
                <button 
                  onClick={() => { setAtlasState(createAtlasState(atlasGrid.cols, atlasGrid.rows)); setResult(null); }}
                  className="w-full py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-xs font-bold text-zinc-400 transition-colors"
                >
                  Clear All Slots
                </button>
              </div>
            ) : mode === AppMode.InvertMap ? (
              <div className="space-y-5">
                <div>
                  <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2.5">Presets</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setInvertChannels({ r: true, g: true, b: true, a: false })}
                      className={`py-2 px-3 text-left rounded-lg border transition-all ${
                        invertChannels.r && invertChannels.g && invertChannels.b && !invertChannels.a
                          ? 'bg-amber-600 border-amber-500 text-white shadow-lg shadow-amber-600/20'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                      }`}
                    >
                      <div className="text-[11px] font-bold">Gloss ⇄ Rough</div>
                      <div className="text-[9px] opacity-70">RGB Invert (1 - x)</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setInvertChannels({ r: false, g: true, b: false, a: false })}
                      className={`py-2 px-3 text-left rounded-lg border transition-all ${
                        !invertChannels.r && invertChannels.g && !invertChannels.b && !invertChannels.a
                          ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-600/20'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                      }`}
                    >
                      <div className="text-[11px] font-bold">Flip Normal Y</div>
                      <div className="text-[9px] opacity-70">DirectX ⇄ OpenGL (G)</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setInvertChannels({ r: false, g: false, b: false, a: true })}
                      className={`py-2 px-3 text-left rounded-lg border transition-all ${
                        !invertChannels.r && !invertChannels.g && !invertChannels.b && invertChannels.a
                          ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/20'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                      }`}
                    >
                      <div className="text-[11px] font-bold">Invert Alpha</div>
                      <div className="text-[9px] opacity-70">Alpha Mask (1 - A)</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setInvertChannels({ r: true, g: true, b: true, a: true })}
                      className={`py-2 px-3 text-left rounded-lg border transition-all ${
                        invertChannels.r && invertChannels.g && invertChannels.b && invertChannels.a
                          ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/20'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                      }`}
                    >
                      <div className="text-[11px] font-bold">Invert All</div>
                      <div className="text-[9px] opacity-70">Full RGBA Inversion</div>
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Channels to Invert</h3>
                    <span className="text-[10px] text-zinc-500 font-mono">255 - X</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <button
                      type="button"
                      onClick={() => setInvertChannels(prev => ({ ...prev, r: !prev.r }))}
                      className={`py-2 rounded-lg font-bold text-xs border transition-all flex items-center justify-center gap-1.5 ${
                        invertChannels.r
                          ? 'bg-red-500/20 border-red-500 text-red-400 shadow-md shadow-red-500/10'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-600 hover:border-zinc-700'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${invertChannels.r ? 'bg-red-500' : 'bg-zinc-700'}`} />
                      Red
                    </button>
                    <button
                      type="button"
                      onClick={() => setInvertChannels(prev => ({ ...prev, g: !prev.g }))}
                      className={`py-2 rounded-lg font-bold text-xs border transition-all flex items-center justify-center gap-1.5 ${
                        invertChannels.g
                          ? 'bg-green-500/20 border-green-500 text-green-400 shadow-md shadow-green-500/10'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-600 hover:border-zinc-700'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${invertChannels.g ? 'bg-green-500' : 'bg-zinc-700'}`} />
                      Green
                    </button>
                    <button
                      type="button"
                      onClick={() => setInvertChannels(prev => ({ ...prev, b: !prev.b }))}
                      className={`py-2 rounded-lg font-bold text-xs border transition-all flex items-center justify-center gap-1.5 ${
                        invertChannels.b
                          ? 'bg-blue-500/20 border-blue-500 text-blue-400 shadow-md shadow-blue-500/10'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-600 hover:border-zinc-700'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${invertChannels.b ? 'bg-blue-500' : 'bg-zinc-700'}`} />
                      Blue
                    </button>
                    <button
                      type="button"
                      onClick={() => setInvertChannels(prev => ({ ...prev, a: !prev.a }))}
                      className={`py-2 rounded-lg font-bold text-xs border transition-all flex items-center justify-center gap-1.5 ${
                        invertChannels.a
                          ? 'bg-zinc-100/20 border-zinc-300 text-zinc-200 shadow-md'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-600 hover:border-zinc-700'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${invertChannels.a ? 'bg-zinc-200' : 'bg-zinc-700'}`} />
                      Alpha
                    </button>
                  </div>
                </div>

                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                  <p className="text-xs text-amber-300 leading-relaxed font-medium">
                    Inverts pixel values using <code className="bg-amber-950/60 px-1 py-0.5 rounded font-mono text-[10px]">255 - Value</code> (One-Minus). Perfect for converting Glossiness to Roughness, Smoothness to Roughness, or flipping DirectX/OpenGL Normal map Y green channel.
                  </p>
                </div>

                {activeChannels.map(ch => (
                  <ChannelInput 
                    key={ch.id}
                    channel={ch}
                    onFileChange={updateChannels}
                    onFallbackChange={updateFallback}
                  />
                ))}
              </div>
            ) : (
              activeChannels.map(ch => (
                <ChannelInput 
                  key={ch.id}
                  channel={ch}
                  onFileChange={updateChannels}
                  onFallbackChange={updateFallback}
                />
              ))
            )}
          </div>

          <div className="mt-8">
            <button 
              onClick={handlePack}
              disabled={isProcessing}
              className={`w-full py-4 rounded-xl font-black uppercase tracking-widest text-xs transition-all flex items-center justify-center gap-2 ${
                isProcessing 
                  ? 'bg-zinc-800 text-zinc-500' 
                  : mode === AppMode.InvertMap 
                    ? 'bg-amber-600 hover:bg-amber-500 shadow-xl shadow-amber-600/20 text-white' 
                    : 'bg-indigo-600 hover:bg-indigo-500 shadow-xl shadow-indigo-600/20 text-white'
              }`}
            >
              {isProcessing ? (
                 <div className="w-4 h-4 border-2 border-zinc-500 border-t-white animate-spin rounded-full"></div>
              ) : mode === AppMode.InvertMap ? 'Invert / Convert Map' : 'Process Textures'}
            </button>
          </div>
        </aside>

        <main className="flex-1 relative bg-[#09090b] flex flex-col">
          <div className="flex-none h-12 border-b border-zinc-800 px-6 flex items-center justify-between bg-zinc-950/50">
             <div className="flex items-center gap-2">
               <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-amber-500 animate-ping' : 'bg-emerald-500 animate-pulse'}`}></div>
               <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-400">Viewport 1.0</span>
             </div>
             {result && (
               <div className="flex gap-4 items-center">
                 <span className="text-[10px] font-mono text-zinc-500">{result.width} x {result.height} px</span>
                 <button 
                  onClick={downloadResult}
                  className="bg-emerald-600 hover:bg-emerald-500 px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider text-white transition-all shadow-lg shadow-emerald-600/20"
                 >
                   Download Output
                 </button>
               </div>
             )}
          </div>

          <div className="flex-1 overflow-hidden flex items-center justify-center p-12">
            <div 
              className="relative shadow-2xl border border-zinc-800 max-w-full max-h-full aspect-square bg-[#121214]"
              style={{
                backgroundImage: `
                  linear-gradient(45deg, #18181b 25%, transparent 25%), 
                  linear-gradient(-45deg, #18181b 25%, transparent 25%), 
                  linear-gradient(45deg, transparent 75%, #18181b 75%), 
                  linear-gradient(-45deg, transparent 75%, #18181b 75%)
                `,
                backgroundSize: '24px 24px',
                backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0px'
              }}
            >
              {result ? (
                <img src={result.url} alt="Result" className="max-w-full max-h-[75vh] object-contain" />
              ) : mode === AppMode.Atlas ? (
                <div 
                  className="grid border border-zinc-800/50 bg-black shadow-2xl"
                  style={{ 
                    gridTemplateColumns: `repeat(${atlasGrid.cols}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${atlasGrid.rows}, minmax(0, 1fr))`,
                    width: 'min(70vh, 70vw)',
                    height: `calc(min(70vh, 70vw) * ${atlasGrid.rows / atlasGrid.cols})`,
                    maxHeight: '75vh'
                  }}
                >
                  {Array.from({ length: atlasGrid.cols * atlasGrid.rows }).map((_, i) => {
                    const slot = atlasState[i];
                    return (
                    <div 
                      key={i} 
                      className="border border-zinc-800/30 flex items-center justify-center relative group hover:bg-zinc-900 transition-colors cursor-pointer overflow-hidden"
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add('bg-indigo-500/20', 'border-indigo-500'); }}
                      onDragLeave={(e) => { e.currentTarget.classList.remove('bg-indigo-500/20', 'border-indigo-500'); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        e.currentTarget.classList.remove('bg-indigo-500/20', 'border-indigo-500');
                        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                          const droppedFiles = Array.from(e.dataTransfer.files) as File[];
                          droppedFiles.forEach((file, idx) => {
                            const targetIdx = i + idx;
                            if (targetIdx < atlasState.length) {
                              updateChannels(`atlas_${targetIdx}`, file);
                            }
                          });
                        }
                      }}
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = 'image/*';
                        input.onchange = (e: any) => {
                          if (e.target.files && e.target.files[0]) {
                            updateChannels(`atlas_${i}`, e.target.files[0]);
                          }
                        };
                        input.click();
                      }}
                    >
                      {slot?.file ? (
                        <>
                          <img src={slot.previewUrl!} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity pointer-events-none" />
                          <button 
                            onClick={(e) => { e.stopPropagation(); updateChannels(`atlas_${i}`, null); }} 
                            className="absolute top-1 right-1 bg-red-500 hover:bg-red-400 text-white rounded w-5 h-5 flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-10"
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <span className="text-[10px] text-zinc-700 font-bold group-hover:text-indigo-400 transition-colors pointer-events-none">{i + 1}</span>
                      )}
                    </div>
                  )})}
                </div>
              ) : mode === AppMode.InvertMap && invertState[0]?.previewUrl ? (
                <div className="relative group max-w-full max-h-[75vh] flex items-center justify-center">
                  <img src={invertState[0].previewUrl} alt="Source Preview" className="max-w-full max-h-[75vh] object-contain opacity-80" />
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-zinc-950/90 backdrop-blur border border-zinc-800 px-3 py-1 rounded text-[10px] font-bold text-amber-400 uppercase tracking-wider shadow-lg">
                    Source Texture (Click Process to Invert)
                  </div>
                </div>
              ) : (
                <div className="w-80 h-80 flex flex-col items-center justify-center text-zinc-700">
                  <svg className="w-12 h-12 mb-4 opacity-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" strokeWidth={1} /></svg>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-30 text-center">Empty Workspace</p>
                </div>
              )}
            </div>
          </div>
          
          {error && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-red-600 text-white px-6 py-3 rounded-xl shadow-2xl text-xs font-bold uppercase tracking-wider">
              {error}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
import React, { useRef, useState } from 'react';
import { FallbackColor } from '../types';

interface ChannelInputProps {
  channel: {
    id: string;
    file: File | null;
    previewUrl: string | null;
    fallback: FallbackColor;
    label: string;
    colorClass: string;
  };
  onFileChange: (id: string, file: File | null) => void;
  onFallbackChange: (id: string, fallback: FallbackColor) => void;
}

const ChannelInput: React.FC<ChannelInputProps> = ({ channel, onFileChange, onFallbackChange }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileChange(channel.id, e.target.files[0]);
    }
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (inputRef.current) inputRef.current.value = '';
    onFileChange(channel.id, null);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onFileChange(channel.id, e.dataTransfer.files[0]);
    }
  };

  return (
    <div 
      className={`relative flex flex-col gap-2 p-3 rounded-xl border transition-all group ${
        isDragging ? 'border-indigo-500 bg-indigo-500/10 scale-[1.02]' : 'border-zinc-800 bg-zinc-900/30 hover:border-zinc-700'
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <div className={`text-[10px] font-black uppercase w-5 h-5 flex items-center justify-center rounded border ${channel.colorClass}`}>
            {channel.id.charAt(0)}
          </div>
          <span className="text-xs font-bold text-zinc-400 truncate max-w-[180px]">{channel.label}</span>
        </div>
        {channel.file && (
           <button onClick={handleRemove} className="text-[10px] text-red-500 hover:text-red-400 font-bold uppercase tracking-tighter">Remove</button>
        )}
      </div>

      <div 
        className={`relative w-full aspect-[2/1] rounded-lg overflow-hidden bg-black border cursor-pointer transition-colors flex items-center justify-center ${
          isDragging ? 'border-indigo-400' : 'border-zinc-800 hover:bg-zinc-900'
        }`}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
        
        {channel.previewUrl ? (
          <img src={channel.previewUrl} alt="Preview" className="w-full h-full object-contain" />
        ) : (
          <div className={`flex flex-col items-center ${isDragging ? 'opacity-100 text-indigo-400' : 'opacity-30'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-[10px] uppercase font-bold tracking-widest">
              {isDragging ? 'Drop Here' : 'Select File'}
            </span>
          </div>
        )}
      </div>

      {!channel.file && (
        <div className="flex items-center justify-between mt-1 px-1">
          <span className="text-[9px] text-zinc-600 font-bold uppercase">Fill</span>
          <div className="flex gap-1">
            {(['black', 'white'] as FallbackColor[]).map(f => (
              <button
                key={f}
                onClick={() => onFallbackChange(channel.id, f)}
                className={`w-4 h-4 rounded-sm border transition-all ${
                  channel.fallback === f 
                    ? 'border-indigo-500 scale-110 shadow-lg' 
                    : 'border-zinc-800 opacity-50 hover:opacity-100'
                } ${f === 'white' ? 'bg-white' : 'bg-zinc-950'}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ChannelInput;
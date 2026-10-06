import { useRef, useState } from 'react';
import { ChannelState, FallbackColor } from '../types';
import { IMAGE_ACCEPT } from '../utils/packer';

interface Props {
  channel: ChannelState;
  onFileChange: (id: string, file: File | null) => void;
  onFallbackChange: (id: string, fallback: FallbackColor) => void;
  allowFallback?: boolean;
  tiffOnly?: boolean;
  disabled?: boolean;
}

export default function ChannelInput({ channel, onFileChange, onFallbackChange, allowFallback = true, tiffOnly = false, disabled = false }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return <section className={`source-card ${dragging ? 'dragging' : ''}`} data-slot={channel.id}
    onDragOver={event => { event.preventDefault(); event.stopPropagation(); if (!disabled) setDragging(true); }}
    onDragLeave={() => setDragging(false)}
    onDrop={event => { event.preventDefault(); event.stopPropagation(); setDragging(false); if (!disabled && event.dataTransfer.files[0]) onFileChange(channel.id, event.dataTransfer.files[0]); }}>
    <div className="source-heading"><span className={`channel-badge ${channel.colorClass}`}>{channel.id === 'base' ? 'RGB' : channel.id === 'alpha' ? 'A' : channel.id === 'tif' ? '16' : channel.id === 'invert_src' ? '±' : channel.id}</span><h3>{channel.label}</h3>
      {channel.file && <button className="icon-button" aria-label={`Remove ${channel.label}`} disabled={disabled} onClick={() => onFileChange(channel.id, null)}>×</button>}
    </div>
    <button className={`file-picker ${channel.previewUrl ? 'has-image' : ''}`} disabled={disabled} onClick={() => input.current?.click()} aria-label={`Choose ${channel.label}`}>
      {channel.previewUrl ? <img src={channel.previewUrl} alt={`${channel.label} preview`} /> : <span className="picker-icon">＋</span>}
      <span className="picker-copy"><strong>{channel.file?.name ?? 'Choose a texture'}</strong><span>{channel.file ? 'Click to replace · or drop a file' : 'Click to browse · or drop a file'}</span></span>
    </button>
    <input ref={input} className="visually-hidden" type="file" accept={tiffOnly ? '.tif,.tiff' : IMAGE_ACCEPT} aria-label={`${channel.label} file`} disabled={disabled} onChange={event => { if (event.target.files?.[0]) onFileChange(channel.id, event.target.files[0]); event.target.value = ''; }} />
    {allowFallback && !channel.file && <div className="fallback"><span>Empty channel</span><div className="segmented">{(['black', 'white'] as const).map(fill => <button key={fill} aria-pressed={channel.fallback === fill} disabled={disabled} onClick={() => onFallbackChange(channel.id, fill)}><i className={`swatch ${fill}`} />{fill === 'black' ? 'Black · 0' : 'White · 255'}</button>)}</div></div>}
  </section>;
}

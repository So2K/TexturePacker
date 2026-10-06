import { useRef, useState } from 'react';
import { ChannelState, FallbackColor } from '../types';
import { IMAGE_ACCEPT } from '../utils/packer';
interface Props {
  channel: ChannelState;
  onFileChange: (id: string, file: File | null) => void;
  onFallbackChange: (id: string, fallback: FallbackColor) => void;
  tiffOnly?: boolean;
  disabled?: boolean;
}
export default function ChannelInput({ channel, onFileChange, onFallbackChange, tiffOnly=false, disabled=false }: Props) {
  const input=useRef<HTMLInputElement>(null);
  const [dragging,setDragging]=useState(false);
  return <section className={`source-card ${dragging?'dragging':''}`} data-slot={channel.id}
    onDragOver={event=>{event.preventDefault();event.stopPropagation();if(!disabled)setDragging(true);}}
    onDragLeave={()=>setDragging(false)}
    onDrop={event=>{event.preventDefault();event.stopPropagation();setDragging(false);if(!disabled&&event.dataTransfer.files[0])onFileChange(channel.id,event.dataTransfer.files[0]);}}>
    <div className="source-heading"><div className="source-title"><span className={`channel-badge ${channel.colorClass}`}>{channel.id.charAt(0)}</span><span className="channel-label" title={channel.label}>{channel.label}</span></div>{channel.file&&<button className="remove-button" disabled={disabled} aria-label={`Remove ${channel.label}`} onClick={()=>onFileChange(channel.id,null)}>Remove</button>}</div>
    <button className="file-picker" aria-label={`Choose ${channel.label}`} disabled={disabled} onClick={()=>input.current?.click()} title={channel.file?.name}>
      {channel.previewUrl?<img src={channel.previewUrl} alt={`${channel.label} preview`}/>:<span className="picker-empty"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M12 4v16m8-8H4" strokeWidth="2" strokeLinecap="round"/></svg><span>{dragging?'Drop Here':'Select File'}</span></span>}
    </button>
    <input ref={input} className="visually-hidden" type="file" accept={tiffOnly?'.tif,.tiff':IMAGE_ACCEPT} aria-label={`${channel.label} file`} disabled={disabled} onChange={event=>{if(event.target.files?.[0])onFileChange(channel.id,event.target.files[0]);event.target.value='';}}/>
    {!channel.file&&<div className="fallback"><span>Fill</span><div>{(['black','white']as const).map(fill=><button key={fill} className={`fill-swatch ${fill}`} aria-label={`Fill ${channel.label} ${fill}`} aria-pressed={channel.fallback===fill} disabled={disabled} onClick={()=>onFallbackChange(channel.id,fill)}/>)}</div></div>}
  </section>;
}

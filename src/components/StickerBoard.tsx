import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Search, X, RotateCw, RotateCcw, Minus, Plus, Trash2, ChevronsUp, ChevronsDown } from 'lucide-react';
import { searchStickers, STICKER_CATEGORIES, STICKER_MAP } from '../lib/stickers';
import type { StickerCategory } from '../lib/stickers';
import type { PlacedSticker } from '../lib/model';

export function StickerBoard({stickers,onChange,editing}:{stickers:PlacedSticker[];onChange:(s:PlacedSticker[])=>void;editing:boolean}){
  const boardRef=useRef<HTMLDivElement>(null);
  const [selected,setSelected]=useState<string|null>(null);
  const [lastRemoved,setLastRemoved]=useState<PlacedSticker|null>(null);
  const dragRef=useRef<{id:string}|null>(null);

  useEffect(()=>{ if(!editing)setSelected(null) },[editing]);

  function toPct(clientX:number,clientY:number){
    const r=boardRef.current!.getBoundingClientRect();
    return {x:Math.min(96,Math.max(4,((clientX-r.left)/r.width)*100)),y:Math.min(92,Math.max(6,((clientY-r.top)/r.height)*100))};
  }
  function startDrag(e:React.PointerEvent,st:PlacedSticker){
    if(!editing)return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setSelected(st.id);
    dragRef.current={id:st.id};
  }
  function onMove(e:React.PointerEvent){
    const d=dragRef.current;
    if(!d||!boardRef.current)return;
    const {x,y}=toPct(e.clientX,e.clientY);
    onChange(stickers.map(s=>s.id===d.id?{...s,x,y}:s));
  }
  function endDrag(){dragRef.current=null}
  function update(id:string,patch:Partial<PlacedSticker>){onChange(stickers.map(s=>s.id===id?{...s,...patch}:s))}
  function remove(id:string){const item=stickers.find(s=>s.id===id)||null;setLastRemoved(item);onChange(stickers.filter(s=>s.id!==id));if(selected===id)setSelected(null)}
  function undoRemove(){if(!lastRemoved)return;onChange([...stickers,lastRemoved]);setSelected(lastRemoved.id);setLastRemoved(null)}
  function moveLayer(id:string,direction:'front'|'back'){
    const zs=stickers.map(s=>s.z||0);
    const z=direction==='front'?Math.max(0,...zs)+1:Math.min(0,...zs)-1;
    update(id,{z});
  }

  const sel=stickers.find(s=>s.id===selected);
  return <div ref={boardRef} className={`sticker-board${editing?' editing':''}`} onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag} onPointerLeave={endDrag} onPointerDown={()=>editing&&setSelected(null)}>
    {stickers.map(st=>{
      const def=STICKER_MAP[st.key];if(!def)return null;
      return <button key={st.id} type="button" className={`sticker-placed${editing?' editable':''}${selected===st.id?' selected':''}`} style={{left:st.x+'%',top:st.y+'%',zIndex:st.z,transform:`translate(-50%,-50%) rotate(${st.r}deg) scale(${st.s})`}} onPointerDown={e=>startDrag(e,st)} aria-label={def.label}>{def.render()}</button>;
    })}
    {editing&&lastRemoved&&<div className="sticker-undo" role="status"><span>Sticker removed.</span><button type="button" onClick={undoRemove}>Undo</button></div>}
    {editing&&sel&&<div className="sticker-toolbar" style={{left:sel.x+'%',top:sel.y+'%'}} onPointerDown={e=>e.stopPropagation()}>
      <button type="button" onClick={()=>moveLayer(sel.id,'back')} aria-label="Send backward" title="Send backward"><ChevronsDown/></button>
      <button type="button" onClick={()=>update(sel.id,{r:sel.r-15})} aria-label="Rotate left" title="Rotate left"><RotateCcw/></button>
      <button type="button" onClick={()=>update(sel.id,{s:Math.max(.32,sel.s-.18)})} aria-label="Smaller" title="Smaller"><Minus/></button>
      <button type="button" onClick={()=>update(sel.id,{s:Math.min(2,sel.s+.18)})} aria-label="Bigger" title="Bigger"><Plus/></button>
      <button type="button" onClick={()=>update(sel.id,{r:sel.r+15})} aria-label="Rotate right" title="Rotate right"><RotateCw/></button>
      <button type="button" onClick={()=>moveLayer(sel.id,'front')} aria-label="Bring forward" title="Bring forward"><ChevronsUp/></button>
      <button type="button" className="danger" onClick={()=>remove(sel.id)} aria-label="Delete sticker" title="Delete"><Trash2/></button>
    </div>}
  </div>;
}

export function StickerTray({onPick,onClose,onDone,onReset,saving=false}:{onPick:(key:string)=>void;onClose:()=>void;onDone:()=>void|Promise<void>;onReset:()=>void;saving?:boolean}){
  const [q,setQ]=useState('');
  const [category,setCategory]=useState<StickerCategory|'All'>('All');
  const [keyboardInset,setKeyboardInset]=useState(0);
  useEffect(()=>{
    const vv=window.visualViewport;
    if(!vv)return;
    const sync=()=>setKeyboardInset(Math.max(0,Math.round(window.innerHeight-vv.height-vv.offsetTop)));
    sync();vv.addEventListener('resize',sync);vv.addEventListener('scroll',sync);
    return()=>{vv.removeEventListener('resize',sync);vv.removeEventListener('scroll',sync)};
  },[]);
  const results=searchStickers(q,category);
  const dismissKeyboard=()=>{const el=document.activeElement;if(el instanceof HTMLElement)el.blur()};
  return <aside className="sticker-tray" style={{'--keyboard-inset':`${keyboardInset}px`} as CSSProperties} role="region" aria-label="Sticker library">
    <div className="sticker-tray-head">
      <div className="sticker-tray-titlebar"><h3>Stickers</h3><div><button type="button" className="secondary sticker-done" disabled={saving} onClick={()=>{dismissKeyboard();void onDone()}}>{saving?'Saving…':'Done'}</button><button type="button" className="icon-btn" onClick={()=>{dismissKeyboard();onClose()}} aria-label="Cancel sticker edits" title="Cancel"><X/></button></div></div>
      <div className="sticker-tray-search"><Search/><input inputMode="search" enterKeyHint="search" placeholder="Search stickers" autoComplete="off" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')(e.currentTarget as HTMLInputElement).blur()}}/></div>
    </div>
    <div className="sticker-category-row" aria-label="Sticker categories">{STICKER_CATEGORIES.map(c=><button type="button" key={c} className={category===c?'active':''} onClick={()=>setCategory(c)}>{c}</button>)}</div>
    <div className="sticker-tray-grid">
      {results.map(s=><button type="button" key={s.key} className="sticker-tray-item" onClick={()=>onPick(s.key)} title={`Add ${s.label}`} aria-label={`Add ${s.label}`}><span>{s.render()}</span><small>{s.label}</small></button>)}
      {!results.length&&<p className="sticker-tray-empty">No stickers match “{q}”.</p>}
    </div>
    <div className="sticker-tray-foot"><span>Tap to add · drag to place · tap a sticker to resize, rotate, layer, or delete.</span><button type="button" onClick={onReset}>Clear stickers</button></div>
  </aside>;
}

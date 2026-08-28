import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { currentTimeZoneShort } from '../lib/dateTime';

const pad=(n:number)=>String(n).padStart(2,'0');
const isoDate=(d:Date)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
function parseDate(value:string){
  if(!value)return new Date();
  const [date]=value.split('T');const [y,m,d]=date.split('-').map(Number);
  return new Date(y||new Date().getFullYear(),(m||1)-1,d||1);
}
function pretty(value:string,includeTime:boolean){
  if(!value)return includeTime?'Choose date and time':'Choose a date';
  const d=new Date(includeTime?value:`${value}T12:00:00`);
  return new Intl.DateTimeFormat('en-US',includeTime?{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}:{weekday:'short',month:'short',day:'numeric'}).format(d);
}

export function DateTimePicker({value,onChange,includeTime=false,ariaLabel}:{value:string;onChange:(value:string)=>void;includeTime?:boolean;ariaLabel:string}){
  const[open,setOpen]=useState(false),[cursor,setCursor]=useState(()=>{const d=parseDate(value);return new Date(d.getFullYear(),d.getMonth(),1)});
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(value){const d=parseDate(value);setCursor(new Date(d.getFullYear(),d.getMonth(),1))}},[value]);
  useEffect(()=>{if(!open)return;const close=(e:PointerEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node))setOpen(false)};const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false)};document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key)}},[open]);
  const days=useMemo(()=>{
    const first=new Date(cursor.getFullYear(),cursor.getMonth(),1);const start=new Date(first);start.setDate(1-first.getDay());
    return Array.from({length:42},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);return d});
  },[cursor]);
  const selectedDate=value?value.split('T')[0]:'';
  const today=isoDate(new Date());
  const time=value.includes('T')?value.split('T')[1].slice(0,5):'19:00';
  function choose(d:Date){const date=isoDate(d);if(includeTime)onChange(`${date}T${time||'19:00'}`);else{onChange(date);setOpen(false)}}
  return <div className={`date-time-picker${open?' open':''}`} ref={ref}>
    <button type="button" className="date-time-trigger" aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><CalendarDays/><span>{pretty(value,includeTime)}</span></button>
    {open&&<div className="calendar-popover" role="dialog" aria-label={ariaLabel}>
      <header><button type="button" aria-label="Previous month" onClick={()=>setCursor(d=>new Date(d.getFullYear(),d.getMonth()-1,1))}><ChevronLeft/></button><b>{cursor.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</b><button type="button" aria-label="Next month" onClick={()=>setCursor(d=>new Date(d.getFullYear(),d.getMonth()+1,1))}><ChevronRight/></button></header>
      <div className="calendar-weekdays">{['S','M','T','W','T','F','S'].map((x,i)=><span key={`${x}-${i}`}>{x}</span>)}</div>
      <div className="calendar-days">{days.map(d=>{const key=isoDate(d),outside=d.getMonth()!==cursor.getMonth();return <button type="button" key={key} className={`${outside?'outside ':''}${key===today?'today ':''}${selectedDate===key?'selected':''}`} aria-pressed={selectedDate===key} onClick={()=>choose(d)}>{d.getDate()}</button>})}</div>
      {includeTime&&<div className="calendar-time"><label>Time <span className="calendar-time-zone">{currentTimeZoneShort()}</span><input type="time" value={time} step="900" onChange={e=>onChange(`${selectedDate||isoDate(new Date())}T${e.target.value}`)}/></label><button type="button" className="primary" disabled={!selectedDate} onClick={()=>setOpen(false)}>Done</button></div>}
    </div>}
  </div>;
}

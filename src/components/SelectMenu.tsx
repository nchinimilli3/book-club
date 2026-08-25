import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

type Option={value:string;label:string;description?:string};

export function SelectMenu({value,options,onChange,ariaLabel,className=''}:{value:string;options:Option[];onChange:(value:string)=>void;ariaLabel:string;className?:string}){
  const[open,setOpen]=useState(false);
  const ref=useRef<HTMLDivElement>(null);
  const triggerRef=useRef<HTMLButtonElement>(null);
  const optionRefs=useRef<Array<HTMLButtonElement|null>>([]);
  const selectedIndex=Math.max(0,options.findIndex(x=>x.value===value));
  const selected=options[selectedIndex]||options[0];

  function focusOption(index:number){
    const next=(index+options.length)%options.length;
    window.requestAnimationFrame(()=>optionRefs.current[next]?.focus());
  }
  function openAt(index:number){setOpen(true);focusOption(index)}

  useEffect(()=>{
    if(!open)return;
    const close=(e:PointerEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node))setOpen(false)};
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false)};
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key)};
  },[open]);

  return <div ref={ref} className={`select-menu ${className}${open?' open':''}`}>
    <button
      ref={triggerRef}
      type="button"
      className="select-menu-trigger"
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={()=>setOpen(v=>!v)}
      onKeyDown={e=>{
        if(e.key==='ArrowDown'){e.preventDefault();openAt(selectedIndex)}
        if(e.key==='ArrowUp'){e.preventDefault();openAt(selectedIndex)}
      }}
    ><span>{selected?.label||value}</span><ChevronDown/></button>
    {open&&<div className="select-menu-options" role="listbox" aria-label={ariaLabel}>{options.map((option,index)=><button
      ref={node=>{optionRefs.current[index]=node}}
      type="button"
      role="option"
      aria-selected={option.value===value}
      className={option.value===value?'selected':''}
      key={option.value}
      onClick={()=>{onChange(option.value);setOpen(false);window.requestAnimationFrame(()=>triggerRef.current?.focus())}}
      onKeyDown={e=>{
        if(e.key==='ArrowDown'){e.preventDefault();focusOption(index+1)}
        else if(e.key==='ArrowUp'){e.preventDefault();focusOption(index-1)}
        else if(e.key==='Home'){e.preventDefault();focusOption(0)}
        else if(e.key==='End'){e.preventDefault();focusOption(options.length-1)}
        else if(e.key==='Escape'){e.preventDefault();setOpen(false);window.requestAnimationFrame(()=>triggerRef.current?.focus())}
      }}
    ><span><b>{option.label}</b>{option.description&&<small>{option.description}</small>}</span>{option.value===value&&<Check/>}</button>)}</div>}
  </div>;
}

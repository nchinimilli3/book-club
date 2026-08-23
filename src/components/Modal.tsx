import { X } from 'lucide-react';
export function Modal({open,onClose,title,children,className=''}:{open:boolean;onClose:()=>void;title:string;children:any;className?:string}){
 if(!open) return null;
 return <div className="modal-backdrop" onMouseDown={onClose}>
  <section className={`sheet ${className}`} onMouseDown={e=>e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
   <div className="sheet-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><X/></button></div>{children}
  </section>
 </div>
}

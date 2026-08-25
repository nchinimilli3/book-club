import { Check, X } from 'lucide-react';

export type BookAddTarget='club'|'want_to_read'|'currently_reading'|'read';
export function BookAddMenu({title,clubName,showClub,busy,onChoose,onClose}:{title:string;clubName?:string;showClub:boolean;busy:boolean;onChoose:(target:BookAddTarget)=>void;onClose:()=>void}){
  return <div className="quick-add-menu" role="dialog" aria-modal="false" aria-label={`Add ${title}`}>
    <header><b>Add to</b><button type="button" onClick={onClose} aria-label="Close add menu"><X/></button></header>
    {showClub&&<button type="button" disabled={busy} onClick={()=>onChoose('club')}><span>{clubName||'Club'}’s list</span><Check/></button>}
    <button type="button" disabled={busy} onClick={()=>onChoose('want_to_read')}>Want to read</button>
    <button type="button" disabled={busy} onClick={()=>onChoose('currently_reading')}>Currently reading</button>
    <button type="button" disabled={busy} onClick={()=>onChoose('read')}>Books read</button>
  </div>;
}

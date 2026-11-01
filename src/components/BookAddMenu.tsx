import { useEffect } from 'react';
import { Check, X } from 'lucide-react';

export type BookAddTarget='club'|'want_to_read'|'currently_reading'|'read';
export function BookAddMenu({title,clubName,showClub,busy,clubLimitReached=false,savedTargets={},onChoose,onClose}:{title:string;clubName?:string;showClub:boolean;busy:boolean;clubLimitReached?:boolean;savedTargets?:Partial<Record<BookAddTarget,boolean>>;onChoose:(target:BookAddTarget)=>void;onClose:()=>void}){
  useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey)},[onClose]);
  return <div className="quick-add-menu" role="dialog" aria-modal="false" aria-label={`Add ${title}`}>
    <header><b>Add to</b><button type="button" onClick={onClose} aria-label="Close add menu"><X/></button></header>
    {showClub&&<button type="button" className={savedTargets.club?'saved':''} disabled={busy||(clubLimitReached&&!savedTargets.club)} onClick={()=>onChoose('club')}><span>{clubName?`${clubName} shortlist`:'Club shortlist'}{clubLimitReached&&!savedTargets.club&&<small className="quick-add-note">Your 3 picks are used</small>}</span>{savedTargets.club&&<Check/>}</button>}
    <button type="button" className={savedTargets.want_to_read?'saved':''} disabled={busy} onClick={()=>onChoose('want_to_read')}>Want to read{savedTargets.want_to_read&&<Check/>}</button>
    <button type="button" className={savedTargets.currently_reading?'saved':''} disabled={busy} onClick={()=>onChoose('currently_reading')}>Currently reading{savedTargets.currently_reading&&<Check/>}</button>
    <button type="button" className={savedTargets.read?'saved':''} disabled={busy} onClick={()=>onChoose('read')}>Books read{savedTargets.read&&<Check/>}</button>
  </div>;
}

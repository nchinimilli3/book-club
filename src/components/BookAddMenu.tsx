import { Check, X } from 'lucide-react';

export type BookAddTarget='club'|'want_to_read'|'currently_reading'|'read';
export function BookAddMenu({title,clubName,showClub,busy,clubLimitReached=false,savedTargets={},onChoose,onClose}:{title:string;clubName?:string;showClub:boolean;busy:boolean;clubLimitReached?:boolean;savedTargets?:Partial<Record<BookAddTarget,boolean>>;onChoose:(target:BookAddTarget)=>void;onClose:()=>void}){
  return <div className="quick-add-menu" role="dialog" aria-modal="false" aria-label={`Add ${title}`}>
    <header><b>Add to</b><button type="button" onClick={onClose} aria-label="Close add menu"><X/></button></header>
    {showClub&&<button type="button" className={savedTargets.club?'saved':''} disabled={busy||(clubLimitReached&&!savedTargets.club)} onClick={()=>onChoose('club')}><span>{clubName||'Club'}’s list{clubLimitReached&&!savedTargets.club?' · your 3 picks are used':''}</span>{savedTargets.club&&<Check/>}</button>}
    <button type="button" className={savedTargets.want_to_read?'saved':''} disabled={busy} onClick={()=>onChoose('want_to_read')}>Want to read{savedTargets.want_to_read&&<Check/>}</button>
    <button type="button" className={savedTargets.currently_reading?'saved':''} disabled={busy} onClick={()=>onChoose('currently_reading')}>Currently reading{savedTargets.currently_reading&&<Check/>}</button>
    <button type="button" className={savedTargets.read?'saved':''} disabled={busy} onClick={()=>onChoose('read')}>Books read{savedTargets.read&&<Check/>}</button>
  </div>;
}

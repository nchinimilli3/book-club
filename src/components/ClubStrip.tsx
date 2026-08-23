import { Plus } from 'lucide-react';
import { members } from '../data/demo';
export function ClubStrip({onFriend,onInvite}:{onFriend:(id:string)=>void;onInvite?:()=>void}){
 return <div className="club-strip" aria-label="Club members">
  {members.map((m,i)=><button key={m.id} onClick={()=>onFriend(m.id)} className="member-bubble"><span className={`avatar-ring ${i===0?'active':''}`}><img src={m.avatar} alt=""/></span><span>{m.name}</span></button>)}
  <button className="member-bubble" onClick={onInvite}><span className="avatar-ring add"><Plus size={19}/></span><span>Invite</span></button>
 </div>
}

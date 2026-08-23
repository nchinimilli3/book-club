import { useState } from 'react';
import { useApp } from '../lib/AppContext';
import { joinClub } from '../lib/data';
import { useRouter } from '../lib/router';

export function JoinInvitePage({code}:{code:string}){
  const a=useApp(),{navigate}=useRouter();
  const[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function join(){
    setBusy(true);setError('');
    try{
      const joined:any=await joinClub(code);
      await a.refresh();
      const id=joined?.id || a.clubs.find(c=>c.inviteCode===code)?.id;
      if(id){await a.selectClub(id);navigate(`/clubs/${id}`,true)}
      else navigate('/clubs',true);
    }catch(e:any){setError(e?.message||'Could not join this club.')}finally{setBusy(false)}
  }
  return <div className="page join-page"><section className="join-card"><h1>Join this book club</h1><p>This invite only adds your signed-in account to the private club tied to this link.</p><button className="primary" type="button" disabled={busy} onClick={join}>{busy?'Joining…':'Join club'}</button>{error&&<p className="error-text">{error}</p>}</section></div>
}

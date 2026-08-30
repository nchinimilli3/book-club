import { useEffect, useState } from 'react';
import { ArrowRight, Users } from 'lucide-react';
import { BookCover } from '../components/BookCover';
import { useApp } from '../lib/AppContext';
import { joinClub, previewClubInvite } from '@book-club/data';
import { useRouter } from '../lib/router';
import { FeedbackMessage } from '../components/PageState';
import { Avatar } from '../components/SafeImage';

export function JoinInvitePage({code}:{code:string}){
  const a=useApp(),{navigate}=useRouter();
  const[busy,setBusy]=useState(false),[error,setError]=useState(''),[preview,setPreview]=useState<any>(null),[loading,setLoading]=useState(true);
  useEffect(()=>{let cancelled=false;previewClubInvite(code).then(x=>{if(!cancelled)setPreview(x)}).catch(e=>{if(!cancelled)setError(e?.message||'This invite is no longer available.')} ).finally(()=>{if(!cancelled)setLoading(false)});return()=>{cancelled=true}},[code]);
  async function join(){
    setBusy(true);setError('');
    try{
      const joined:any=await joinClub(code);
      await a.refresh();
      const id=joined?.id||preview?.id||a.clubs.find(c=>c.inviteCode===code)?.id;
      if(id){await a.selectClub(id);sessionStorage.setItem('bookclub:just-joined',id);navigate(`/clubs/${id}`,true)}
      else navigate('/clubs',true);
    }catch(e:any){setError(e?.message||'Could not join this club.')}finally{setBusy(false)}
  }
  if(loading)return <div className="page join-page"><section className="join-card join-preview loading"><i/><i/><i/></section></div>;
  if(!preview)return <div className="page join-page"><section className="join-card"><h1>This invite has expired.</h1><p>{error||'Ask someone in the club for a fresh link.'}</p><button className="secondary" onClick={()=>navigate('/clubs')}>Back to clubs</button></section></div>;
  const members:any[]=preview.members||[],books:any[]=preview.choosing||[];
  return <div className="page join-page"><section className="join-card join-preview">
    <div className="join-private"><Users/> Private club · {preview.memberCount||members.length} members</div>
    <h1>{preview.name}</h1>
    <p className="join-lede">You were invited to read with this group.</p>
    {members.length>0&&<div className="join-members">{members.map((m:any,i:number)=><span key={`${m.name}-${i}`}><Avatar src={m.avatarUrl} name={m.name}/><b>{m.name}</b></span>)}</div>}
    {books.length>0&&<div className="join-books"><small>Currently choosing</small><div>{books.map((x:any)=><BookCover key={x.id||x.title} title={x.title} author={x.author} src={x.coverUrl}/>)}</div></div>}
    <button className="primary join-button" type="button" disabled={busy} onClick={join}>{busy?'Joining…':`Join ${preview.name}`} <ArrowRight/></button>
    {error&&<FeedbackMessage kind="error">{error}</FeedbackMessage>}
  </section></div>
}

import { useState } from 'react';
import { ArrowRight, BookOpen, Plus, UserRoundPlus } from 'lucide-react';
import { useRouter } from '../lib/router';
import { createClub, joinClub } from '@book-club/data';
import { useApp } from '../lib/AppContext';
import type { Tone } from '../lib/model';
import { cloudApi } from '../lib/cloudApi';

export function ClubsPage(){
  const a=useApp(),{navigate:nav}=useRouter();
  const [mode,setMode]=useState<'create'|'join'|null>(null),[name,setName]=useState(''),[code,setCode]=useState(''),[tone,setTone]=useState<Tone>('rose'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function create(){if(!name.trim())return;setBusy(true);try{const c:any=import.meta.env.VITE_BACKEND==='d1'?await cloudApi.createClub(name.trim()):await createClub(name.trim(),tone);const id=c.club?.id||c.id;await a.refresh();await a.selectClub(id);nav(`/clubs/${id}`)}catch(e:any){setError(e.message)}finally{setBusy(false)}}
  async function join(){setBusy(true);try{const c:any=import.meta.env.VITE_BACKEND==='d1'?await cloudApi.joinInvite(code):await joinClub(code);await a.refresh();await a.selectClub(c.clubId||c.id);nav(`/clubs/${c.clubId||c.id}`)}catch(e:any){setError(e.message)}finally{setBusy(false)}}
  return <div className="page clubs-page">
    <header className="page-title clubs-page-title"><h1>Your clubs</h1><button className="primary clubs-create-button" onClick={()=>setMode('create')}><Plus/> Start a club</button></header>
    <section className="club-index">{a.clubs.map(c=><button className={`club-index-row tone-${c.tone}`} key={c.id} onClick={()=>nav(`/clubs/${c.id}`)}><div className="club-color"/><div><h2>{c.name}</h2><p>{c.phase.replaceAll('_',' ')}</p></div><ArrowRight/></button>)}{!a.clubs.length&&<div className="clubs-empty-card"><div className="clubs-empty-mark"><BookOpen aria-hidden="true"/></div><p className="clubs-empty-kicker">A table for your next read</p><h2>No clubs yet.</h2><p>Start a private club for your favorite readers, or use an invite a friend sent you.</p><button className="secondary clubs-join-button" onClick={()=>setMode('join')}><UserRoundPlus/> Join with invite</button></div>}</section>
    {a.clubs.length>0&&<div className="two-actions"><button className="secondary" onClick={()=>setMode('join')}>Join with invite</button></div>}
    {mode&&<div className="modal-backdrop" onMouseDown={()=>setMode(null)}><section className="dialog" role="dialog" aria-modal="true" aria-label={mode==='create'?'Start a book club':'Join a club'} onMouseDown={e=>e.stopPropagation()}><button className="dialog-close" aria-label="Close" onClick={()=>setMode(null)}><span aria-hidden="true">×</span></button>{mode==='create'?<><h2>Start a book club</h2><label>Club name</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="College Friends"/><label>Accent</label><div className="palette-row">{(['rose','olive','gold','plum','blue','clay'] as Tone[]).map(t=><button aria-label={`${t} accent`} aria-pressed={tone===t} className={`swatch ${t} ${tone===t?'selected':''}`} onClick={()=>setTone(t)} key={t}/>)}</div><button className="primary full" disabled={busy||!name.trim()} onClick={create}>{busy?'Creating…':'Create club'}</button></>:<><h2>Join a club</h2><p>Paste the invite code or the end of the invite link.</p><label>Invite</label><input value={code} onChange={e=>setCode(e.target.value)} placeholder="ABC123"/><button className="primary full" disabled={busy||!code.trim()} onClick={join}>{busy?'Joining…':'Join club'}</button></>}{error&&<p className="error-text">{error}</p>}</section></div>}
  </div>;
}

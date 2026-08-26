import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Copy, ImagePlus, Link2, LogOut, RefreshCw, Trash2, UserMinus } from 'lucide-react';
import { createOrGetInvite, disableClubInvites, getClubInvites, leaveClub, removeClubMember, resetClubInvite, transferClubOwnership, updateClubCoverImage } from '../lib/data';
import { useApp } from '../lib/AppContext';
import { useRouter } from '../lib/router';

export function ClubSettingsPage({clubId}:{clubId:string}){
 const a=useApp(),{navigate}=useRouter(),w=a.workspace;const[invite,setInvite]=useState(''),[disabled,setDisabled]=useState(false),[busy,setBusy]=useState(''),[notice,setNotice]=useState(''),[coverDraft,setCoverDraft]=useState('');
 const me=w?.members.find(m=>m.id===a.user?.id);const isOwner=w?.club.ownerId===a.user?.id;const canManage=isOwner||me?.role==='admin'||me?.role==='owner';
 useEffect(()=>{if(!w||w.club.id!==clubId)return;Promise.all([createOrGetInvite(clubId),getClubInvites(clubId)]).then(([code,rows])=>{setInvite(code);setDisabled(!rows.some((x:any)=>!x.revoked_at))}).catch(()=>{})},[clubId,w?.club.id]);
 useEffect(()=>{setCoverDraft(w?.club.coverImageUrl||'')},[w?.club.coverImageUrl]);
 const url=invite?`${location.origin}/join/${invite}`:'';
 async function run(key:string,fn:()=>Promise<void>,msg:string){setBusy(key);setNotice('');try{await fn();setNotice(msg)}catch(e:any){setNotice(e?.message||'Could not complete that action.')}finally{setBusy('')}}
 async function setCover(file?:File){
  if(!file)return;
  const dataUrl=await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>typeof reader.result==='string'?resolve(reader.result):reject(new Error('Could not read that image.'));
    reader.onerror=()=>reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
  setCoverDraft(dataUrl);
 }
 const sorted=useMemo(()=>w?[...w.members].sort((x,y)=>x.id===w.club.ownerId?-1:y.id===w.club.ownerId?1:x.displayName.localeCompare(y.displayName)):[],[w]);
 if(!w||w.club.id!==clubId)return <div className="page"><div className="empty-state"><h2>Club settings unavailable.</h2></div></div>;
 return <div className="page club-settings-page"><button className="back-link" onClick={()=>navigate(`/clubs/${clubId}`)}><ArrowLeft/> {w.club.name}</button><header className="page-title"><div><h1>Club settings</h1></div></header>{notice&&<div className="save-notice" role="status">{notice}</div>}
  {canManage&&<section className="club-settings-section club-design-section"><header><div><h2>Club header</h2><p>Upload a custom header image, or switch back to the standard one.</p></div><ImagePlus/></header><div className="club-cover-editor"><div className="club-cover-preview">{coverDraft?<img src={coverDraft} alt={`${w.club.name} header preview`}/>:<div className={`club-cover-fallback tone-${w.club.tone}`}>Standard header</div>}</div><div className="club-cover-controls"><label className="club-cover-upload"><span>Header image</span><b>Choose image</b><input type="file" accept="image/*" onChange={e=>void setCover(e.target.files?.[0])}/></label><div className="club-cover-actions"><button className="primary" disabled={busy==='cover'} onClick={()=>run('cover',async()=>{await updateClubCoverImage(clubId,coverDraft||null);await a.refresh()},coverDraft?'Club header updated.':'Club header reset to the standard image.')}>{busy==='cover'?'Saving…':'Save header'}</button><button className="secondary" disabled={busy==='cover'||!coverDraft} onClick={()=>setCoverDraft('')}>Use standard image</button></div></div></div></section>}
  <section className="club-settings-section"><header><div><h2>Invite link</h2></div><Link2/></header>{disabled?<div className="invite-disabled"><b>Invites are off.</b>{canManage&&<button className="primary" onClick={()=>run('reset',async()=>{const code=await resetClubInvite(clubId);setInvite(code);setDisabled(false)},'New invite link created.')}>Create new link</button>}</div>:<div className="invite-control"><code>{url}</code><button onClick={async()=>{await navigator.clipboard.writeText(url);setNotice('Invite link copied.')}}><Copy/> Copy</button>{canManage&&<button disabled={!!busy} onClick={()=>run('reset',async()=>{const code=await resetClubInvite(clubId);setInvite(code)},'Old link disabled. New invite ready.')}><RefreshCw/> Reset</button>}{canManage&&<button className="text-danger" disabled={!!busy} onClick={()=>run('disable',async()=>{await disableClubInvites(clubId);setDisabled(true)},'Invite links disabled.')}><Trash2/> Disable</button>}</div>}</section>
  <section className="club-settings-section"><header><div><h2>Members</h2><p>{w.members.length} people can see this club.</p></div><img className="settings-brand-icon" src="/favicon.svg" alt="BOOK CLUB"/></header><div className="club-member-admin-list">{sorted.map(m=><article key={m.id}><button className="member-admin-person" onClick={()=>navigate(`/clubs/${clubId}/members/${m.id}`)}><span>{m.avatarUrl?<img src={m.avatarUrl} alt=""/>:m.displayName.slice(0,1)}</span><div><b>{m.displayName}{m.id===a.user?.id?' · you':''}</b><small>{m.id===w.club.ownerId?'Owner':m.role==='admin'?'Admin':'Member'}</small></div></button><div>{isOwner&&m.id!==a.user?.id&&<button onClick={()=>run(`transfer-${m.id}`,async()=>{await transferClubOwnership(clubId,m.id);await a.refresh()},`${m.displayName} is now the club owner.`)}>Make owner</button>}{canManage&&m.id!==a.user?.id&&m.id!==w.club.ownerId&&<button className="text-danger" onClick={()=>run(`remove-${m.id}`,async()=>{await removeClubMember(clubId,m.id);await a.refresh()},`${m.displayName} removed from the club.`)}><UserMinus/> Remove</button>}</div></article>)}</div></section>
  <section className="club-settings-section club-leave-section"><h2>Leave club</h2><button className="text-danger" disabled={isOwner||!!busy} onClick={()=>run('leave',async()=>{await leaveClub(clubId);await a.refresh();navigate('/clubs',true)},'You left the club.')}><LogOut/> {isOwner?'Transfer ownership before leaving':'Leave club'}</button></section>
 </div>
}

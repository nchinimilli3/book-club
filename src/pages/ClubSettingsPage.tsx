import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Copy, ImagePlus, Link2, LogOut, RefreshCw, Trash2, UserMinus } from 'lucide-react';
import { createOrGetInvite, disableClubInvites, getClubInvites, leaveClub, removeClubMember, resetClubInvite, saveClubCoverImage, transferClubOwnership } from '@book-club/data';
import { useApp } from '../lib/AppContext';
import { useRouter } from '../lib/router';
import { FeedbackMessage } from '../components/PageState';

export function ClubSettingsPage({clubId}:{clubId:string}){
 const a=useApp(),{navigate}=useRouter(),w=a.workspace;const[invite,setInvite]=useState(''),[disabled,setDisabled]=useState(false),[busy,setBusy]=useState(''),[notice,setNotice]=useState(''),[coverDraft,setCoverDraft]=useState(''),[coverBlob,setCoverBlob]=useState<Blob|null>(null),[coverDirty,setCoverDirty]=useState(false);
 const me=w?.members.find(m=>m.id===a.user?.id);const isOwner=w?.club.ownerId===a.user?.id;const canManage=isOwner||me?.role==='admin'||me?.role==='owner';
 useEffect(()=>{if(!w||w.club.id!==clubId)return;Promise.all([createOrGetInvite(clubId),getClubInvites(clubId)]).then(([code,rows])=>{setInvite(code);setDisabled(!rows.some((x:any)=>!x.revoked_at))}).catch(()=>{})},[clubId,w?.club.id]);
 useEffect(()=>{setCoverDraft(w?.club.coverImageUrl||'');setCoverBlob(null);setCoverDirty(false)},[w?.club.coverImageUrl]);
 const url=invite?`${location.origin}/join/${invite}`:'';
 async function run(key:string,fn:()=>Promise<void>,msg:string){setBusy(key);setNotice('');try{await fn();setNotice(msg)}catch(e:any){setNotice(e?.message||'Could not complete that action.')}finally{setBusy('')}}
 async function setCover(file?:File){
  if(!file)return;
  setNotice('');
  try{
   if(!file.type.startsWith('image/'))throw new Error('Choose an image file.');
   const source=URL.createObjectURL(file);
   try{
    const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('That image could not be opened.'));img.src=source});
    const maxWidth=1440,maxHeight=560,sourceRatio=image.naturalWidth/image.naturalHeight,targetRatio=maxWidth/maxHeight;
    const cropWidth=sourceRatio>targetRatio?Math.round(image.naturalHeight*targetRatio):image.naturalWidth;
    const cropHeight=sourceRatio>targetRatio?image.naturalHeight:Math.round(image.naturalWidth/targetRatio);
    const sx=Math.round((image.naturalWidth-cropWidth)/2),sy=Math.round((image.naturalHeight-cropHeight)/2);
    const canvas=document.createElement('canvas');canvas.width=maxWidth;canvas.height=maxHeight;
    const context=canvas.getContext('2d');if(!context)throw new Error('That image could not be prepared.');
    context.drawImage(image,sx,sy,cropWidth,cropHeight,0,0,maxWidth,maxHeight);
    let quality=.78,blob:Blob|undefined;
    while(quality>=.42){blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(x=>x?resolve(x):reject(new Error('That image could not be prepared.')),'image/webp',quality));if(blob.size<=350*1024)break;quality-=.08}
    if(!blob||blob.size>350*1024)throw new Error('Choose a simpler image; the optimized header must be under 350 KB.');
    setCoverDraft(URL.createObjectURL(blob));setCoverBlob(blob);setCoverDirty(true);
   }finally{URL.revokeObjectURL(source)}
  }catch(error:any){setNotice(error?.message||'Could not prepare that image.')}
 }
 const sorted=useMemo(()=>w?[...w.members].sort((x,y)=>x.id===w.club.ownerId?-1:y.id===w.club.ownerId?1:x.displayName.localeCompare(y.displayName)):[],[w]);
 if(!w||w.club.id!==clubId)return <div className="page"><div className="empty-state"><h2>Club settings unavailable.</h2></div></div>;
 return <div className="page club-settings-page"><button className="back-link" onClick={()=>navigate(`/clubs/${clubId}`)}><ArrowLeft/> {w.club.name}</button><header className="page-title"><div><h1>Club settings</h1></div></header>{notice&&<FeedbackMessage>{notice}</FeedbackMessage>}
  <section className="club-settings-section club-design-section"><header><div><h2>Club header</h2><p>Upload a custom header image, or switch back to the standard one.</p></div><ImagePlus/></header><div className="club-cover-editor"><div className="club-cover-preview">{coverDraft?<img src={coverDraft} alt={`${w.club.name} header preview`}/>:<div className={`club-cover-fallback tone-${w.club.tone}`}>Standard header</div>}</div><div className="club-cover-controls"><label className="club-cover-upload"><span>Header image</span><b>Choose image</b><input type="file" accept="image/*" onChange={e=>void setCover(e.target.files?.[0])}/></label><div className="club-cover-actions"><button className="primary" disabled={busy==='cover'||!coverDirty} onClick={()=>run('cover',async()=>{await saveClubCoverImage(clubId,coverBlob,w.club.coverImageUrl);await a.refresh()},coverBlob?'Club header updated.':'Club header reset to the standard image.')}>{busy==='cover'?'Saving…':'Save header'}</button><button className="secondary" disabled={busy==='cover'||!coverDraft} onClick={()=>{setCoverDraft('');setCoverBlob(null);setCoverDirty(true)}}>Use standard image</button></div></div></div></section>
  <section className="club-settings-section"><header><div><h2>Invite link</h2></div><Link2/></header>{disabled?<div className="invite-disabled"><b>Invites are off.</b>{canManage&&<button className="primary" onClick={()=>run('reset',async()=>{const code=await resetClubInvite(clubId);setInvite(code);setDisabled(false)},'New invite link created.')}>Create new link</button>}</div>:<div className="invite-control"><code>{url}</code><button onClick={async()=>{await navigator.clipboard.writeText(url);setNotice('Invite link copied.')}}><Copy/> Copy</button>{canManage&&<button disabled={!!busy} onClick={()=>run('reset',async()=>{const code=await resetClubInvite(clubId);setInvite(code)},'Old link disabled. New invite ready.')}><RefreshCw/> Reset</button>}{canManage&&<button className="text-danger" disabled={!!busy} onClick={()=>run('disable',async()=>{await disableClubInvites(clubId);setDisabled(true)},'Invite links disabled.')}><Trash2/> Disable</button>}</div>}</section>
  <section className="club-settings-section"><header><div><h2>Members</h2><p>{w.members.length} people can see this club.</p></div><img className="settings-brand-icon" src="/favicon.svg" alt="BOOK CLUB"/></header><div className="club-member-admin-list">{sorted.map(m=><article key={m.id}><button className="member-admin-person" onClick={()=>navigate(`/clubs/${clubId}/members/${m.id}`)}><span>{m.avatarUrl?<img src={m.avatarUrl} alt=""/>:m.displayName.slice(0,1)}</span><div><b>{m.displayName}{m.id===a.user?.id?' · you':''}</b><small>{m.id===w.club.ownerId?'Owner':m.role==='admin'?'Admin':'Member'}</small></div></button><div>{isOwner&&m.id!==a.user?.id&&<button onClick={()=>run(`transfer-${m.id}`,async()=>{await transferClubOwnership(clubId,m.id);await a.refresh()},`${m.displayName} is now the club owner.`)}>Make owner</button>}{canManage&&m.id!==a.user?.id&&m.id!==w.club.ownerId&&<button className="text-danger" onClick={()=>run(`remove-${m.id}`,async()=>{await removeClubMember(clubId,m.id);await a.refresh()},`${m.displayName} removed from the club.`)}><UserMinus/> Remove</button>}</div></article>)}</div></section>
  <section className="club-settings-section club-leave-section"><h2>Leave club</h2><button className="text-danger" disabled={isOwner||!!busy} onClick={()=>run('leave',async()=>{await leaveClub(clubId);await a.refresh();navigate('/clubs',true)},'You left the club.')}><LogOut/> {isOwner?'Transfer ownership before leaving':'Leave club'}</button></section>
 </div>
}

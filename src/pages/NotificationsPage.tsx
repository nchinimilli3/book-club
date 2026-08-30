import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Bell, CheckCheck } from 'lucide-react';
import { useApp } from '../lib/AppContext';
import { useRouter } from '../lib/router';
import { getNotifications, markAllNotificationsRead, markNotificationRead } from '@book-club/data';
import { supabase } from '@book-club/supabase';
import type { AppNotification } from '../lib/model';
import { SafeImage } from '../components/SafeImage';

function ago(iso:string){const ms=Date.now()-new Date(iso).getTime(),m=Math.max(1,Math.floor(ms/60000));if(m<60)return`${m}m`;const h=Math.floor(m/60);if(h<24)return`${h}h`;const d=Math.floor(h/24);return`${d}d`}

export function NotificationsPage(){
  const a=useApp(),{navigate}=useRouter();const[items,setItems]=useState<AppNotification[]>([]),[error,setError]=useState('');
  const load=useCallback(async()=>{if(!a.user)return;try{setItems(await getNotifications(a.user.id));setError('')}catch(e:any){setError(e?.message||'Could not load notifications')}},[a.user?.id]);
  useEffect(()=>{void load()},[load]);
  useEffect(()=>{if(!supabase||!a.user)return;const ch=supabase.channel(`notifications:${a.user.id}`).on('postgres_changes',{event:'*',schema:'public',table:'notifications',filter:`user_id=eq.${a.user.id}`},()=>void load()).subscribe();return()=>{void supabase?.removeChannel(ch)}},[a.user?.id,load]);
  async function open(n:AppNotification){if(!n.readAt){await markNotificationRead(n.id);setItems(x=>x.map(v=>v.id===n.id?{...v,readAt:new Date().toISOString()}:v))}if(n.deepLink)navigate(n.deepLink)}
  async function readAll(){if(!a.user)return;await markAllNotificationsRead(a.user.id);setItems(x=>x.map(v=>({...v,readAt:v.readAt||new Date().toISOString()})))}
  return <div className="page notifications-page">
    <button type="button" className="back-link" onClick={()=>navigate(a.activeClubId?`/clubs/${a.activeClubId}`:'/clubs')}><ArrowLeft/> Back</button>
    <header className="page-title notifications-title"><div><h1>Notifications</h1></div>{items.some(x=>!x.readAt)&&<button type="button" className="secondary" onClick={readAll}><CheckCheck/> Mark all read</button>}</header>
    {error&&<div className="error-text">{error}</div>}
    <section className="notification-list">{items.length?items.map(n=>{const club=a.clubs.find(c=>c.id===n.clubId);const isBook=Boolean(n.bookCoverUrl);return <button type="button" key={n.id} className={`notification-item ${n.readAt?'is-read':'is-unread'}${isBook?' has-book-cover':''}`} onClick={()=>void open(n)}><span className="notification-status" aria-hidden="true"/><span className={`notification-icon${isBook?' notification-book-cover':''}`}>{n.bookCoverUrl?<SafeImage src={n.bookCoverUrl} alt="" fallback={<Bell/>}/>:<Bell/>}</span><span className="notification-copy"><span className="notification-line"><b>{n.title}</b><time>{ago(n.createdAt)}</time></span>{club&&<span className="notification-club">{club.name}</span>}{n.body&&<span className="notification-body">{n.body}</span>}</span></button>}):<div className="empty-state notifications-empty-state"><Bell className="notifications-empty-icon" aria-hidden="true"/><div><h2>Nothing new.</h2><p>Votes, replies, and meeting changes will show up here.</p></div></div>}</section>
  </div>
}

import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, Download, KeyRound, Link2, LogOut, RefreshCw, Trash2, Unlink } from 'lucide-react';
import { useRouter } from '../lib/router';
import { useApp } from '../lib/AppContext';
import { supabase } from '../lib/supabase';
import { deleteMyAccount, getMyExportData, getNotificationMode, updateNotificationMode, updateProfileBasics } from '../lib/data';
import { Modal } from '../components/Modal';
import { beginCalendarConnect, disconnectCalendar, getApiHealth, getCalendarStatus, type CalendarStatus } from '../lib/api';

type Notice = { kind:'ok'|'error'; text:string } | null;

export function SettingsPage(){
  const a=useApp(),{navigate}=useRouter();
  const[name,setName]=useState(a.profile?.displayName||'');
  const[username,setUsername]=useState(a.profile?.username||'');
  const[notificationMode,setNotificationMode]=useState('essential');
  const[busy,setBusy]=useState<string|null>(null);
  const[notice,setNotice]=useState<Notice>(null);
  const[deleteOpen,setDeleteOpen]=useState(false);
  const[deleteText,setDeleteText]=useState('');
  const[calendar,setCalendar]=useState<CalendarStatus>({configured:false,connected:false});
  const[health,setHealth]=useState<any>(null);
  const[integrationBusy,setIntegrationBusy]=useState(false);

  useEffect(()=>{setName(a.profile?.displayName||'');setUsername(a.profile?.username||'')},[a.profile?.displayName,a.profile?.username]);
  useEffect(()=>{if(a.user)void getNotificationMode(a.user.id).then(setNotificationMode).catch(e=>setNotice({kind:'error',text:e.message}))},[a.user?.id]);
  async function loadIntegrations(){const [cal,h]=await Promise.all([getCalendarStatus(),getApiHealth()]);setCalendar(cal);setHealth(h)}
  useEffect(()=>{void loadIntegrations()},[]);

  async function run(key:string,fn:()=>Promise<void>,success:string){
    setBusy(key);setNotice(null);
    try{await fn();setNotice({kind:'ok',text:success})}catch(e:any){setNotice({kind:'error',text:e?.message||'Something went wrong.'})}finally{setBusy(null)}
  }

  async function saveProfile(){
    if(!a.user)return;
    const cleanName=name.trim(),cleanUser=username.trim().replace(/^@/,'');
    if(!cleanName){setNotice({kind:'error',text:'Add a display name.'});return}
    if(cleanUser&&!/^[a-zA-Z0-9._]{2,30}$/.test(cleanUser)){setNotice({kind:'error',text:'Username can use letters, numbers, periods, and underscores.'});return}
    await run('profile',async()=>{await updateProfileBasics(a.user!.id,cleanName,cleanUser);await a.refresh()},'Profile saved.');
  }

  async function saveNotifications(mode:string){
    if(!a.user)return;
    const previous=notificationMode;setNotificationMode(mode);
    try{await updateNotificationMode(a.user.id,mode);setNotice({kind:'ok',text:'Notification preference saved.'})}
    catch(e:any){setNotificationMode(previous);setNotice({kind:'error',text:e?.message||'Could not save notification preference.'})}
  }

  async function sendReset(){
    const sb=supabase;if(!sb||!a.user?.email)return;
    await run('password',async()=>{
      const r=await sb.auth.resetPasswordForEmail(a.user!.email!,{redirectTo:location.origin});
      if(r.error)throw r.error;
    },`Password reset sent to ${a.user.email}.`);
  }

  async function exportData(){
    if(!a.user)return;
    await run('export',async()=>{
      const data=await getMyExportData(a.user!.id);
      const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download=`book-club-data-${new Date().toISOString().slice(0,10)}.json`;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
    },'Your data export is ready.');
  }

  async function removeAccount(){
    if(deleteText!=='DELETE')return;
    await run('delete',async()=>{await deleteMyAccount()},'Account deleted.');
  }

  return <div className="page settings-page">
    <button type="button" className="back-link" onClick={()=>navigate('/me')}><ArrowLeft/> Profile</button>
    <header className="page-title settings-title"><div><h1>Settings</h1></div></header>

    {notice&&<div className={`settings-notice ${notice.kind}`} role="status">{notice.text}</div>}

    <section className="settings-section">
      <div className="settings-section-head"><h2>Profile</h2><span>Shown to people in your clubs</span></div>
      <div className="settings-fields">
        <label><span>Display name</span><input value={name} onChange={e=>setName(e.target.value)} autoComplete="name"/></label>
        <label><span>Username</span><div className="username-input"><i>@</i><input value={username} onChange={e=>setUsername(e.target.value)} autoCapitalize="none" spellCheck={false} placeholder="username"/></div></label>
        <label><span>Email</span><input value={a.user?.email||''} disabled/></label>
      </div>
      <button type="button" className="primary settings-save" disabled={busy==='profile'} onClick={saveProfile}>{busy==='profile'?'Saving…':'Save profile'}</button>
    </section>

    <section className="settings-section">
      <div className="settings-section-head"><h2>Notifications</h2><span>Choose how noisy BOOK CLUB should be</span></div>
      <div className="notification-options" role="radiogroup" aria-label="Notification preference">
        {[['essential','Essential','Votes, meeting changes, replies, and club actions'],['all','Everything','Essential updates plus reading and activity nudges'],['quiet','Quiet','Only direct replies and important meeting changes']].map(([value,title,desc])=><button type="button" role="radio" aria-checked={notificationMode===value} className={notificationMode===value?'selected':''} key={value} onClick={()=>void saveNotifications(value)}><b>{title}</b><span>{desc}</span></button>)}
      </div>
    </section>

    <section className="settings-section integrations-section">
      <div className="settings-section-head"><h2>Integrations</h2><span>Optional connections that reduce club admin</span></div>
      <div className="integration-row"><div className="integration-mark"><CalendarDays/></div><div className="integration-copy"><b>Google Calendar</b><span>{!calendar.configured?'Needs production credentials before it can connect.':calendar.connected?`Connected${calendar.email?` · ${calendar.email}`:''}`:'Connect once to add and update BOOK CLUB meetings automatically.'}</span></div>{calendar.connected?<button type="button" className="secondary" disabled={integrationBusy} onClick={async()=>{setIntegrationBusy(true);try{await disconnectCalendar();await loadIntegrations();setNotice({kind:'ok',text:'Google Calendar disconnected.'})}catch(e:any){setNotice({kind:'error',text:e?.message||'Could not disconnect Calendar.'})}finally{setIntegrationBusy(false)}}}><Unlink/> Disconnect</button>:<button type="button" className="primary" disabled={!calendar.configured||integrationBusy} onClick={async()=>{setIntegrationBusy(true);try{await beginCalendarConnect()}catch(e:any){setNotice({kind:'error',text:e?.message||'Could not connect Calendar.'});setIntegrationBusy(false)}}}><Link2/> Connect</button>}</div>
      <div className="service-health" aria-label="Integration status"><span className={health?.services?.openLibrary?'ok':''}>Book catalog</span><span className={health?.services?.ai?'ok':''}>Research AI</span><span className={health?.services?.calendarConfigured?'ok':''}>Calendar sync</span><button type="button" onClick={()=>void loadIntegrations()} aria-label="Refresh integration status"><RefreshCw/></button></div>
    </section>

    <section className="settings-section">
      <div className="settings-section-head"><h2>Account & data</h2></div>
      <div className="settings-action-list">
        <button type="button" onClick={sendReset} disabled={busy==='password'}><KeyRound/><span><b>Password</b><small>{busy==='password'?'Sending…':'Send a secure reset link'}</small></span></button>
        <button type="button" onClick={exportData} disabled={busy==='export'}><Download/><span><b>Export my data</b><small>{busy==='export'?'Preparing…':'Download your profile, library, posts, notes, ratings, and memberships'}</small></span></button>
        <button type="button" onClick={async()=>{await supabase?.auth.signOut()}}><LogOut/><span><b>Log out</b><small>Sign out on this device</small></span></button>
      </div>
    </section>

    <section className="settings-section settings-danger-zone">
      <div className="settings-section-head"><h2>Delete account</h2></div>
      <p>Deleting your account removes your personal data. If you own a club with other members, ownership transfers to another member so their club history is not lost.</p>
      <button type="button" className="text-danger" onClick={()=>{setDeleteText('');setDeleteOpen(true)}}><Trash2/> Delete my account</button>
    </section>

    <Modal open={deleteOpen} onClose={()=>setDeleteOpen(false)} title="Delete your account?">
      <div className="delete-account-confirm"><p>This cannot be undone. Type <b>DELETE</b> to confirm.</p><input value={deleteText} onChange={e=>setDeleteText(e.target.value)} placeholder="DELETE" autoCapitalize="characters"/><div className="modal-actions"><button type="button" className="secondary" onClick={()=>setDeleteOpen(false)}>Cancel</button><button type="button" className="danger-button" disabled={deleteText!=='DELETE'||busy==='delete'} onClick={removeAccount}>{busy==='delete'?'Deleting…':'Delete account'}</button></div></div>
    </Modal>
  </div>
}

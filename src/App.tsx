import { useEffect, useState } from 'react';
import { Bell, BookOpen, ChevronDown, Search } from 'lucide-react';
import { AppProvider, useApp } from './lib/AppContext';
import { RouterProvider, match, useRouter } from './lib/router';
import { ClubsPage } from './pages/ClubsPage';
import { HomePage } from './pages/HomePage';
import { ReadingRoom } from './pages/ReadingRoom';
import { SearchPage } from './pages/SearchPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';
import { JoinInvitePage } from './pages/JoinInvitePage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ArchivePage } from './pages/ArchivePage';
import { MeetingModePage } from './pages/MeetingModePage';
import { MemberProfilePage } from './pages/MemberProfilePage';
import { ClubSettingsPage } from './pages/ClubSettingsPage';
import { markAllNotificationsRead } from './lib/data';
import { QuickPassageCapture } from './components/QuickPassageCapture';

function RootRedirect(){
  const a=useApp(),{navigate}=useRouter();
  useEffect(()=>{navigate(a.activeClubId?`/clubs/${a.activeClubId}`:'/clubs',true)},[a.activeClubId,navigate]);
  return <div className="boot"><span>Opening BOOK CLUB…</span></div>;
}

function ClubRoute({clubId}:{clubId:string}){
  const a=useApp();
  useEffect(()=>{if(a.activeClubId!==clubId)void a.selectClub(clubId).catch(()=>{})},[clubId,a.activeClubId,a.selectClub]);
  if(a.activeClubId!==clubId||a.workspace?.club.id!==clubId)return <div className="boot"><span>Opening club…</span></div>;
  return <HomePage/>;
}

function BookRoute({clubId,clubBookId}:{clubId:string;clubBookId:string}){
  const a=useApp();
  useEffect(()=>{if(a.activeClubId!==clubId)void a.selectClub(clubId).catch(()=>{})},[clubId,a.activeClubId,a.selectClub]);
  if(a.activeClubId!==clubId||a.workspace?.club.id!==clubId)return <div className="boot"><span>Opening reading room…</span></div>;
  return <ReadingRoom clubId={clubId} clubBookId={clubBookId}/>;
}

function UnknownRoute(){
  const{navigate}=useRouter();
  useEffect(()=>navigate('/',true),[navigate]);
  return null;
}

function Shell(){
  const a=useApp(),{path,navigate}=useRouter();
  const[clubMenuOpen,setClubMenuOpen]=useState(false);
  const[notificationMenuOpen,setNotificationMenuOpen]=useState(false);
  const[clearingNotifications,setClearingNotifications]=useState(false);
  if(a.loading)return <div className="boot boot-loading"><b>BOOK CLUB</b><span>Opening your clubs…</span><div className="boot-progress" aria-hidden="true"><i/><i/><i/></div></div>;
  if(a.error)return <div className="boot"><b>Something went wrong.</b><span>{a.error}</span><button onClick={a.refresh}>Try again</button></div>;

  let page:React.ReactNode;
  const invite=match(path,'/join/:code');
  const meetingMode=match(path,'/clubs/:clubId/books/:clubBookId/meeting');
  const member=match(path,'/clubs/:clubId/members/:memberId');
  const clubSettings=match(path,'/clubs/:clubId/settings');
  const book=match(path,'/clubs/:clubId/books/:clubBookId');
  const archive=match(path,'/clubs/:clubId/archive');
  const club=match(path,'/clubs/:clubId');

  if(path==='/')page=<RootRedirect/>;
  else if(invite)page=<JoinInvitePage code={invite.code}/>;
  else if(path==='/clubs')page=<ClubsPage/>;
  else if(meetingMode)page=<MeetingModePage clubId={meetingMode.clubId} clubBookId={meetingMode.clubBookId}/>;
  else if(member)page=<MemberProfilePage clubId={member.clubId} memberId={member.memberId}/>;
  else if(clubSettings)page=<ClubSettingsPage clubId={clubSettings.clubId}/>;
  else if(book)page=<BookRoute clubId={book.clubId} clubBookId={book.clubBookId}/>;
  else if(archive)page=<ArchivePage clubId={archive.clubId}/>;
  else if(club)page=<ClubRoute clubId={club.clubId}/>;
  else if(path==='/search')page=<SearchPage/>;
  else if(path==='/notifications')page=<NotificationsPage/>;
  else if(path==='/me/settings')page=<SettingsPage/>;
  else if(path==='/me')page=<ProfilePage/>;
  else page=<UnknownRoute/>;

  const currentPath=a.activeClubId?`/clubs/${a.activeClubId}`:'/clubs';
  async function clearNotifications(){
    if(!a.user||!a.unreadNotifications)return;
    setClearingNotifications(true);
    try{await markAllNotificationsRead(a.user.id);await a.refresh();setNotificationMenuOpen(false)}finally{setClearingNotifications(false)}
  }
  return <div className="app">
    <header className="global-header">
      <button className="brand" onClick={()=>navigate(currentPath)}>BOOK CLUB</button>
      <div className="club-switcher-wrap">
        <button className="header-club-switcher" onClick={()=>setClubMenuOpen(v=>!v)} aria-expanded={clubMenuOpen}>
          <span>{a.workspace?.club?.name||'Your clubs'}</span><ChevronDown/>
        </button>
        {clubMenuOpen&&<div className="club-switcher-menu" role="menu">
          <div className="club-switcher-label">Your clubs</div>
          {a.clubs.map(c=><button key={c.id} className={c.id===a.activeClubId?'active':''} onClick={()=>{setClubMenuOpen(false);navigate(`/clubs/${c.id}`)}}><span className={`club-switcher-dot tone-${c.tone}`}/><span>{c.name}</span>{c.id===a.activeClubId&&<small>Current</small>}</button>)}
          <button className="club-switcher-all" onClick={()=>{setClubMenuOpen(false);navigate('/clubs')}}>Manage clubs</button>
        </div>}
      </div>
      <nav className="desktop-nav" aria-label="Primary">
        <button className="current-nav" onClick={()=>navigate(currentPath)}><BookOpen/><span>Club</span></button>
        <button onClick={()=>navigate('/search')}>Find</button>
      </nav>
      <div className="global-actions">
        <div className="notification-menu-wrap">
          <button className="icon-button notification-button" onClick={()=>setNotificationMenuOpen(v=>!v)} aria-expanded={notificationMenuOpen} aria-label={`Notifications${a.unreadNotifications?` · ${a.unreadNotifications} unread`:''}`}><Bell/>{a.unreadNotifications>0&&<span className="notification-badge">{a.unreadNotifications>9?'9+':a.unreadNotifications}</span>}</button>
          {notificationMenuOpen&&<div className="notification-quick-menu" role="menu"><div><b>{a.unreadNotifications?`${a.unreadNotifications} unread`:'You’re caught up'}</b><span>Notifications</span></div><button type="button" onClick={()=>{setNotificationMenuOpen(false);navigate('/notifications')}}>View notifications</button>{a.unreadNotifications>0&&<button type="button" className="mark-all-quick" disabled={clearingNotifications} onClick={()=>void clearNotifications()}>{clearingNotifications?'Marking…':'Mark all as read'}</button>}</div>}
        </div>
        <button className="profile-chip" onClick={()=>navigate('/me')} aria-label="Open my profile"><span>{a.profile?.displayName?.slice(0,1)||'R'}</span></button>
      </div>
    </header>
    {a.offline&&<div className="offline-banner">Offline · showing your last saved club.</div>}
    <main>{page}</main>
    <QuickPassageCapture/>
    <nav className="mobile-nav" aria-label="Primary">
      <button onClick={()=>navigate(currentPath)}><BookOpen/><span>Club</span></button>
      <button onClick={()=>navigate('/search')}><Search/><span>Find</span></button>
      <button onClick={()=>navigate('/me')}><span className="nav-avatar">{a.profile?.displayName?.slice(0,1)||'R'}</span><span>Me</span></button>
    </nav>
  </div>;
}

export default function App(){return <RouterProvider><AppProvider><Shell/></AppProvider></RouterProvider>}

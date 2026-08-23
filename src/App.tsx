import { useEffect } from 'react';
import { Bell, BookOpen, Search, Users } from 'lucide-react';
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
  if(a.loading)return <div className="boot boot-loading"><b>BOOK CLUB</b><span>Opening your clubs…</span><div className="boot-progress" aria-hidden="true"><i/><i/><i/></div></div>;
  if(a.error)return <div className="boot"><b>Something went wrong.</b><span>{a.error}</span><button onClick={a.refresh}>Try again</button></div>;

  let page:React.ReactNode;
  const invite=match(path,'/join/:code');
  const book=match(path,'/clubs/:clubId/books/:clubBookId');
  const archive=match(path,'/clubs/:clubId/archive');
  const club=match(path,'/clubs/:clubId');

  if(path==='/')page=<RootRedirect/>;
  else if(invite)page=<JoinInvitePage code={invite.code}/>;
  else if(path==='/clubs')page=<ClubsPage/>;
  else if(book)page=<BookRoute clubId={book.clubId} clubBookId={book.clubBookId}/>;
  else if(archive)page=<ArchivePage clubId={archive.clubId}/>;
  else if(club)page=<ClubRoute clubId={club.clubId}/>;
  else if(path==='/search')page=<SearchPage/>;
  else if(path==='/notifications')page=<NotificationsPage/>;
  else if(path==='/me/settings')page=<SettingsPage/>;
  else if(path==='/me')page=<ProfilePage/>;
  else page=<UnknownRoute/>;

  const currentLabel=a.workspace?.currentBook?.book.title||a.workspace?.club.name||'Current';
  const currentPath=a.activeClubId?`/clubs/${a.activeClubId}`:'/clubs';
  return <div className="app">
    <header className="global-header">
      <button className="brand" onClick={()=>navigate(currentPath)}>BOOK CLUB</button>
      <nav className="desktop-nav">
        <button className="current-nav" onClick={()=>navigate(currentPath)}><BookOpen/><span>{currentLabel}</span></button>
        <button onClick={()=>navigate('/clubs')}>Clubs</button>
        <button onClick={()=>navigate('/search')}>Search</button>
        <button onClick={()=>navigate('/me')}>Me</button>
      </nav>
      <div className="global-actions">
        <button className="icon-button" onClick={()=>navigate('/search')} aria-label="Search"><Search/></button>
        <button className="icon-button notification-button" onClick={()=>navigate('/notifications')} aria-label={`Notifications${a.unreadNotifications?` · ${a.unreadNotifications} unread`:''}`}><Bell/>{a.unreadNotifications>0&&<span className="notification-badge">{a.unreadNotifications>9?'9+':a.unreadNotifications}</span>}</button>
        <button className="profile-chip" onClick={()=>navigate('/me')}><span>{a.profile?.displayName?.slice(0,1)||'R'}</span><b>{a.profile?.displayName||'Reader'}</b></button>
      </div>
    </header>
    <main>{page}</main>
    <nav className="mobile-nav">
      <button onClick={()=>navigate(currentPath)}><BookOpen/><span>Current</span></button>
      <button onClick={()=>navigate('/clubs')}><Users/><span>Clubs</span></button>
      <button onClick={()=>navigate('/search')}><Search/><span>Search</span></button>
      <button onClick={()=>navigate('/me')}><span className="nav-avatar">{a.profile?.displayName?.slice(0,1)||'R'}</span><span>Me</span></button>
    </nav>
  </div>;
}

export default function App(){return <RouterProvider><AppProvider><Shell/></AppProvider></RouterProvider>}

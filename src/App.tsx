import { lazy, Suspense, useEffect, useState } from 'react';
import { AppProvider, useApp } from './lib/AppContext';
import { RouterProvider, match, useRouter } from './lib/router';
import { HomePage } from './pages/HomePage';
import { markAllNotificationsRead } from '@book-club/data';
import { BootScreen } from './components/BootScreen';
import { cloudApi } from './lib/cloudApi';
import { AppHeader, TabBar } from './components/AppNav';
import { WelcomeIntro, shouldPlayIntro } from './components/WelcomeIntro';

const ClubsPage = lazy(() => import('./pages/ClubsPage').then(module => ({ default: module.ClubsPage })));
const ReadingRoom = lazy(() => import('./pages/ReadingRoom').then(module => ({ default: module.ReadingRoom })));
const SearchPage = lazy(() => import('./pages/SearchPage').then(module => ({ default: module.SearchPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then(module => ({ default: module.ProfilePage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(module => ({ default: module.SettingsPage })));
const JoinInvitePage = lazy(() => import('./pages/JoinInvitePage').then(module => ({ default: module.JoinInvitePage })));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage').then(module => ({ default: module.NotificationsPage })));
const ArchivePage = lazy(() => import('./pages/ArchivePage').then(module => ({ default: module.ArchivePage })));
const MeetingModePage = lazy(() => import('./pages/MeetingModePage').then(module => ({ default: module.MeetingModePage })));
const MemberProfilePage = lazy(() => import('./pages/MemberProfilePage').then(module => ({ default: module.MemberProfilePage })));
const ClubSettingsPage = lazy(() => import('./pages/ClubSettingsPage').then(module => ({ default: module.ClubSettingsPage })));
const QuickPassageCapture = lazy(() => import('./components/QuickPassageCapture').then(module => ({ default: module.QuickPassageCapture })));

function RootRedirect(){
  const a=useApp(),{navigate}=useRouter();
  useEffect(()=>{navigate(a.activeClubId?`/clubs/${a.activeClubId}`:'/clubs',true)},[a.activeClubId,navigate]);
  return <BootScreen message="Opening your clubs…"/>;
}

function ClubRoute({clubId}:{clubId:string}){
  const a=useApp();
  useEffect(()=>{if(a.activeClubId!==clubId)void a.selectClub(clubId).catch(()=>{})},[clubId,a.activeClubId,a.selectClub]);
  if(a.activeClubId!==clubId||a.workspace?.club.id!==clubId)return <BootScreen message="Opening your clubs…"/>;
  return <HomePage/>;
}

function BookRoute({clubId,clubBookId}:{clubId:string;clubBookId:string}){
  const a=useApp();
  useEffect(()=>{if(a.activeClubId!==clubId)void a.selectClub(clubId).catch(()=>{})},[clubId,a.activeClubId,a.selectClub]);
  if(a.activeClubId!==clubId||a.workspace?.club.id!==clubId)return <BootScreen message="Opening your clubs…"/>;
  return <ReadingRoom clubId={clubId} clubBookId={clubBookId}/>;
}

function UnknownRoute(){
  const{navigate}=useRouter();
  useEffect(()=>navigate('/',true),[navigate]);
  return null;
}

function Shell(){
  const a=useApp(),{path}=useRouter();
  const[introDone,setIntroDone]=useState(false);
  const introUserId=(a.user as {id?:string}|null)?.id;
  const[playIntro,setPlayIntro]=useState(false);
  useEffect(()=>{if(!a.loading&&introUserId)setPlayIntro(shouldPlayIntro(introUserId))},[a.loading,introUserId]);
  if(a.loading)return <BootScreen message="Opening your clubs…" fullViewport/>;
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

  async function clearNotifications(){
    if(!a.user||!a.unreadNotifications)return;
    if(import.meta.env.VITE_BACKEND==='d1')await cloudApi.markAllNotificationsRead();else await markAllNotificationsRead(a.user.id);
    await a.refresh();
  }
  return <div className="app">
    <AppHeader onMarkAllRead={clearNotifications}/>
    <main><Suspense fallback={<BootScreen message="Opening your clubs…"/>}>{page}</Suspense></main>
    <Suspense fallback={null}><QuickPassageCapture/></Suspense>
    {playIntro&&!introDone&&introUserId&&<WelcomeIntro userId={introUserId} name={a.profile?.displayName||''} onDone={()=>setIntroDone(true)}/>}
    <TabBar/>
  </div>;
}

function MaintenanceScreen(){return <div className="boot"><b>BOOK CLUB is briefly offline.</b><span>We’re reducing background traffic and will be back shortly.</span></div>}

export default function App(){
  if(import.meta.env.VITE_MAINTENANCE_MODE==='true')return <MaintenanceScreen/>;
  return <RouterProvider><AppProvider><Shell/></AppProvider></RouterProvider>
}

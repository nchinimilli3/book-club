import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@book-club/supabase';
import { getMyClubs, getProfile, getWorkspace, getUnreadNotificationCount, setActiveClub as persist, setMyTimezone } from '@book-club/data';
import type { Club, Profile, Workspace, ProfileStyle } from './model';
import { readProfileStyleCache } from './profileStyleCache';
import { captureClientError } from './telemetry';
import { cloudApi, cloudAssetUrl } from './cloudApi';

const cloudBackend = import.meta.env.VITE_BACKEND === 'd1';
type User = { id: string; email?: string; user_metadata?: { display_name?: string } };

function cloudWorkspace(raw:any, club:Club):Workspace {
  const book=(row:any)=>({id:String(row.id),title:String(row.title||'Untitled'),author:String(row.author||'Unknown author'),coverUrl:row.cover_url||undefined,description:row.description||undefined,pages:Number(row.pages)||undefined,year:Number(row.published_year)||undefined,isbn:row.isbn||undefined,subjects:Array.isArray(row.subjects)?row.subjects:[]});
  const clubBook=(row:any)=>({id:String(row.id),clubId:club.id,book:book(row),status:String(row.status||'suggested'),startDate:row.start_date||undefined,targetFinishDate:row.target_finish_date||undefined,totalChapters:Number(row.total_chapters)||undefined,totalPages:Number(row.total_pages)||undefined});
  const current=raw.currentBook?clubBook(raw.currentBook):undefined;
  const savedMeetingPostIds = new Set((raw.meetingQuestions || []).map((question:any) => String(question.post_id || '')).filter(Boolean));
  const phase = current
    ? current.status === 'completed' ? 'rating' : 'reading'
    : (raw.books || []).some((item:any) => item.status === 'ballot') ? 'choosing' : 'setup';
  return {
    club:{...club,ownerId:String(raw.club?.created_by||club.ownerId),phase,coverImageUrl:raw.club?.cover_key||club.coverImageUrl,memberCount:Array.isArray(raw.members)?raw.members.length:club.memberCount},
    members:(raw.members||[]).map((member:any)=>({id:String(member.user_id),displayName:String(member.name||'Reader'),username:member.username||undefined,avatarUrl:cloudAssetUrl(member.image||member.style?.avatarUrl),style:member.style||undefined,role:String(member.role||'member'),chapter:Number(member.chapter)||undefined,page:Number(member.page)||undefined,percent:typeof member.percent==='number'?member.percent:undefined,status:member.status||(member.format?'acquired':undefined),format:member.format||undefined})),
    currentBook:current,
    ideaBooks:(raw.books||[]).filter((item:any)=>item.status==='suggested'||item.status==='ballot').map(clubBook),
    meeting:(raw.meetings||[]).find((item:any)=>item.book_id===current?.id)?.id?(()=>{const item=(raw.meetings||[]).find((entry:any)=>entry.book_id===current?.id);return {id:String(item.id),startsAt:new Date(Number(item.starts_at)).toISOString(),checkpointId:item.checkpoint_id||undefined,meetingType:item.meeting_type||undefined,meetingUrl:item.meeting_url||undefined,response:item.my_rsvp==='yes'?'going':item.my_rsvp==='no'?'cant':item.my_rsvp||undefined,status:item.status||undefined}})():undefined,
    meetingOptions:(raw.meetingOptions||[]).map((option:any)=>({id:String(option.id),checkpointId:option.checkpoint_id||undefined,startsAt:new Date(Number(option.starts_at)).toISOString(),availableCount:Number(option.available_count)||0,myAvailable:Boolean(option.my_available)})),
    thoughts:(raw.thoughts||[]).map((thought:any)=>({id:String(thought.id),userId:String(thought.author_id),body:String(thought.body),type:String(thought.post_type||'thought'),chapter:Number(thought.chapter)||undefined,createdAt:new Date(Number(thought.created_at)).toISOString(),author:{id:String(thought.author_id),displayName:String(thought.name||'Reader'),avatarUrl:cloudAssetUrl(thought.image)},reactions:(raw.reactions||[]).filter((reaction:any)=>reaction.post_id===thought.id).map((reaction:any)=>({postId:String(reaction.post_id),userId:String(reaction.user_id),reaction:String(reaction.emoji),createdAt:new Date(Number(reaction.created_at)).toISOString()})),replyItems:(raw.replies||[]).filter((reply:any)=>reply.post_id===thought.id).map((reply:any)=>({id:String(reply.id),postId:String(reply.post_id),userId:String(reply.author_id),body:String(reply.body),createdAt:new Date(Number(reply.created_at)).toISOString(),author:{id:String(reply.author_id),displayName:String(reply.name||'Reader'),avatarUrl:cloudAssetUrl(reply.image)}})),savedForMeeting:savedMeetingPostIds.has(String(thought.id)),predictionRevealed:Boolean(thought.revealed_at)})),
    checkpoints:(raw.checkpoints||[]).filter((checkpoint:any)=>!current||checkpoint.book_id===current.id).map((checkpoint:any)=>({id:String(checkpoint.id),dueAt:String(checkpoint.due_at),targetChapter:Number(checkpoint.target_chapter)||undefined,targetPage:Number(checkpoint.target_page)||undefined,label:checkpoint.label||undefined})),
    checkpointCheckins:(raw.checkpointCheckins||[]).map((checkin:any)=>({checkpointId:String(checkin.checkpoint_id),userId:String(checkin.user_id),status:checkin.status,updatedAt:new Date(Number(checkin.updated_at)).toISOString()})),
    acquired:Number(raw.acquired)||0,myProgress:raw.myProgress?{chapter:Number(raw.myProgress.chapter)||undefined,page:Number(raw.myProgress.page)||undefined,percent:typeof raw.myProgress.percent==='number'?raw.myProgress.percent:undefined,status:raw.myProgress.status||undefined,format:raw.myProgress.format||undefined}:undefined,
    archiveBooks:(raw.archiveBooks||[]).map(book),archiveBookCount:Number(raw.archiveBookCount)||0,myClubRating:raw.myClubRating?{rating:Number(raw.myClubRating.rating),review:raw.myClubRating.review||undefined,recommend:raw.myClubRating.recommend===null?undefined:Boolean(raw.myClubRating.recommend)}:undefined,
    lockedPostCount:Number(raw.lockedPostCount)||0,meetingQuestions:(raw.meetingQuestions||[]).map((question:any)=>({id:String(question.id),postId:question.post_id||undefined,body:String(question.body),createdAt:new Date(Number(question.created_at)).toISOString(),addedBy:{id:String(question.user_id),displayName:String(question.name||'Reader')}})),contextConfigured:raw.contextConfigured!==false,
  };
}

const headerUrlCache = new Map<string, { url: string; expiresAt: number }>();
async function hydrateCloudWorkspace(raw: any, club: Club): Promise<Workspace> {
  const workspace = cloudWorkspace(raw, club); const key = raw?.club?.cover_key;
  if (!key) return workspace;
  const cached = headerUrlCache.get(String(key));
  if (cached && cached.expiresAt > Date.now() + 60_000) { workspace.club.coverImageUrl = cached.url; return workspace; }
  try {
    const result = await cloudApi.headerUrl(club.id); const url = cloudAssetUrl(result.url);
    if (!url) throw new Error('Club header URL was empty.');
    headerUrlCache.set(String(key), { url, expiresAt: Date.now() + 14 * 60_000 }); workspace.club.coverImageUrl = url;
  } catch { workspace.club.coverImageUrl = undefined; }
  return workspace;
}

type Ctx = {
  user: User | null;
  profile: Profile | null;
  clubs: Club[];
  activeClubId?: string;
  workspace: Workspace | null;
  loading: boolean;
  refreshing: boolean;
  unreadNotifications: number;
  error?: string;
  offline: boolean;
  refresh: () => Promise<void>;
  selectClub: (id: string) => Promise<void>;
  applyProfileStyle: (style: ProfileStyle) => void;
};

const C = createContext<Ctx | null>(null);

function withTimeout<T>(promise: Promise<T>, ms = 30000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      window.setTimeout(() => reject(new Error('BOOK CLUB took too long to load. Check your connection and try again.')), ms)
    ),
  ]);
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [activeClubId, setId] = useState<string>();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadNotifications,setUnreadNotifications]=useState(0);
  const [error, setError] = useState<string>();
  const [offline,setOffline]=useState(false);
  const activeRef = useRef<string | undefined>(undefined);
  const bootedRef = useRef(false);
  const timezoneSentRef = useRef<string | undefined>(undefined);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => { activeRef.current = activeClubId; }, [activeClubId]);

  const refresh = useCallback(async () => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const task = (async () => {
    if (cloudBackend) {
      const firstLoad = !bootedRef.current;
      if (firstLoad) setLoading(true); else setRefreshing(true);
      try {
        const account = await withTimeout(cloudApi.session(), 10000);
        const u = account.user;
        setUser(u as any);
        if (!u) { setProfile(null); setClubs([]); setId(undefined); setWorkspace(null); setError(undefined); return; }
        const [result, settingsResult, notificationsResult] = await withTimeout(Promise.all([cloudApi.clubs(), cloudApi.settings(), cloudApi.notifications()]), 20000) as any;
        const mapped = result.clubs.map((club: any, index: number) => ({ id: club.id, name: club.name, ownerId: '', tone: (['rose','olive','gold','plum','blue','clay'] as const)[index % 6], phase: 'setup' as const, coverImageUrl: club.cover_key || undefined, memberCount: 1 }));
        const settings = settingsResult.settings || {};
        const freshProfile = { id: u.id, displayName: settingsResult.user?.name || u.name, username: settings.username || undefined, avatarUrl: cloudAssetUrl(settingsResult.user?.image || settings.style?.avatarUrl), style: settings.style || undefined };
        const cachedStyle = readProfileStyleCache(u.id);
        setProfile(cachedStyle?.pending ? { ...freshProfile, style: cachedStyle.style } : freshProfile);
        setUnreadNotifications((notificationsResult.notifications || []).filter((item:any) => !item.read_at).length);
        setClubs(mapped);
        const id = activeRef.current && mapped.some((club: any) => club.id === activeRef.current) ? activeRef.current : mapped[0]?.id;
        setId(id);
        const summary = id ? await withTimeout(cloudApi.workspace(id), 20000) as any : null;
        const selected = mapped.find((club: any) => club.id === id);
        setWorkspace(summary && selected ? await hydrateCloudWorkspace(summary, selected) : null);
        setError(undefined); setOffline(false);
      } catch (e: any) { setError(e?.message || 'Could not load BOOK CLUB'); }
      finally { bootedRef.current = true; setLoading(false); setRefreshing(false); }
      return;
    }
    if (!supabase) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }

    const firstLoad = !bootedRef.current;
    if (firstLoad) setLoading(true);
    else setRefreshing(true);

    let authenticatedUser: User | null = null;
    try {
      const legacySession = await withTimeout<{ data: { session: { user: User } | null }; error?: Error | null }>(supabase.auth.getSession(), 10000);
      const { data: { session }, error: sessionError } = legacySession;
      if (sessionError) throw sessionError;
      const u = session?.user ?? null;
      authenticatedUser=u;
      setUser(u);
      if(u){try{const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone;if(timezone&&timezoneSentRef.current!==`${u.id}:${timezone}`){timezoneSentRef.current=`${u.id}:${timezone}`;void setMyTimezone(timezone).catch(()=>undefined)}}catch{}}

      if (!u) {
        setProfile(null);
        setClubs([]);
        setId(undefined);
        setWorkspace(null);
        setError(undefined);
        setOffline(false);
        return;
      }

      const [p, c, unread] = await withTimeout(Promise.all([getProfile(u.id), getMyClubs(u.id), getUnreadNotificationCount(u.id)]), 30000);
      setUnreadNotifications(unread);
      // A locally saved sticker draft is authoritative while cloud sync is pending.
      // This prevents an unrelated workspace refresh from snapping the profile back
      // to the last server version immediately after the user taps Done.
      const cachedStyle = readProfileStyleCache(u.id);
      const effectiveProfile = cachedStyle?.pending
        ? { ...p, style: cachedStyle.style }
        : p;
      setProfile(effectiveProfile);
      setClubs(c.clubs);

      const remembered = activeRef.current;
      const id = remembered && c.clubs.some(x => x.id === remembered)
        ? remembered
        : c.activeClubId || c.clubs[0]?.id;

      setId(id);
      const nextWorkspace=id ? await withTimeout(getWorkspace(id, u.id), 30000) : null;
      // getMyClubs is also the dev fallback that guarantees a useful Race/Sailing mix
      // before migration 011 is applied. Keep the active workspace on that same assignment.
      if(nextWorkspace&&id){
        const assignedScene=c.clubs.find(club=>club.id===id)?.progressScene;
        if(assignedScene)nextWorkspace.club.progressScene=assignedScene;
      }
      setWorkspace(nextWorkspace);
      try{localStorage.setItem('bookclub:workspace-cache',JSON.stringify({userId:u.id,profile:effectiveProfile,clubs:c.clubs,activeClubId:id,workspace:nextWorkspace,unread}))}catch{}
      setError(undefined);
      setOffline(false);
    } catch (e: any) {
      console.error('BOOK CLUB refresh failed', e);
      void captureClientError(e,{area:'app-refresh'});
      let recovered=false;
      if(authenticatedUser){
        try{
          const cached=JSON.parse(localStorage.getItem('bookclub:workspace-cache')||'null');
          if(cached?.userId===authenticatedUser.id){
            setProfile(cached.profile||null);setClubs(cached.clubs||[]);setId(cached.activeClubId);setWorkspace(cached.workspace||null);setUnreadNotifications(cached.unread||0);
            setError(undefined);setOffline(true);recovered=true;
          }
        }catch{}
      }
      if(!recovered)setError(e?.message || 'Could not load BOOK CLUB');
    } finally {
      bootedRef.current = true;
      setLoading(false);
      setRefreshing(false);
    }
    })();
    refreshPromiseRef.current = task;
    try { await task; } finally { refreshPromiseRef.current = null; }
  }, []);

  const applyProfileStyle = useCallback((style: ProfileStyle) => {
    setProfile(current => current ? { ...current, style } : current);
  }, []);

  const selectClub = useCallback(async (id: string) => {
    setError(undefined);
    setId(id);
    activeRef.current = id;
    try {
      if (cloudBackend) {
        const summary = await withTimeout(cloudApi.workspace(id), 20000) as any;
        const club = clubs.find(item => item.id === id);
        if (club) setWorkspace(await hydrateCloudWorkspace(summary, club));
        return;
      }
      await withTimeout(persist(id), 15000);
      if (user) {
        const nextWorkspace=await withTimeout(getWorkspace(id, user.id), 30000);
        const assignedScene=clubs.find(club=>club.id===id)?.progressScene;
        if(assignedScene)nextWorkspace.club.progressScene=assignedScene;
        setWorkspace(nextWorkspace);
      }
    } catch (e: any) {
      setError(e?.message || 'Could not open that club');
      throw e;
    }
  }, [user,clubs]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (cloudBackend) return;
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: string, session: { user?: User } | null) => {
      setUser(session?.user ?? null);
      if (session?.user) void refresh();
    });
    return () => subscription.unsubscribe();
  }, [refresh]);

  useEffect(() => {
    if (cloudBackend) return;
    const sb = supabase;
    const activeBookId=workspace?.currentBook?.id;
    if (!sb || !activeClubId || !user?.id) return;
    let refreshTimer: number | undefined;
    const scheduleRefresh = () => {
      // Background tabs reconcile on focus instead of consuming egress for
      // every realtime event while the reader is away.
      if(document.visibilityState!=='visible')return;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(), 1200);
    };
    const ch = sb.channel(`club:${activeClubId}:${activeBookId || 'no-active-book'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'club_books', filter:`club_id=eq.${activeClubId}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings', filter:`club_id=eq.${activeClubId}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_options', filter:`club_id=eq.${activeClubId}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ballots', filter:`club_id=eq.${activeClubId}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts', filter:activeBookId?`club_book_id=eq.${activeBookId}`:'club_book_id=is.null' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reading_progress', filter:activeBookId?`club_book_id=eq.${activeBookId}`:'club_book_id=is.null' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'book_ratings', filter:activeBookId?`club_book_id=eq.${activeBookId}`:'club_book_id=is.null' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter:`user_id=eq.${user.id}` }, async()=>{setUnreadNotifications(await getUnreadNotificationCount(user.id))})
      .subscribe();
    const reconcile=()=>{if(document.visibilityState==='visible')scheduleRefresh()};
    window.addEventListener('focus',reconcile);
    document.addEventListener('visibilitychange',reconcile);
    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      window.removeEventListener('focus',reconcile);
      document.removeEventListener('visibilitychange',reconcile);
      void sb.removeChannel(ch);
    };
  }, [activeClubId, workspace?.currentBook?.id, user?.id, refresh]);

  const value = useMemo(() => ({
    user, profile, clubs, activeClubId, workspace, loading, refreshing, unreadNotifications, error, offline, refresh, selectClub, applyProfileStyle
  }), [user, profile, clubs, activeClubId, workspace, loading, refreshing, unreadNotifications, error, offline, refresh, selectClub, applyProfileStyle]);

  return <C.Provider value={value}>{children}</C.Provider>;
}

export const useApp = () => {
  const value = useContext(C);
  if (!value) throw new Error('Missing provider');
  return value;
};

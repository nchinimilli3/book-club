import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { getMyClubs, getProfile, getWorkspace, getUnreadNotificationCount, setActiveClub as persist } from './data';
import type { Club, Profile, Workspace, ProfileStyle } from './model';
import { readProfileStyleCache } from './profileStyleCache';
import { captureClientError } from './telemetry';

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

function withTimeout<T>(promise: Promise<T>, ms = 12000): Promise<T> {
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

  useEffect(() => { activeRef.current = activeClubId; }, [activeClubId]);

  const refresh = useCallback(async () => {
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
      const { data: { session }, error: sessionError } = await withTimeout(supabase.auth.getSession(), 6000);
      if (sessionError) throw sessionError;
      const u = session?.user ?? null;
      authenticatedUser=u;
      setUser(u);

      if (!u) {
        setProfile(null);
        setClubs([]);
        setId(undefined);
        setWorkspace(null);
        setError(undefined);
        setOffline(false);
        return;
      }

      const [p, c, unread] = await withTimeout(Promise.all([getProfile(u.id), getMyClubs(u.id), getUnreadNotificationCount(u.id)]));
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
      const nextWorkspace=id ? await withTimeout(getWorkspace(id, u.id)) : null;
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
  }, []);

  const applyProfileStyle = useCallback((style: ProfileStyle) => {
    setProfile(current => current ? { ...current, style } : current);
  }, []);

  const selectClub = useCallback(async (id: string) => {
    setError(undefined);
    setId(id);
    activeRef.current = id;
    try {
      await withTimeout(persist(id), 8000);
      if (user) {
        const nextWorkspace=await withTimeout(getWorkspace(id, user.id));
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
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) void refresh();
    });
    return () => subscription.unsubscribe();
  }, [refresh]);

  useEffect(() => {
    const sb = supabase;
    if (!sb || !activeClubId || !user?.id) return;
    let refreshTimer: number | undefined;
    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(), 220);
    };
    const ch = sb.channel(`club:${activeClubId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reading_progress' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'replies' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_rsvps' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_options' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_option_responses' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'club_books' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'book_ratings' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ballots' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ballot_preferences' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter:`user_id=eq.${user.id}` }, async()=>{setUnreadNotifications(await getUnreadNotificationCount(user.id))})
      .subscribe();
    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      void sb.removeChannel(ch);
    };
  }, [activeClubId, user?.id, refresh]);

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

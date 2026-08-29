import { supabase } from '@book-club/supabase';
import { cloudApi } from './cloudApi';
import { trackEvent } from './telemetry';
import { resolveBookCover } from './api';
import type { Book, Club, ClubBook, Member, Profile, Thought, Workspace, Tone, Phase, ProfileStyle, MarginItem, ClubRating, AppNotification, MeetingQuestion, ProgressScene } from './model';

const toneMap: Record<string, Tone> = { pink:'rose', petal:'rose', rose:'rose', olive:'olive', butter:'gold', gold:'gold', lavender:'plum', plum:'plum', sky:'blue', blue:'blue', wine:'clay', clay:'clay' };
const phaseMap = (v?: string): Phase => (['setup','choosing','acquiring','reading','planning_meeting','meeting','rating','archived','paused'].includes(v || '') ? v : 'setup') as Phase;
function stableSceneHash(seed:string){
  // FNV-1a gives us much better spread across UUIDs than parity of a simple 31x hash.
  let hash=0x811c9dc5;
  for(let i=0;i<seed.length;i++){
    hash^=seed.charCodeAt(i);
    hash=Math.imul(hash,0x01000193)>>>0;
  }
  return hash>>>0;
}
function hasExplicitProgressScene(row:any){
  const explicit=String(row?.progress_scene||row?.progressScene||'').toLowerCase();
  return explicit==='race'||explicit==='sailing';
}
function resolveProgressScene(row:any):ProgressScene{
  const explicit=String(row?.progress_scene||row?.progressScene||'').toLowerCase();
  if(explicit==='race'||explicit==='sailing')return explicit as ProgressScene;
  const seed=String(row?.id||row?.name||'book-club');
  return stableSceneHash(seed)%2===0?'race':'sailing';
}
function balanceDevProgressScenes(rows:any[],clubs:Club[]){
  // Production should persist clubs.progress_scene (migration 011). In local/dev,
  // keep a useful visual mix even before that migration has been applied.
  if(!import.meta.env.DEV||clubs.length<2)return clubs;
  const fallbackIndexes=rows.map((row,index)=>hasExplicitProgressScene(row?.clubs)?-1:index).filter(index=>index>=0);
  if(fallbackIndexes.length<2)return clubs;
  const scenes=fallbackIndexes.map(index=>clubs[index]?.progressScene);
  if(new Set(scenes).size>1)return clubs;
  const sorted=[...fallbackIndexes].sort((a,b)=>String(clubs[a]?.id||'').localeCompare(String(clubs[b]?.id||'')));
  const start=stableSceneHash(sorted.map(index=>clubs[index]?.id||'').join('|'))%2;
  const assigned=new Map<number,ProgressScene>();
  sorted.forEach((clubIndex,position)=>assigned.set(clubIndex,(position+start)%2===0?'race':'sailing'));
  return clubs.map((club,index)=>assigned.has(index)?{...club,progressScene:assigned.get(index)!}:club);
}
const bookFrom = (b: any): Book => ({
  id: b.id,
  title: b.title,
  author: b.author || 'Unknown author',
  coverUrl: b.cover_url || '',
  description: b.description || '',
  pages: b.page_count || undefined,
  year: b.first_publish_year ?? b.published_year ?? undefined,
  isbn: b.isbn13 || undefined,
  subjects: Array.isArray(b.subjects) ? b.subjects : [],
});

function isBackendImplementationError(error:any){
  const text=`${error?.message||''} ${error?.details||''} ${error?.hint||''}`.toLowerCase();
  return text.includes('schema cache')||text.includes('could not find the function')||text.includes('could not find a relationship')||text.includes('does not exist');
}

function fail(error: any, fallback: string): never {
  throw new Error(isBackendImplementationError(error)?fallback:(error?.message || fallback));
}

function isSchemaMissing(error:any,name:string):boolean{
  const code=String(error?.code||'');
  const text=`${error?.message||''} ${error?.details||''} ${error?.hint||''}`.toLowerCase();
  return (code==='PGRST205'||code==='PGRST202'||code==='42P01'||code==='42883'||text.includes('schema cache')||text.includes('does not exist'))&&text.includes(name.toLowerCase());
}

function isMeetingSchemaMissing(error: any): boolean {
  const code = String(error?.code || '');
  const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return (code === 'PGRST205' || code === 'PGRST202' || code === '42P01' || code === '42883')
    && (text.includes('meeting_options') || text.includes('meeting_option_responses') || text.includes('save_meeting_options') || text.includes('set_meeting_option_response'));
}


function isBallotPreferenceSchemaMissing(error: any): boolean {
  const code = String(error?.code || '');
  const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  const mentionsPreferenceSchema = text.includes('ballot_preferences') || text.includes('set_ballot_preference');
  const missingSchemaSignal = code === 'PGRST205' || code === 'PGRST202' || code === '42P01' || code === '42883'
    || text.includes('schema cache') || text.includes('could not find the table') || text.includes('does not exist');
  return mentionsPreferenceSchema && missingSchemaSignal;
}
function failMeetingSchema(error: any, fallback: string): never {
  if (isMeetingSchemaMissing(error)) {
    throw new Error('Meeting scheduling needs the latest database migration. Run supabase/migrations/009_FINAL_RELEASE.sql in the Supabase SQL Editor, confirm every release check says PASS, then refresh the app.');
  }
  fail(error, fallback);
}
function profileAvatar(row:any){return row?.profile_style?.avatarUrl || row?.avatar_url || undefined}

const clubCoverUrlCache = new Map<string,{url:string;expiresAt:number}>();
const versionedClubCoverPath = (clubId:string) => `${clubId}/header-${crypto.randomUUID()}.webp`;
async function resolveClubCoverUrl(value: unknown): Promise<string | undefined> {
  if (typeof value !== 'string' || !value) return undefined;
  const path = value.startsWith('club-media/') ? value.slice('club-media/'.length) : value;
  if (!/^[0-9a-f-]{36}\/(?:header\.jpg|header-[0-9a-f-]{36}\.webp)$/i.test(path)) return value;
  if (!supabase) return undefined;
  const cached=clubCoverUrlCache.get(path);
  if(cached&&cached.expiresAt>Date.now()+5*60*1000)return cached.url;
  const { data, error } = await supabase.storage.from('club-media').createSignedUrl(path, 60 * 60 * 24);
  if(error||!data?.signedUrl)return undefined;
  clubCoverUrlCache.set(path,{url:data.signedUrl,expiresAt:Date.now()+23*60*60*1000});
  return data.signedUrl;
}

export async function getProfile(userId: string): Promise<Profile> {
  if (!supabase) return { id: userId, displayName: 'Reader' };
  const result = await supabase.from('profiles').select('id,display_name,username,avatar_url,profile_style').eq('id', userId).maybeSingle();
  if (result.error) fail(result.error, 'Could not load profile');
  const x: any = result.data;
  return { id: userId, displayName: x?.display_name || 'Reader', username: x?.username || undefined, avatarUrl: profileAvatar(x), style: x?.profile_style || undefined };
}

export async function getMyClubs(userId: string) {
  if (!supabase) return { clubs: [] as Club[] };
  const [clubResult, prefResult] = await Promise.all([
    supabase.from('club_members').select('role,clubs(id,name,owner_id,accent_palette,palette,status,invite_code,cover_image_url,progress_scene)').eq('user_id', userId),
    supabase.from('user_preferences').select('active_club_id').eq('user_id', userId).maybeSingle(),
  ]);
  if (clubResult.error) fail(clubResult.error, 'Could not load clubs');
  // Existing users from before user_preferences was added may legitimately have no row.
  if (prefResult.error && prefResult.error.code !== 'PGRST116') fail(prefResult.error, 'Could not load active club preference');
  const membershipRows=(clubResult.data || []).filter((x: any) => x.clubs);
  const clubs = balanceDevProgressScenes(membershipRows,membershipRows.map((r: any) => ({
    id: r.clubs.id,
    name: r.clubs.name,
    ownerId: r.clubs.owner_id,
    tone: toneMap[r.clubs.accent_palette || r.clubs.palette] || 'rose',
    phase: phaseMap(r.clubs.status),
    inviteCode: r.clubs.invite_code,
    coverImageUrl: r.clubs.cover_image_url,
    memberCount: 0,
    progressScene: resolveProgressScene(r.clubs),
  })));
  return { clubs, activeClubId: prefResult.data?.active_club_id || clubs[0]?.id };
}

export async function setActiveClub(id: string) {
  if (!supabase) return;
  const { error } = await supabase.rpc('set_active_club', { target_club_id: id });
  if (error) fail(error, 'Could not save active club');
}

export async function createClub(name: string, tone: Tone) {
  if (import.meta.env.VITE_BACKEND === 'd1') return (await cloudApi.createClub(name)).club;
  if (!supabase) throw new Error('Supabase unavailable');
  const { data, error } = await supabase.rpc('create_club', { club_name: name, palette: tone === 'rose' ? 'petal' : tone, mark: '' });
  if (error) fail(error, 'Could not create club');
  void trackEvent('club_created',{clubId: typeof data==='string'?data:undefined});
  return typeof data === 'string' ? { id: data } : Array.isArray(data) ? data[0] : data;
}

export async function joinClub(code: string) {
  if (import.meta.env.VITE_BACKEND === 'd1') return await cloudApi.joinInvite(code.trim().split('/').filter(Boolean).pop() || code);
  if (!supabase) throw new Error('Supabase unavailable');
  const clean = code.trim().split('/').filter(Boolean).pop() || code;
  const { data, error } = await supabase.rpc('join_club_by_invite', { supplied_invite_code: clean });
  if (error) fail(error, 'Could not join club');
  void trackEvent('club_joined',{clubId: typeof data==='string'?data:undefined});
  return typeof data === 'string' ? { id: data } : Array.isArray(data) ? data[0] : data;
}

export async function getWorkspace(clubId: string, userId: string): Promise<Workspace> {
  if (!supabase) throw new Error('Supabase unavailable');
  const clubResult = await supabase.from('clubs').select('id,name,owner_id,accent_palette,palette,status,invite_code,cover_image_url,progress_scene').eq('id', clubId).single();
  if (clubResult.error) fail(clubResult.error, 'Could not load club');
  const c: any = clubResult.data;

  const [memberResult, clubBookResult, archivePreviewResult, archiveCountResult, meetingResult, meetingOptionResult] = await Promise.all([
    supabase.from('club_members').select('role,user_id').eq('club_id', clubId),
    supabase.from('club_books').select('id,club_id,book_id,status,start_date,started_at,target_finish_date,target_finish_at,total_chapters,total_pages,suggested_reading_plan,created_by,created_at,books(id,title,author,cover_url,description,page_count,first_publish_year,published_year,isbn13,subjects)').eq('club_id', clubId).in('status',['idea','nominated','ballot','up_next','acquiring','reading','planning','planning_meeting','meeting','rating']).order('created_at', { ascending: false }),
    supabase.from('club_books').select('books(id,title,author,cover_url,description,page_count,first_publish_year,published_year,isbn13,subjects)').eq('club_id',clubId).in('status',['finished','archived']).order('created_at',{ascending:false}).limit(12),
    supabase.from('club_books').select('id',{count:'exact',head:true}).eq('club_id',clubId).in('status',['finished','archived']),
    supabase.from('meetings').select('id,club_book_id,checkpoint_id,starts_at,meeting_type,meeting_url,join_url,meeting_rsvps(response,user_id)').eq('club_id', clubId).neq('status','cancelled').order('starts_at', { ascending: true }),
    supabase.from('meeting_options').select('id,club_book_id,checkpoint_id,starts_at,meeting_option_responses(user_id,available)').eq('club_id',clubId).order('starts_at'),
  ]);
  if (memberResult.error) fail(memberResult.error, 'Could not load club members');
  if (clubBookResult.error) fail(clubBookResult.error, 'Could not load club books');
  if (archivePreviewResult.error) fail(archivePreviewResult.error, 'Could not load club archive preview');
  if (archiveCountResult.error) fail(archiveCountResult.error, 'Could not count club archive');
  if (meetingResult.error) fail(meetingResult.error, 'Could not load meetings');
  // Meeting polls were added in release migration 009. An older live database should
  // not make the entire club unreadable while that migration is being applied.
  if (meetingOptionResult.error && !isMeetingSchemaMissing(meetingOptionResult.error)) fail(meetingOptionResult.error, 'Could not load meeting availability');

  const memberRows: any[] = memberResult.data || [];
  const clubBooks: any[] = clubBookResult.data || [];
  const meetings: any[] = meetingResult.data || [];
  const meetingOptions = (meetingOptionResult.error ? [] : meetingOptionResult.data || []).map((x:any)=>({
    id:x.id, startsAt:x.starts_at, checkpointId:x.checkpoint_id||undefined,
    availableCount:(x.meeting_option_responses||[]).filter((r:any)=>r.available).length,
    myAvailable:(x.meeting_option_responses||[]).some((r:any)=>r.user_id===userId&&r.available),
  }));
  const memberIds = memberRows.map((m:any)=>m.user_id).filter(Boolean);
  const profileResult = memberIds.length ? await supabase.from('profiles').select('id,display_name,username,avatar_url,profile_style').in('id', memberIds) : {data:[],error:null} as any;
  if (profileResult.error) fail(profileResult.error, 'Could not load member profiles');
  const profileMap = new Map((profileResult.data || []).map((p:any)=>[p.id,p]));
  const active = clubBooks.find((r: any) => ['acquiring','reading','planning','planning_meeting','meeting','rating','up_next'].includes(r.status));

  let thoughts: Thought[] = [];
  let checkpoints: any[] = [];
  let checkpointCheckins: any[] = [];
  let progress: any;
  let acquired = 0;
  let myClubRating: ClubRating | undefined;
  let memberProgressRows:any[]=[];
  let lockedPostCount = 0;
  let meetingQuestions: MeetingQuestion[] = [];

  if (active) {
    const [postResult, checkpointResult, progressResult, checkinResult, ratingResult, lockedResult, meetingQuestionResult] = await Promise.all([
      supabase.from('posts').select('id,user_id,body,post_type,type,spoiler_chapter,chapter,created_at,revealed_at,locked').eq('club_book_id', active.id).order('created_at', { ascending: false }).limit(50),
      supabase.from('reading_checkpoints').select('id,due_at,target_chapter,target_page,label').eq('club_book_id', active.id).order('due_at'),
      supabase.from('reading_progress').select('user_id,chapter,page,percent,status,participation_status,format').eq('club_book_id', active.id),
      supabase.from('book_checkins').select('status').eq('club_book_id', active.id),
      supabase.from('book_ratings').select('rating,review,recommend').eq('club_book_id',active.id).eq('user_id',userId).maybeSingle(),
      supabase.rpc('get_locked_post_count',{target_club_book_id:active.id}),
      supabase.from('meeting_questions').select('id,user_id,body,post_id,created_at').eq('club_book_id',active.id).eq('resolved',false).order('created_at'),
    ]);
    if (postResult.error) fail(postResult.error, 'Could not load discussion');
    if (checkpointResult.error) fail(checkpointResult.error, 'Could not load reading plan');
    if (progressResult.error) fail(progressResult.error, 'Could not load reading progress');
    if (checkinResult.error) fail(checkinResult.error, 'Could not load book check-ins');
    if (ratingResult.error && ratingResult.error.code !== 'PGRST116') fail(ratingResult.error, 'Could not load your rating');
    if (lockedResult.error) fail(lockedResult.error,'Could not load spoiler locks');
    if (meetingQuestionResult.error) fail(meetingQuestionResult.error,'Could not load meeting agenda');
    lockedPostCount=Number(lockedResult.data||0);
    meetingQuestions=(meetingQuestionResult.data||[]).map((x:any)=>{const mp:any=profileMap.get(x.user_id);return{id:x.id,postId:x.post_id||undefined,body:x.body,createdAt:x.created_at,addedBy:mp?{id:x.user_id,displayName:mp.display_name||'Reader',username:mp.username||undefined,avatarUrl:profileAvatar(mp)}:undefined}});
    if (ratingResult.data) myClubRating = { rating:Number((ratingResult.data as any).rating), review:(ratingResult.data as any).review || undefined, recommend:(ratingResult.data as any).recommend ?? undefined };

    const postRows:any[] = postResult.data || [];
    const postIds=postRows.map((x:any)=>x.id);
    let replyRows:any[]=[]; let reactionRows:any[]=[];
    if(postIds.length){
      const [replyResult,reactionResult]=await Promise.all([
        supabase.from('replies').select('id,post_id,user_id,body,created_at').in('post_id',postIds).order('created_at'),
        supabase.from('reactions').select('id,post_id,user_id,reaction,created_at').in('post_id',postIds).order('created_at'),
      ]);
      if(replyResult.error) fail(replyResult.error,'Could not load replies');
      if(reactionResult.error) fail(reactionResult.error,'Could not load reactions');
      replyRows=replyResult.data||[]; reactionRows=reactionResult.data||[];
      const replyUserIds=[...new Set(replyRows.map((x:any)=>x.user_id).filter(Boolean))];
      const missing=replyUserIds.filter((id:any)=>!profileMap.has(id));
      if(missing.length){
        const pr=await supabase.from('profiles').select('id,display_name,username,avatar_url').in('id',missing);
        if(!pr.error)for(const pp of pr.data||[])profileMap.set((pp as any).id,pp);
      }
    }

    thoughts = postRows.map((p: any) => ({
      id: p.id,
      userId: p.user_id,
      body: p.body,
      type: p.post_type ?? p.type ?? 'thought',
      chapter: p.spoiler_chapter ?? p.chapter ?? undefined,
      createdAt: p.created_at,
      predictionRevealed: Boolean(p.revealed_at) || !Boolean(p.locked),
      author: profileMap.get(p.user_id) ? { id: p.user_id, displayName: (profileMap.get(p.user_id) as any).display_name || 'Reader', username: (profileMap.get(p.user_id) as any).username || undefined, avatarUrl: profileAvatar(profileMap.get(p.user_id)) } : undefined,
      reactions: reactionRows.filter((r:any)=>r.post_id===p.id).map((r:any)=>({ id:r.id,postId:r.post_id,userId:r.user_id,reaction:r.reaction,createdAt:r.created_at })),
      replyItems: replyRows.filter((r:any)=>r.post_id===p.id).map((r:any)=>{const rp:any=profileMap.get(r.user_id);return { id:r.id,postId:r.post_id,userId:r.user_id,body:r.body,createdAt:r.created_at,author:rp?{id:r.user_id,displayName:rp.display_name||'Reader',username:rp.username||undefined,avatarUrl:profileAvatar(rp)}:undefined };}),
    }));
    checkpoints = (checkpointResult.data || []).map((x: any) => ({ id: x.id, dueAt: x.due_at, targetChapter: x.target_chapter || undefined, targetPage: x.target_page || undefined, label: x.label || undefined }));
    const checkpointIds=checkpoints.map((x:any)=>x.id);
    if(checkpointIds.length){
      const checkpointCheckinResult=await supabase.from('checkpoint_checkins').select('checkpoint_id,user_id,status,updated_at').in('checkpoint_id',checkpointIds);
      if(checkpointCheckinResult.error&&!isSchemaMissing(checkpointCheckinResult.error,'checkpoint_checkins'))fail(checkpointCheckinResult.error,'Could not load checkpoint check-ins');
      checkpointCheckins=(checkpointCheckinResult.error?[]:checkpointCheckinResult.data||[]).map((x:any)=>({checkpointId:x.checkpoint_id,userId:x.user_id,status:x.status,updatedAt:x.updated_at}));
    }
    memberProgressRows=progressResult.data||[];
    const mine: any = memberProgressRows.find((p: any) => p.user_id === userId);
    progress = mine ? { chapter: mine.chapter || undefined, page: mine.page || undefined, percent: mine.percent != null ? Number(mine.percent) : undefined, status: mine.status ?? mine.participation_status, format: mine.format } : undefined;
    acquired = (checkinResult.data || []).filter((x: any) => x.status === 'acquired').length;
  }

  const members: Member[] = memberRows.map((m: any) => { const p:any=profileMap.get(m.user_id); const rp:any=memberProgressRows.find(x=>x.user_id===m.user_id); return { id: m.user_id, displayName: p?.display_name || 'Reader', username: p?.username || undefined, avatarUrl: profileAvatar(p), role: m.role, chapter:rp?.chapter||undefined, page:rp?.page||undefined, percent:rp?.percent!=null?Number(rp.percent):undefined, status:(rp?.status??rp?.participation_status)||undefined, format:rp?.format||undefined }; });
  const currentBook: ClubBook | undefined = active ? {
    id: active.id,
    clubId,
    book: bookFrom(active.books),
    status: active.status,
    startDate: active.start_date || active.started_at || undefined,
    targetFinishDate: active.target_finish_date || active.target_finish_at || undefined,
    totalChapters: active.total_chapters || undefined,
    totalPages: active.total_pages || undefined,
    suggestedReadingPlan: active.suggested_reading_plan || undefined,
  } : undefined;

  // A confirmed meeting is always anchored to a reading checkpoint. Older unlinked
  // records are deliberately excluded so they cannot be presented as the next discussion.
  const linkedMeetings=meetings.filter((m:any)=>m.club_book_id===active?.id&&m.checkpoint_id);
  const mtg = linkedMeetings.find((m: any) => new Date(m.starts_at).getTime() > Date.now() - 10800000) || linkedMeetings[0];
  const rawResponse = mtg?.meeting_rsvps?.find((r: any) => r.user_id === userId)?.response;
  const response = rawResponse === 'yes' ? 'going' : rawResponse === 'no' ? 'cant' : rawResponse;
  const meeting = mtg ? { id: mtg.id, startsAt: mtg.starts_at, checkpointId:mtg.checkpoint_id, meetingType: mtg.meeting_type, meetingUrl: mtg.meeting_url || mtg.join_url || undefined, response } : undefined;
  const archiveBooks = (archivePreviewResult.data || []).map((r: any) => bookFrom(r.books));
  const archiveBookCount = archiveCountResult.count || 0;
  const ideaBooks: ClubBook[] = clubBooks.filter((r: any) => ['idea','nominated','ballot'].includes(r.status)).map((r: any) => {
    const suggested:any = r.created_by ? profileMap.get(r.created_by) : undefined;
    return { id: r.id, clubId, book: bookFrom(r.books), status: r.status, startDate: r.start_date || r.started_at || undefined, targetFinishDate: r.target_finish_date || r.target_finish_at || undefined, totalChapters: r.total_chapters || undefined, totalPages: r.total_pages || undefined, suggestedBy: r.created_by ? { id:r.created_by, displayName:suggested?.display_name || 'Reader', username:suggested?.username || undefined, avatarUrl:suggested?.avatar_url || undefined } : undefined };
  });

  const coverImageUrl = await resolveClubCoverUrl(c.cover_image_url);
  return {
    club: { id: c.id, name: c.name, ownerId: c.owner_id, tone: toneMap[c.accent_palette || c.palette] || 'rose', phase: phaseMap(c.status), inviteCode: c.invite_code, coverImageUrl, memberCount: members.length, progressScene: resolveProgressScene(c) },
    members, currentBook, ideaBooks, meeting, meetingOptions, thoughts: thoughts.map(t=>({...t,savedForMeeting:meetingQuestions.some(q=>q.postId===t.id)})), checkpoints, checkpointCheckins, acquired, myProgress: progress, archiveBooks, archiveBookCount, myClubRating, lockedPostCount, meetingQuestions,
  };
}

export async function updateProgress(id: string, chapter?: number, status = 'reading', totalChapters?: number, page?: number, totalPages?: number, explicitPercent?:number) {
  if (!supabase) return;
  const percent = explicitPercent != null ? Math.min(100,Math.max(0,Math.round(explicitPercent))) : totalChapters && chapter != null ? Math.min(100, Math.max(0, Math.round(chapter / totalChapters * 100))) : totalPages && page != null ? Math.min(100, Math.max(0, Math.round(page / totalPages * 100))) : null;
  const { error } = await supabase.rpc('update_my_progress', { target_club_book_id: id, chapter_number: chapter ?? null, page_number: page ?? null, progress_percent: percent, reading_status: status });
  if (error) fail(error, 'Could not save progress');
  void trackEvent('reading_progress_updated',{clubBookId:id,status,chapter,page,percent});
}

export async function markAcquired(id: string, format = 'Physical') {
  if (!supabase) return;
  const { error } = await supabase.rpc('mark_book_acquired', { target_club_book_id: id, reading_format: format, isbn: null });
  if (error) fail(error, 'Could not save book check-in');
  void trackEvent('book_acquired',{clubBookId:id,format});
}

export async function setFinishDate(id: string, date: string, chapters?: number, pages?: number) {
  if (!supabase) return;
  const { error } = await supabase.rpc('start_club_book', { target_club_book_id: id, finish_date: date, chapters: chapters || null, pages: pages || null });
  if (error) fail(error, 'Could not start reading plan');
  if (chapters || pages) {
    const checkpoint = await supabase.rpc('generate_reading_checkpoints', { target_club_book_id: id, checkpoint_count: 4 });
    if (checkpoint.error) fail(checkpoint.error, 'Book started, but checkpoints could not be generated');
  }
}

export async function rsvp(meetingId: string, _userId: string, response: string) {
  if (!supabase) throw new Error('Supabase unavailable');
  const canonical = response === 'yes' ? 'going' : response === 'no' ? 'cant' : response;
  const { error } = await supabase.rpc('set_meeting_rsvp',{target_meeting_id:meetingId,target_response:canonical});
  if(error) fail(error,'Could not save RSVP');
  void trackEvent('meeting_rsvp',{meetingId,response:canonical});
}

export async function scheduleMeeting(clubId: string, clubBookId: string | undefined, _userId: string, startsAt: string, meetingType = 'facetime', meetingUrl?: string, meetingId?: string, checkpointId?:string) {
  if (!supabase) throw new Error('Supabase unavailable');
  const {data,error}=await supabase.rpc('save_club_meeting',{target_club_id:clubId,target_club_book_id:clubBookId||null,target_meeting_id:meetingId||null,target_starts_at:startsAt,target_meeting_type:meetingType,target_meeting_url:meetingUrl||null,target_checkpoint_id:checkpointId||null});
  if(error) fail(error,'Could not save meeting');
  void trackEvent('meeting_scheduled',{clubId,clubBookId,meetingId:data||meetingId});
  return data;
}

export async function saveMeetingOptions(clubId:string,clubBookId:string|undefined,startsAt:string[],checkpointId?:string){
  if(!supabase)throw new Error('Supabase unavailable');
  const {error}=await supabase.rpc('save_meeting_options',{target_club_id:clubId,target_club_book_id:clubBookId||null,target_checkpoint_id:checkpointId||null,target_options:startsAt});
  if(error)failMeetingSchema(error,'Could not save meeting options');
  void trackEvent('meeting_options_saved',{clubId,count:startsAt.length});
}

export async function setMeetingOptionResponse(optionId:string,available:boolean){
  if(!supabase)throw new Error('Supabase unavailable');
  const {error}=await supabase.rpc('set_meeting_option_response',{target_option_id:optionId,target_available:available});
  if(error)failMeetingSchema(error,'Could not save your availability');
  void trackEvent('meeting_availability_saved',{optionId,available});
}

export async function submitMeetingPoll(checkpointId:string){
  if(!supabase)throw new Error('Supabase unavailable');
  const {data,error}=await supabase.rpc('submit_meeting_poll',{target_checkpoint_id:checkpointId});
  if(error)failMeetingSchema(error,'Could not submit meeting availability');
  return data;
}

export async function createThought(bookId: string, userId: string, body: string, chapter?: number, type = 'thought') {
  if (!supabase) throw new Error('Supabase unavailable');
  const canonical: any = { club_book_id: bookId, user_id: userId, body, post_type: type, spoiler_chapter: chapter || null, locked: type === 'prediction' };
  const result = await supabase.from('posts').insert(canonical).select('*').single();
  if (result.error) fail(result.error, 'Could not post thought');
  void trackEvent('discussion_post_created',{clubBookId:bookId,type,chapter});
  return result.data;
}

async function ensureBook(r: { title:string; author:string; cover?:string; year?:number; isbn?:string; pages?:number; description?:string; subjects?:string[] }) {
  if (!supabase) throw new Error('Supabase unavailable');
  let bookId: string | undefined;
  if (r.isbn) {
    const found = await supabase.from('books').select('id').eq('isbn13', r.isbn).maybeSingle();
    if (found.error && found.error.code !== 'PGRST116') fail(found.error, 'Could not resolve book');
    bookId = found.data?.id;
  }
  if (!bookId) {
    const byTitle = await supabase.from('books').select('id').ilike('title', r.title).ilike('author', r.author || '%').limit(1).maybeSingle();
    if (byTitle.error && byTitle.error.code !== 'PGRST116') fail(byTitle.error, 'Could not resolve book');
    bookId = byTitle.data?.id;
  }
  if (!bookId) {
    const base: any = { title: r.title, author: r.author || 'Unknown author', cover_url: r.cover || null, isbn13: r.isbn || null, page_count: r.pages || null, description: r.description || null, subjects: (r.subjects || []).slice(0,18) };
    const result = await supabase.from('books').insert({ ...base, first_publish_year: r.year || null }).select('id').single();
    if (result.error) fail(result.error, 'Could not save book metadata');
    bookId = result.data.id;
  }
  if (bookId && r.subjects?.length) {
    const update = await supabase.from('books').update({ subjects: r.subjects.slice(0,18) }).eq('id', bookId);
    if (update.error && update.error.code !== 'PGRST204') fail(update.error, 'Could not save book genres');
  }
  return bookId;
}

export async function saveBookToClub(clubId: string, r: { title:string; author:string; cover:string; year?:number; isbn?:string; pages?:number; description?:string; subjects?:string[] }) {
  if (import.meta.env.VITE_BACKEND === 'd1') {
    const result: any = await cloudApi.suggestBook(clubId, r.title, r.author, r.cover);
    return { bookId: result.book?.id, clubBookId: result.book?.id, alreadySaved: Boolean(result.alreadySaved), status: result.book?.status || 'suggested' };
  }
  if (!supabase) throw new Error('Supabase unavailable');
  const bookId = await ensureBook(r);
  const existing = await supabase.from('club_books').select('id,status').eq('club_id', clubId).eq('book_id', bookId).in('status', ['idea','nominated','ballot','up_next','acquiring','reading']).maybeSingle();
  if (existing.error && existing.error.code !== 'PGRST116') fail(existing.error, 'Could not check club ideas');
  if (existing.data?.id) return { bookId, clubBookId: existing.data.id, alreadySaved: true, status: existing.data.status };
  const result = await supabase.rpc('add_club_idea', { target_club_id: clubId, target_book_id: bookId });
  if (result.error) fail(result.error, 'Could not add book to club ideas');
  const clubBookId = result.data?.clubBookId || result.data?.club_book_id;
  if (!clubBookId) throw new Error('Could not add book to club ideas');
  void trackEvent('club_idea_added',{clubId,clubBookId,bookId});
  return { bookId, clubBookId, alreadySaved: false, status: 'idea' };
}

export async function savePersonalBook(userId: string, r: { title:string; author:string; cover?:string; year?:number; isbn?:string; pages?:number; description?:string }, { shelf='want_to_read', rating, dateFinished, isFavorite=false, source='search' }: { shelf?:string; rating?:number; dateFinished?:string|null; isFavorite?:boolean; source?:'search'|'goodreads' } = {}) {
  if (!supabase) throw new Error('Supabase unavailable');
  const bookId = await ensureBook(r);
  const inferredFinished = dateFinished !== undefined ? dateFinished : (shelf==='read' && source!=='goodreads' ? new Date().toISOString().slice(0,10) : null);
  const payload: any = { user_id: userId, book_id: bookId, shelf, rating: rating ?? null, date_finished: inferredFinished, source, is_favorite: isFavorite, updated_at: new Date().toISOString() };
  const result = await supabase.from('personal_books').upsert(payload, { onConflict: 'user_id,book_id' });
  if (result.error) fail(result.error, 'Could not save personal book');
  void trackEvent('personal_book_saved',{bookId,shelf,isFavorite,source});
  return bookId;
}

export async function updatePersonalBook(userId: string, personalBookId: string, patch: { shelf?:string; rating?:number|null; dateFinished?:string|null; isFavorite?:boolean; isPublic?:boolean }) {
  if (!supabase) throw new Error('Supabase unavailable');
  const payload: any = { ...patch, updated_at: new Date().toISOString() };
  if (patch.shelf==='read' && !('dateFinished' in patch)) payload.date_finished = new Date().toISOString().slice(0,10);
  if ('dateFinished' in payload) { payload.date_finished = payload.dateFinished; delete payload.dateFinished; }
  if ('isFavorite' in payload) { payload.is_favorite = payload.isFavorite; delete payload.isFavorite; }
  if ('isPublic' in payload) { payload.is_public = payload.isPublic; delete payload.isPublic; }
  const result = await supabase.from('personal_books').update(payload).eq('id', personalBookId).eq('user_id', userId);
  if (result.error) fail(result.error, 'Could not update book');
}

export async function updateProfileStyle(_userId: string, style: ProfileStyle): Promise<ProfileStyle> {
  if (!supabase) throw new Error('Supabase unavailable');
  const {data,error}=await supabase.rpc('save_my_profile_style_v3', { style_payload: style });
  if(error) fail(error,'Could not save profile design');
  return (data || style) as ProfileStyle;
}

export async function saveClubCoverImage(clubId: string, image: Blob | null, previousPath?:string) {
  if (import.meta.env.VITE_BACKEND === 'd1') {
    if (!image) throw new Error('Resetting to the standard header is not available in the preview backend yet.');
    await cloudApi.uploadHeader(clubId, image);
    return;
  }
  if (!supabase) throw new Error('Supabase unavailable');
  const path = image ? versionedClubCoverPath(clubId) : null;
  if (image) {
    const upload = await supabase.storage.from('club-media').upload(path!, image, { contentType: 'image/webp', cacheControl: '31536000, immutable', upsert: false });
    if (upload.error) {
      const detail = upload.error.message || upload.error.statusCode || 'Storage rejected the upload';
      throw new Error(`Could not upload club header image: ${detail}`);
    }
  }
  const result = await supabase.rpc('update_club_header', { target_club_id: clubId, target_cover_path: path });
  if (result.error) {
    const detail = result.error.message || result.error.code || 'Database rejected the update';
    throw new Error(`Could not save club header image: ${detail}`);
  }
  if(previousPath&&previousPath!==path&&/^[0-9a-f-]{36}\/header-[0-9a-f-]{36}\.webp$/i.test(previousPath)){
    void supabase.storage.from('club-media').remove([previousPath]);
    clubCoverUrlCache.delete(previousPath);
  }
}

export async function getBookContext(bookId: string, chapter?: number) {
  if (!supabase) return [];
  let q = supabase.from('book_context_items').select('*,context_sources(*)').eq('book_id', bookId).order('created_at');
  if (chapter != null) q = q.or(`spoiler_chapter.is.null,spoiler_chapter.lte.${chapter}`);
  const { data, error } = await q;
  if (error) fail(error, 'Could not load book context');
  return (data || []).map((x: any) => ({ ...x, kind: x.kind ?? x.type ?? 'context' }));
}

export async function repairBookCover(bookId:string,coverUrl:string){
  if(!supabase||!bookId||!coverUrl)return false;
  const result=await supabase.from('books').update({cover_url:coverUrl}).eq('id',bookId);
  if(result.error)return false;
  return true;
}

export async function getPersonalLibrary(userId: string) {
  if (!supabase) return [];
  const result = await supabase.from('personal_books').select('*,books(*)').eq('user_id', userId).order('date_finished', { ascending: false, nullsFirst: false });
  if (result.error) fail(result.error, 'Could not load personal library');
  return (result.data || []).map((r: any) => ({ id: r.id, shelf: r.shelf, rating: r.rating ? Number(r.rating) : undefined, dateFinished: r.date_finished || undefined, isPublic: r.is_public, isFavorite: Boolean(r.is_favorite), source: r.source || undefined, book: bookFrom(r.books) }));
}

export async function getBallot(clubId: string, userId: string) {
  if (import.meta.env.VITE_BACKEND === 'd1') {
    const result: any = await cloudApi.activeBallot(clubId);
    if (!result.ballot) return null;
    return { ...result.ballot, nominations: (result.ballot.nominations || []).map((item: any) => ({ ...item, book: bookFrom(item.book), voted: false, preference: undefined })) };
  }
  if (!supabase) return null;
  const ballotResult = await supabase.from('ballots').select('*').eq('club_id', clubId).in('status', ['open','needs_decision']).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (ballotResult.error && ballotResult.error.code !== 'PGRST116') fail(ballotResult.error, 'Could not load ballot');
  const ballot: any = ballotResult.data;
  if (!ballot) return null;
  const rankedChoice = ballot.voting_method === 'ranked_choice';
  const [nomResult, voteResult, preferenceResult, rankingResult] = await Promise.all([
    supabase.from('nominations').select('*,books(*)').eq('ballot_id', ballot.id),
    supabase.from('votes').select('nomination_id').eq('user_id', userId),
    rankedChoice ? Promise.resolve({ data: [], error: null } as any) : supabase.from('ballot_preferences').select('user_id,nomination_id,preference').eq('ballot_id',ballot.id),
    rankedChoice ? supabase.rpc('get_my_ballot_ranking', { target_ballot_id: ballot.id }) : Promise.resolve({ data: null, error: null } as any),
  ]);
  if (nomResult.error) fail(nomResult.error, 'Could not load ballot books');
  if (voteResult.error) fail(voteResult.error, 'Could not load your vote');
  const legacyPreferenceMode = Boolean(preferenceResult.error && isBallotPreferenceSchemaMissing(preferenceResult.error));
  if (preferenceResult.error && !legacyPreferenceMode) fail(preferenceResult.error, 'Could not load your ballot preferences');
  if (rankingResult.error) fail(rankingResult.error, 'Could not load your private ranking');
  const preferences = preferenceResult.data || [];
  const rankingIds = Array.isArray(rankingResult.data?.nominationIds) ? rankingResult.data.nominationIds : [];
  const voterCount = rankedChoice ? Number(rankingResult.data?.voterCount || 0) : new Set(preferences.map((p: any) => p.user_id).filter(Boolean)).size;
  return { ...ballot, rankedChoice, legacyPreferenceMode, voterCount, rankingIds, nominations: (nomResult.data || []).map((n: any) => ({ id: n.id, note: n.note ?? n.why ?? '', book: bookFrom(n.books), voted: (voteResult.data || []).some((v: any) => v.nomination_id === n.id), preference:preferences.find((v:any) => v.user_id === userId && v.nomination_id === n.id)?.preference, rank: rankingIds.indexOf(n.id)+1 })) };
}

export async function startBallotFromIdeas(clubId: string, closesAt?:string) {
  if (import.meta.env.VITE_BACKEND === 'd1') return (await cloudApi.startBallot(clubId, closesAt ? new Date(closesAt).getTime() : undefined) as any).ballot?.id;
  if (!supabase) throw new Error('Supabase unavailable');
  const {data,error} = await supabase.rpc('start_ballot_from_ideas', { target_club_id: clubId, requested_closes_at: closesAt || null });
  if(error){
    const details=`${error?.message||''} ${error?.details||''} ${error?.hint||''}`.toLowerCase();
    if(isSchemaMissing(error,'start_ballot_from_ideas')||details.includes('ballot_rankings')||details.includes('voting_method')){
      throw new Error('Voting needs the latest Supabase database migration. Run migration 017_next_read_concierge.sql, then refresh the app.');
    }
    fail(error,'Could not start vote');
  }
  void trackEvent('ballot_started',{clubId,ballotId:data});
  return data;
}

export async function castVote(nominationId: string, _userId?: string) {
  if (!supabase) return;
  const result = await supabase.rpc('cast_ballot_vote', { target_nomination_id: nominationId });
  if (result.error) fail(result.error, 'Could not save vote');
  void trackEvent('ballot_vote_cast',{nominationId});
}

export async function setBallotPreference(nominationId:string,preference:'strong_yes'|'okay'|'no') {
  if(!supabase)throw new Error('Supabase unavailable');
  const result=await supabase.rpc('set_ballot_preference',{target_nomination_id:nominationId,target_preference:preference});
  if(result.error)fail(result.error,'Could not save your preference');
  void trackEvent('ballot_preference_saved',{nominationId,preference});
}

export async function setBallotRanking(ballotId:string, nominationIds:string[]) {
  if (import.meta.env.VITE_BACKEND === 'd1') {
    const result: any = await cloudApi.saveRanking('', ballotId, nominationIds);
    return result;
  }
  if(!supabase)throw new Error('Supabase unavailable');
  const result=await supabase.rpc('set_ballot_ranking',{target_ballot_id:ballotId,target_nomination_ids:nominationIds});
  if(result.error)fail(result.error,'Could not save your ranking');
  void trackEvent('ballot_ranking_saved',{ballotId,count:nominationIds.length});
}

export async function removeClubIdea(clubBookId:string){
  if(!supabase)throw new Error('Supabase unavailable');
  const result=await supabase.rpc('remove_club_idea',{target_club_book_id:clubBookId});
  if(result.error)fail(result.error,'Could not remove this suggestion');
}

export async function revealPrediction(postId:string){
  if(!supabase)throw new Error('Supabase unavailable');
  const result=await supabase.rpc('reveal_prediction',{target_post_id:postId});
  if(result.error)fail(result.error,'Could not reveal this prediction');
}

export async function finalizeBallot(ballotId: string) {
  if (!supabase) throw new Error('Supabase unavailable');
  const { data, error } = await supabase.rpc('finalize_ballot', { target_ballot_id: ballotId });
  if (error) fail(error, 'Could not finalize vote');
  void trackEvent('ballot_finalized',{ballotId,clubBookId:data});
  return data;
}

export async function getBallotTieBreak(ballotId:string) {
  if(!supabase)return undefined;
  const result=await supabase.from('ballots').select('tie_break').eq('id',ballotId).maybeSingle();
  if(result.error)fail(result.error,'Could not load ballot result');
  return result.data?.tie_break?.kind === 'random_draw' ? result.data.tie_break : undefined;
}

export async function decideTiedBallot(ballotId:string,nominationId:string){
  if(!supabase)throw new Error('Supabase unavailable');
  const {data,error}=await supabase.rpc('decide_tied_ballot',{target_ballot_id:ballotId,target_nomination_id:nominationId});
  if(error)fail(error,'Could not choose the tied book');
  return data;
}

export async function setCheckpointCheckin(checkpointId:string,status:'reached'|'catching_up'|'not_yet'){
  if(!supabase)throw new Error('Supabase unavailable');
  const {data,error}=await supabase.rpc('set_checkpoint_checkin',{target_checkpoint_id:checkpointId,target_status:status});
  if(error&&isSchemaMissing(error,'set_checkpoint_checkin')) throw new Error('Checkpoint check-ins are not enabled yet. Run migration 015_repair_checkpoint_checkins.sql in Supabase.');
  if(error)fail(error,'Could not save checkpoint check-in');
  return data;
}

export async function setMyTimezone(timezone:string){
  if(!supabase||!timezone)return;
  const {error}=await supabase.rpc('set_my_timezone',{target_timezone:timezone});
  if(error)throw error;
}


export async function createReply(postId:string, body:string) {
  if(!supabase)throw new Error('Supabase unavailable');
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)throw new Error('You must be signed in');
  const result=await supabase.from('replies').insert({post_id:postId,user_id:user.id,body:body.trim()}).select('*').single();
  if(result.error)fail(result.error,'Could not post reply');
  void trackEvent('discussion_reply_created',{postId});
  return result.data;
}

export async function toggleReaction(postId:string,reaction='heart') {
  if(!supabase)throw new Error('Supabase unavailable');
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)throw new Error('You must be signed in');
  const existing=await supabase.from('reactions').select('post_id').eq('post_id',postId).eq('user_id',user.id).eq('reaction',reaction).maybeSingle();
  if(existing.error&&existing.error.code!=='PGRST116')fail(existing.error,'Could not check reaction');
  if(existing.data){const d=await supabase.from('reactions').delete().eq('post_id',postId).eq('user_id',user.id).eq('reaction',reaction);if(d.error)fail(d.error,'Could not remove reaction');return false;}
  const i=await supabase.from('reactions').insert({post_id:postId,user_id:user.id,reaction});if(i.error)fail(i.error,'Could not add reaction');return true;
}

export async function getMargins(clubBookId:string,userId:string):Promise<MarginItem[]> {
  if(!supabase)return[];
  const [notes,quotes]=await Promise.all([
    supabase.from('private_notes').select('*').eq('club_book_id',clubBookId).eq('user_id',userId).order('created_at',{ascending:false}),
    supabase.from('saved_quotes').select('*').eq('club_book_id',clubBookId).eq('user_id',userId).order('created_at',{ascending:false}),
  ]);
  if(notes.error)fail(notes.error,'Could not load notes');
  if(quotes.error)fail(quotes.error,'Could not load quotes');
  return [
    ...(notes.data||[]).map((x:any)=>({id:x.id,kind:'note' as const,body:x.body,chapter:x.chapter??undefined,page:x.page??undefined,createdAt:x.created_at})),
    ...(quotes.data||[]).map((x:any)=>({id:x.id,kind:'quote' as const,body:x.quote_text,note:x.note||undefined,chapter:x.chapter??undefined,page:x.page??undefined,createdAt:x.created_at})),
  ].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}

export async function savePrivateNote(clubBookId:string,body:string,chapter?:number,page?:number){
  if(!supabase)throw new Error('Supabase unavailable');
  const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('You must be signed in');
  const r=await supabase.from('private_notes').insert({club_book_id:clubBookId,user_id:user.id,body:body.trim(),chapter:chapter||null,page:page||null});
  if(r.error)fail(r.error,'Could not save note');
}

export async function saveQuote(clubBookId:string,quoteText:string,note?:string,chapter?:number,page?:number){
  if(!supabase)throw new Error('Supabase unavailable');
  const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('You must be signed in');
  const r=await supabase.from('saved_quotes').insert({club_book_id:clubBookId,user_id:user.id,quote_text:quoteText.trim(),note:note?.trim()||null,chapter:chapter||null,page:page||null});
  if(r.error)fail(r.error,'Could not save quote');
}

export async function deleteMargin(kind:'note'|'quote',id:string){
  if(!supabase)return;
  const r=await supabase.from(kind==='note'?'private_notes':'saved_quotes').delete().eq('id',id);
  if(r.error)fail(r.error,'Could not delete item');
}

export async function finishClubBook(clubBookId:string){
  if(!supabase)throw new Error('Supabase unavailable');const r=await supabase.rpc('finish_club_book',{target_club_book_id:clubBookId});if(r.error)fail(r.error,'Could not move this book to ratings');void trackEvent('book_finished',{clubBookId});
}
export async function saveClubRating(clubBookId:string,rating:number,review='',recommend?:boolean){
  if(!supabase)throw new Error('Supabase unavailable');const r=await supabase.rpc('save_club_book_rating',{target_club_book_id:clubBookId,target_rating:rating,target_review:review||null,target_recommend:recommend??null});if(r.error)fail(r.error,'Could not save rating');void trackEvent('book_rated',{clubBookId,rating});
}
export async function archiveClubBook(clubBookId:string){
  if(!supabase)throw new Error('Supabase unavailable');const r=await supabase.rpc('archive_club_book',{target_club_book_id:clubBookId});if(r.error)fail(r.error,'Could not archive book');void trackEvent('book_archived',{clubBookId});return r.data;
}
export async function restoreArchivedBook(clubBookId:string){
  if(!supabase)throw new Error('Supabase unavailable');
  const r=await supabase.rpc('restore_archived_book',{target_club_book_id:clubBookId});
  if(r.error){
    const missingRpc=r.error.code==='PGRST202'||/restore_archived_book|schema cache|could not find the function/i.test(r.error.message||'');
    if(!missingRpc)fail(r.error,'Could not restore this book');
    const lookup=await supabase.from('club_books').select('id,club_id,status').eq('id',clubBookId).maybeSingle();
    if(lookup.error||!lookup.data)throw new Error('Could not restore this book.');
    const updateBook=await supabase.from('club_books').update({status:'rating'}).eq('id',clubBookId);
    if(updateBook.error)throw new Error('Could not restore this book.');
    const updateClub=await supabase.from('clubs').update({status:'rating'}).eq('id',(lookup.data as any).club_id);
    if(updateClub.error)throw new Error('The book was restored. Refresh the club to continue.');
  }
  void trackEvent('book_archive_undone',{clubBookId});
}

export async function updateProfileBasics(userId:string,displayName:string,username:string){
  if(!supabase)throw new Error('Supabase unavailable');const r=await supabase.from('profiles').update({display_name:displayName.trim(),username:username.trim()||null,updated_at:new Date().toISOString()}).eq('id',userId).select('id').single();if(r.error)fail(r.error,'Could not save profile');
}
export async function updateNotificationMode(userId:string,mode:string){
  if(!supabase)throw new Error('Supabase unavailable');const r=await supabase.from('user_preferences').upsert({user_id:userId,notification_mode:mode,updated_at:new Date().toISOString()},{onConflict:'user_id'});if(r.error)fail(r.error,'Could not save notification preference');
}
export async function deleteMyAccount(){
  if(!supabase)throw new Error('Supabase unavailable');const r=await supabase.rpc('delete_my_account');if(r.error)fail(r.error,'Could not delete account');await supabase.auth.signOut();
}


export async function getNotifications(userId:string):Promise<AppNotification[]> {
  if(!supabase)return[];
  const r=await supabase.from('notifications').select('*').eq('user_id',userId).order('created_at',{ascending:false}).limit(100);
  if(r.error)fail(r.error,'Could not load notifications');
  const rows=r.data||[];
  const clubIds=[...new Set(rows.map((x:any)=>x.club_id).filter(Boolean))] as string[];
  const coverByClub=new Map<string,string>();
  if(clubIds.length){
    const books=await supabase.from('club_books').select('club_id,status,created_at,books(cover_url)').in('club_id',clubIds).order('created_at',{ascending:false});
    if(!books.error){
      const priority=['reading','acquiring','up_next','planning','planning_meeting','meeting','rating'];
      for(const clubId of clubIds){
        const candidates=(books.data||[]).filter((x:any)=>x.club_id===clubId);
        const picked=candidates.find((x:any)=>priority.includes(x.status))||candidates[0];
        const related:any=picked?.books;const cover=Array.isArray(related)?related[0]?.cover_url:related?.cover_url;
        if(cover)coverByClub.set(clubId,cover);
      }
    }
  }
  return rows.map((x:any)=>({id:x.id,clubId:x.club_id||undefined,type:x.type,title:x.title,body:x.body||undefined,deepLink:x.deep_link||undefined,readAt:x.read_at||undefined,createdAt:x.created_at,bookCoverUrl:x.club_id?coverByClub.get(x.club_id):undefined}));
}
export async function markNotificationRead(id:string){
  if(!supabase)return;const r=await supabase.from('notifications').update({read_at:new Date().toISOString()}).eq('id',id);if(r.error)fail(r.error,'Could not mark notification read');
}
export async function markAllNotificationsRead(userId:string){
  if(!supabase)return;const r=await supabase.from('notifications').update({read_at:new Date().toISOString()}).eq('user_id',userId).is('read_at',null);if(r.error)fail(r.error,'Could not mark notifications read');
}

export async function getNotificationMode(userId:string){
  if(!supabase)return 'essential';
  const r=await supabase.from('user_preferences').select('notification_mode').eq('user_id',userId).maybeSingle();
  if(r.error&&r.error.code!=='PGRST116')fail(r.error,'Could not load notification preference');
  return (r.data as any)?.notification_mode||'essential';
}

export async function getMyExportData(userId:string){
  if(!supabase)throw new Error('Supabase unavailable');
  const memberships=await supabase.from('club_members').select('club_id,role,joined_at').eq('user_id',userId);
  if(memberships.error)fail(memberships.error,'Could not export memberships');
  const clubIds=(memberships.data||[]).map((x:any)=>x.club_id);
  const [profile,prefs,personalBooks,posts,replies,notes,quotes,ratings,rsvps,clubs]=await Promise.all([
    supabase.from('profiles').select('id,display_name,username,avatar_url,profile_style,created_at,updated_at').eq('id',userId).maybeSingle(),
    supabase.from('user_preferences').select('*').eq('user_id',userId).maybeSingle(),
    supabase.from('personal_books').select('*,books(title,author,isbn13,cover_url)').eq('user_id',userId),
    supabase.from('posts').select('id,club_book_id,post_type,body,spoiler_chapter,locked,created_at,edited_at').eq('user_id',userId),
    supabase.from('replies').select('id,post_id,body,created_at').eq('user_id',userId),
    supabase.from('private_notes').select('*').eq('user_id',userId),
    supabase.from('saved_quotes').select('*').eq('user_id',userId),
    supabase.from('book_ratings').select('*').eq('user_id',userId),
    supabase.from('meeting_rsvps').select('*').eq('user_id',userId),
    clubIds.length?supabase.from('clubs').select('id,name,status,accent_palette,created_at').in('id',clubIds):Promise.resolve({data:[],error:null} as any),
  ]);
  const results=[profile,prefs,personalBooks,posts,replies,notes,quotes,ratings,rsvps,clubs] as any[];
  const firstError=results.find(x=>x.error)?.error;if(firstError)fail(firstError,'Could not export your data');
  return {
    exportedAt:new Date().toISOString(),
    profile:profile.data||null,
    preferences:prefs.data||null,
    memberships:memberships.data||[],
    clubs:clubs.data||[],
    personalBooks:personalBooks.data||[],
    posts:posts.data||[],
    replies:replies.data||[],
    privateNotes:notes.data||[],
    savedQuotes:quotes.data||[],
    clubRatings:ratings.data||[],
    meetingRsvps:rsvps.data||[],
  };
}


export async function createOrGetInvite(clubId:string){
  if (import.meta.env.VITE_BACKEND === 'd1') return (await cloudApi.invite(clubId)).code;
  if(!supabase)throw new Error('Supabase unavailable');
  const {data,error}=await supabase.rpc('create_or_get_club_invite',{target_club_id:clubId});
  if(error)fail(error,'Could not create invite');
  return String(data||'');
}
export async function cancelMeeting(meetingId:string){
  if(!supabase)throw new Error('Supabase unavailable');
  const {error}=await supabase.rpc('cancel_club_meeting',{target_meeting_id:meetingId});
  if(error)fail(error,'Could not cancel meeting');
}
export async function saveMeetingQuestion(clubBookId:string,postId:string|undefined,body:string){
  if(!supabase)throw new Error('Supabase unavailable');
  const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('You must be signed in');
  const {error}=await supabase.from('meeting_questions').insert({club_book_id:clubBookId,user_id:user.id,body:body.trim(),post_id:postId||null});
  if(error)fail(error,'Could not add this to the meeting agenda');
  void trackEvent('meeting_agenda_item_saved',{clubBookId,postId});
}
export async function removeMeetingQuestion(id:string){
  if(!supabase)return;const {error}=await supabase.from('meeting_questions').delete().eq('id',id);if(error)fail(error,'Could not remove agenda item');
}
export async function resolveMeetingQuestion(id:string,resolved=true){
  if(!supabase)return;const {error}=await supabase.from('meeting_questions').update({resolved}).eq('id',id);if(error)fail(error,'Could not update agenda item');
}
export async function getClubArchive(clubId:string){
  if(!supabase)return[];
  const booksResult=await supabase.from('club_books').select('id,status,created_at,books(*)').eq('club_id',clubId).in('status',['finished','archived']).order('created_at',{ascending:false});
  if(booksResult.error)fail(booksResult.error,'Could not load club archive');
  const rows=booksResult.data||[],bookIds=rows.map((x:any)=>x.id);
  if(!bookIds.length)return[];
  const ratingsResult=await supabase.from('book_ratings').select('club_book_id,user_id,rating,review,recommend,submitted_at').in('club_book_id',bookIds);
  if(ratingsResult.error)fail(ratingsResult.error,'Could not load club ratings');
  const ratings=ratingsResult.data||[],userIds=[...new Set(ratings.map((x:any)=>x.user_id).filter(Boolean))] as string[];
  let names=new Map<string,string>();
  if(userIds.length){
    const profilesResult=await supabase.from('profiles').select('id,display_name').in('id',userIds);
    if(!profilesResult.error)names=new Map((profilesResult.data||[]).map((x:any)=>[x.id,x.display_name||'Reader']));
  }
  return rows.map((x:any)=>({id:x.id,status:x.status,createdAt:x.created_at,book:bookFrom(x.books),ratings:ratings.filter((r:any)=>r.club_book_id===x.id).map((r:any)=>({rating:Number(r.rating),review:r.review||undefined,recommend:r.recommend??undefined,submittedAt:r.submitted_at,displayName:names.get(r.user_id)||'Reader'}))}));
}
export async function getUnreadNotificationCount(userId:string){
  if(!supabase)return 0;const {count,error}=await supabase.from('notifications').select('id',{count:'exact',head:true}).eq('user_id',userId).is('read_at',null);if(error)return 0;return count||0;
}

export type ReadingPreferences={avoidances:string[];moods:string[]};
export async function getReadingPreferences(userId:string):Promise<ReadingPreferences>{
  if(!supabase)return{avoidances:[],moods:[]};
  const r=await supabase.from('user_preferences').select('reading_avoidances,reading_moods').eq('user_id',userId).maybeSingle();
  if(r.error&&r.error.code!=='PGRST116')fail(r.error,'Could not load recommendation preferences');
  return{avoidances:(r.data as any)?.reading_avoidances||[],moods:(r.data as any)?.reading_moods||[]};
}
export async function updateReadingPreferences(userId:string,prefs:ReadingPreferences){
  if(!supabase)throw new Error('Supabase unavailable');
  const r=await supabase.from('user_preferences').upsert({user_id:userId,reading_avoidances:prefs.avoidances,reading_moods:prefs.moods,updated_at:new Date().toISOString()},{onConflict:'user_id'});
  if(r.error)fail(r.error,'Could not save recommendation preferences');
}

export async function previewClubInvite(code:string){
  if (import.meta.env.VITE_BACKEND === 'd1') return await cloudApi.previewInvite(code.trim().split('/').filter(Boolean).pop() || code);
  if(!supabase)throw new Error('Supabase unavailable');
  const clean=code.trim().split('/').filter(Boolean).pop()||code;
  const r=await supabase.rpc('preview_club_invite',{supplied_invite_code:clean});
  if(r.error)fail(r.error,'This invite is no longer available');
  return r.data as any;
}
export async function getClubInvites(clubId:string){
  if(!supabase)return[];
  const r=await supabase.from('club_invites').select('id,code,expires_at,revoked_at,created_at').eq('club_id',clubId).order('created_at',{ascending:false});
  if(r.error)fail(r.error,'Could not load invite links');
  return r.data||[];
}
export async function resetClubInvite(clubId:string){
  if (import.meta.env.VITE_BACKEND === 'd1') return (await cloudApi.resetInvite(clubId)).code;
  if(!supabase)throw new Error('Supabase unavailable');
  const r=await supabase.rpc('reset_club_invite',{target_club_id:clubId});
  if(r.error)fail(r.error,'Could not reset invite link');
  return String(r.data||'');
}
export async function disableClubInvites(clubId:string){
  if (import.meta.env.VITE_BACKEND === 'd1') { await cloudApi.disableInvites(clubId); return; }
  if(!supabase)throw new Error('Supabase unavailable');
  const r=await supabase.rpc('disable_club_invites',{target_club_id:clubId});
  if(r.error)fail(r.error,'Could not disable invite links');
}
export async function getSharedMemberProfile(clubId:string,memberId:string){
  if(!supabase)throw new Error('Supabase unavailable');
  const r=await supabase.rpc('get_shared_member_profile',{target_club_id:clubId,target_user_id:memberId});
  if(!r.error)return r.data as any;
  const missingRpc=r.error.code==='PGRST202'||/get_shared_member_profile|schema cache|could not find the function/i.test(r.error.message||'');
  if(!missingRpc)fail(r.error,'Could not load member profile');
  const membership=await supabase.from('club_members').select('user_id').eq('club_id',clubId).eq('user_id',memberId).maybeSingle();
  if(membership.error||!membership.data)throw new Error('This reader is not available in this club.');
  const [profileResult,booksResult]=await Promise.all([
    supabase.from('profiles').select('id,display_name,username,avatar_url,profile_style').eq('id',memberId).maybeSingle(),
    supabase.from('personal_books').select('id,shelf,rating,date_finished,is_favorite,is_public,books(*)').eq('user_id',memberId).eq('is_public',true),
  ]);
  if(profileResult.error)fail(profileResult.error,'Could not load member profile');
  if(booksResult.error)fail(booksResult.error,'Could not load shared books');
  const p:any=profileResult.data;
  return {profile:p?{id:p.id,displayName:p.display_name||'Reader',username:p.username||undefined,avatarUrl:profileAvatar(p),style:p.profile_style||undefined}:null,books:(booksResult.data||[]).map((x:any)=>({id:x.id,shelf:x.shelf,rating:x.rating?Number(x.rating):undefined,dateFinished:x.date_finished||undefined,isFavorite:Boolean(x.is_favorite),book:bookFrom(x.books)}))};
}
export async function leaveClub(clubId:string){
  if(!supabase)throw new Error('Supabase unavailable');
  const r=await supabase.rpc('leave_club',{target_club_id:clubId});
  if(r.error)fail(r.error,'Could not leave club');
}
export async function removeClubMember(clubId:string,userId:string){
  if(!supabase)throw new Error('Supabase unavailable');
  const r=await supabase.rpc('remove_club_member',{target_club_id:clubId,target_user_id:userId});
  if(r.error)fail(r.error,'Could not remove member');
}
export async function transferClubOwnership(clubId:string,userId:string){
  if(!supabase)throw new Error('Supabase unavailable');
  const r=await supabase.rpc('transfer_club_ownership',{target_club_id:clubId,target_user_id:userId});
  if(r.error)fail(r.error,'Could not transfer ownership');
}

export type GoodreadsImportBook={
  title:string;author:string;isbn?:string;isbn13?:string;rating?:number;pages?:number;year?:number;dateRead?:string;shelf:'read'|'currently_reading'|'want_to_read';cover?:string;
};
export type GoodreadsImportPreview={total:number;read:number;currentlyReading:number;wantToRead:number;rated:number;samples:GoodreadsImportBook[]};
export type GoodreadsImportResult=GoodreadsImportPreview&{imported:number};

function parseCsvDocument(text:string){
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;continue}
      if(ch==='"'){quoted=false;continue}
      cell+=ch;continue;
    }
    if(ch==='"'){quoted=true;continue}
    if(ch===','){row.push(cell);cell='';continue}
    if(ch==='\n'||ch==='\r'){
      if(ch==='\r'&&text[i+1]==='\n')i++;
      row.push(cell);cell='';
      if(row.some(value=>value.trim()!==''))rows.push(row);
      row=[];continue;
    }
    cell+=ch;
  }
  if(cell.length||row.length){row.push(cell);if(row.some(value=>value.trim()!==''))rows.push(row)}
  if(quoted)throw new Error('This CSV looks incomplete. Export a fresh Goodreads library file and try again.');
  return rows;
}
function cleanGoodreadsIsbn(value?:string){const cleaned=(value||'').replace(/[="']/g,'').replace(/[^0-9Xx]/g,'').toUpperCase();return cleaned.length===10||cleaned.length===13?cleaned:undefined}
function goodreadsPreviewCover(isbn?:string){return isbn?`https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-L.jpg?default=false`:undefined}
function isLowQualityStoredCover(value?:string|null){const url=String(value||'').toLowerCase();return !url||url.includes('covers.openlibrary.org')||/(placeholder|no[-_ ]?cover|default[-_ ]?cover|nocover)/.test(url)}
function normalizeGoodreadsShelf(value?:string):GoodreadsImportBook['shelf']{
  const shelf=(value||'').toLowerCase();
  if(/(^|[,;\s])currently-reading($|[,;\s])/.test(shelf))return'currently_reading';
  if(/(^|[,;\s])read($|[,;\s])/.test(shelf))return'read';
  return'want_to_read';
}
function normalizeGoodreadsDate(value?:string){
  const raw=(value||'').trim();if(!raw)return undefined;
  const m=raw.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:raw;
}
function parseGoodreadsText(text:string):GoodreadsImportBook[]{
  const matrix=parseCsvDocument(text.replace(/^\uFEFF/,''));
  if(matrix.length<2)throw new Error('No Goodreads books were found in this file.');
  const headers=matrix[0].map(x=>x.trim()),required=['Title','Author'];
  const goodreadsSignals=['Book Id','Exclusive Shelf','Bookshelves','My Rating','Date Added'];
  if(required.some(name=>!headers.includes(name))||!goodreadsSignals.some(name=>headers.includes(name)))throw new Error('This does not look like a Goodreads library export. Choose the CSV downloaded from Goodreads.');
  const idx=(name:string)=>headers.indexOf(name);
  return matrix.slice(1).map(values=>{
    const get=(name:string)=>{const i=idx(name);return i>=0?(values[i]||'').trim():''};
    const title=get('Title'),author=get('Author')||'Unknown author';
    if(!title)return null;
    const isbn13=cleanGoodreadsIsbn(get('ISBN13')),isbn=cleanGoodreadsIsbn(get('ISBN')),preferredIsbn=isbn13||isbn;
    const rawRating=Number(get('My Rating')),rating=rawRating>=1&&rawRating<=5?rawRating:undefined;
    const pagesRaw=Number(get('Number of Pages')),yearRaw=Number(get('Year Published')||get('Original Publication Year'));
    return {title,author,isbn,isbn13,rating,pages:pagesRaw>0?pagesRaw:undefined,year:yearRaw>0?yearRaw:undefined,dateRead:normalizeGoodreadsDate(get('Date Read')),shelf:normalizeGoodreadsShelf(get('Exclusive Shelf')||get('Bookshelves')),cover:goodreadsPreviewCover(preferredIsbn)} as GoodreadsImportBook;
  }).filter((row):row is GoodreadsImportBook=>Boolean(row));
}
function summarizeGoodreads(rows:GoodreadsImportBook[]):GoodreadsImportPreview{
  return {total:rows.length,read:rows.filter(x=>x.shelf==='read').length,currentlyReading:rows.filter(x=>x.shelf==='currently_reading').length,wantToRead:rows.filter(x=>x.shelf==='want_to_read').length,rated:rows.filter(x=>x.rating!=null).length,samples:rows.slice(0,6)};
}
export async function previewGoodreadsImport(file:File):Promise<GoodreadsImportPreview>{
  if(!/\.csv$/i.test(file.name)&&file.type&&!/csv/i.test(file.type))throw new Error('Choose a Goodreads CSV file.');
  const rows=parseGoodreadsText(await file.text()), preview=summarizeGoodreads(rows);
  const covers=await resolveGoodreadsImportCovers(preview.samples);
  return {...preview,samples:preview.samples.map((book,index)=>({...book,cover:covers.get(index)||book.cover}))};
}

async function resolveGoodreadsImportCovers(rows:GoodreadsImportBook[]){
  const results=new Map<number,string|undefined>();
  let next=0;
  const workers=Array.from({length:Math.min(8,rows.length)},async()=>{
    while(next<rows.length){
      const index=next++;
      const item=rows[index],preferredIsbn=item.isbn13||item.isbn;
      try{
        const resolved=await Promise.race([
          resolveBookCover({title:item.title,author:item.author,isbn:preferredIsbn}),
          new Promise<null>(resolve=>setTimeout(()=>resolve(null),6500)),
        ]);
        if(resolved?.url){results.set(index,resolved.url);continue}
        const simplifiedTitle=item.title.replace(/\s*\([^)]*\)/g,'').replace(/\s+/g,' ').trim();
        const retry= simplifiedTitle!==item.title ? await resolveBookCover({title:simplifiedTitle,author:item.author,isbn:preferredIsbn}) : null;
        results.set(index,retry?.url||item.cover);
      }catch{results.set(index,item.cover)}
    }
  });
  await Promise.all(workers);
  return results;
}

export async function importGoodreads(userId:string,file:File,onProgress?:(done:number,total:number)=>void):Promise<GoodreadsImportResult>{
  const sb=supabase;if(!sb)throw new Error('Supabase unavailable');
  const rows=parseGoodreadsText(await file.text()),summary=summarizeGoodreads(rows);let imported=0;
  const resolvedCovers=await resolveGoodreadsImportCovers(rows);
  for(let index=0;index<rows.length;index++){
    const item=rows[index];
    const preferredIsbn=item.isbn13||item.isbn;
    const importCover=resolvedCovers.get(index)||item.cover;
    const bookId=await ensureBook({title:item.title,author:item.author,isbn:preferredIsbn,pages:item.pages,year:item.year,cover:importCover});
    if(importCover){
      const current=await sb.from('books').select('cover_url').eq('id',bookId).maybeSingle();
      if(!current.error&&isLowQualityStoredCover(current.data?.cover_url))await sb.from('books').update({cover_url:importCover}).eq('id',bookId);
    }
    const existing=await sb.from('personal_books').select('id,rating,date_finished,is_favorite,is_public,source').eq('user_id',userId).eq('book_id',bookId).maybeSingle();
    if(existing.error&&existing.error.code!=='PGRST116')fail(existing.error,'Could not check your existing library');
    const now=new Date().toISOString();
    if(existing.data?.id){
      const patch:any={shelf:item.shelf,source:'goodreads',updated_at:now};
      if(item.rating!=null)patch.rating=item.rating;
      else if(existing.data.source==='goodreads')patch.rating=null;
      if(item.dateRead)patch.date_finished=item.dateRead;
      else if(existing.data.source==='goodreads')patch.date_finished=null;
      const updated=await sb.from('personal_books').update(patch).eq('id',existing.data.id).eq('user_id',userId);
      if(updated.error)fail(updated.error,'Could not update a Goodreads book');
    }else{
      const inserted=await sb.from('personal_books').insert({user_id:userId,book_id:bookId,shelf:item.shelf,rating:item.rating??null,date_finished:item.dateRead||null,source:'goodreads',is_favorite:false,updated_at:now});
      if(inserted.error)fail(inserted.error,'Could not import a Goodreads book');
    }
    imported++;onProgress?.(imported,rows.length);
  }
  void trackEvent('goodreads_import_completed',{imported});
  return {...summary,imported};
}

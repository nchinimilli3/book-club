import { supabase } from './supabase';
import { trackEvent } from './telemetry';
import type { Book, Club, ClubBook, Member, Profile, Thought, Workspace, Tone, Phase, ProfileStyle, Reply, Reaction, MarginItem, ClubRating, AppNotification, MeetingQuestion } from './model';

const toneMap: Record<string, Tone> = { pink:'rose', petal:'rose', rose:'rose', olive:'olive', butter:'gold', gold:'gold', lavender:'plum', plum:'plum', sky:'blue', blue:'blue', wine:'clay', clay:'clay' };
const phaseMap = (v?: string): Phase => (['setup','choosing','acquiring','reading','planning_meeting','meeting','rating','archived','paused'].includes(v || '') ? v : 'setup') as Phase;
const bookFrom = (b: any): Book => ({
  id: b.id,
  title: b.title,
  author: b.author || 'Unknown author',
  coverUrl: b.cover_url || '',
  description: b.description || '',
  pages: b.page_count || undefined,
  year: b.first_publish_year ?? b.published_year ?? undefined,
  isbn: b.isbn13 || undefined,
});

function fail(error: any, fallback: string): never {
  throw new Error(error?.message || fallback);
}

export async function getProfile(userId: string): Promise<Profile> {
  if (!supabase) return { id: userId, displayName: 'Reader' };
  const result = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (result.error) fail(result.error, 'Could not load profile');
  const x: any = result.data;
  return { id: userId, displayName: x?.display_name || 'Reader', username: x?.username || undefined, avatarUrl: x?.avatar_url || undefined, style: x?.profile_style || undefined };
}

export async function getMyClubs(userId: string) {
  if (!supabase) return { clubs: [] as Club[] };
  const [clubResult, prefResult] = await Promise.all([
    supabase.from('club_members').select('role,clubs(*)').eq('user_id', userId),
    supabase.from('user_preferences').select('active_club_id').eq('user_id', userId).maybeSingle(),
  ]);
  if (clubResult.error) fail(clubResult.error, 'Could not load clubs');
  // Existing users from before user_preferences was added may legitimately have no row.
  if (prefResult.error && prefResult.error.code !== 'PGRST116') fail(prefResult.error, 'Could not load active club preference');
  const clubs = (clubResult.data || []).filter((x: any) => x.clubs).map((r: any) => ({
    id: r.clubs.id,
    name: r.clubs.name,
    ownerId: r.clubs.owner_id,
    tone: toneMap[r.clubs.accent_palette || r.clubs.palette] || 'rose',
    phase: phaseMap(r.clubs.status),
    inviteCode: r.clubs.invite_code,
    coverImageUrl: r.clubs.cover_image_url,
    memberCount: 0,
  }));
  return { clubs, activeClubId: prefResult.data?.active_club_id || clubs[0]?.id };
}

export async function setActiveClub(id: string) {
  if (!supabase) return;
  const { error } = await supabase.rpc('set_active_club', { target_club_id: id });
  if (error) fail(error, 'Could not save active club');
}

export async function createClub(name: string, tone: Tone) {
  if (!supabase) throw new Error('Supabase unavailable');
  const { data, error } = await supabase.rpc('create_club', { club_name: name, palette: tone === 'rose' ? 'petal' : tone, mark: '' });
  if (error) fail(error, 'Could not create club');
  void trackEvent('club_created',{clubId: typeof data==='string'?data:undefined});
  return typeof data === 'string' ? { id: data } : Array.isArray(data) ? data[0] : data;
}

export async function joinClub(code: string) {
  if (!supabase) throw new Error('Supabase unavailable');
  const clean = code.trim().split('/').filter(Boolean).pop() || code;
  const { data, error } = await supabase.rpc('join_club_by_invite', { supplied_invite_code: clean });
  if (error) fail(error, 'Could not join club');
  void trackEvent('club_joined',{clubId: typeof data==='string'?data:undefined});
  return typeof data === 'string' ? { id: data } : Array.isArray(data) ? data[0] : data;
}

export async function getWorkspace(clubId: string, userId: string): Promise<Workspace> {
  if (!supabase) throw new Error('Supabase unavailable');
  const clubResult = await supabase.from('clubs').select('*').eq('id', clubId).single();
  if (clubResult.error) fail(clubResult.error, 'Could not load club');
  const c: any = clubResult.data;

  const [memberResult, clubBookResult, meetingResult] = await Promise.all([
    supabase.from('club_members').select('role,user_id').eq('club_id', clubId),
    supabase.from('club_books').select('*,books(*)').eq('club_id', clubId).order('created_at', { ascending: false }),
    supabase.from('meetings').select('*,meeting_rsvps(response,user_id)').eq('club_id', clubId).neq('status','cancelled').order('starts_at', { ascending: true }),
  ]);
  if (memberResult.error) fail(memberResult.error, 'Could not load club members');
  if (clubBookResult.error) fail(clubBookResult.error, 'Could not load club books');
  if (meetingResult.error) fail(meetingResult.error, 'Could not load meetings');

  const memberRows: any[] = memberResult.data || [];
  const clubBooks: any[] = clubBookResult.data || [];
  const meetings: any[] = meetingResult.data || [];
  const memberIds = memberRows.map((m:any)=>m.user_id).filter(Boolean);
  const profileResult = memberIds.length ? await supabase.from('profiles').select('id,display_name,username,avatar_url').in('id', memberIds) : {data:[],error:null} as any;
  if (profileResult.error) fail(profileResult.error, 'Could not load member profiles');
  const profileMap = new Map((profileResult.data || []).map((p:any)=>[p.id,p]));
  const active = clubBooks.find((r: any) => ['acquiring','reading','planning','planning_meeting','meeting','rating','up_next'].includes(r.status));

  let thoughts: Thought[] = [];
  let checkpoints: any[] = [];
  let progress: any;
  let acquired = 0;
  let myClubRating: ClubRating | undefined;
  let memberProgressRows:any[]=[];
  let lockedPostCount = 0;
  let meetingQuestions: MeetingQuestion[] = [];

  if (active) {
    const [postResult, checkpointResult, progressResult, checkinResult, ratingResult, lockedResult, meetingQuestionResult] = await Promise.all([
      supabase.from('posts').select('*').eq('club_book_id', active.id).order('created_at', { ascending: false }).limit(50),
      supabase.from('reading_checkpoints').select('*').eq('club_book_id', active.id).order('due_at'),
      supabase.from('reading_progress').select('*').eq('club_book_id', active.id),
      supabase.from('book_checkins').select('*').eq('club_book_id', active.id),
      supabase.from('book_ratings').select('rating,review,recommend').eq('club_book_id',active.id).eq('user_id',userId).maybeSingle(),
      supabase.rpc('get_locked_post_count',{target_club_book_id:active.id}),
      supabase.from('meeting_questions').select('*').eq('club_book_id',active.id).eq('resolved',false).order('created_at'),
    ]);
    if (postResult.error) fail(postResult.error, 'Could not load discussion');
    if (checkpointResult.error) fail(checkpointResult.error, 'Could not load reading plan');
    if (progressResult.error) fail(progressResult.error, 'Could not load reading progress');
    if (checkinResult.error) fail(checkinResult.error, 'Could not load book check-ins');
    if (ratingResult.error && ratingResult.error.code !== 'PGRST116') fail(ratingResult.error, 'Could not load your rating');
    if (lockedResult.error) fail(lockedResult.error,'Could not load spoiler locks');
    if (meetingQuestionResult.error) fail(meetingQuestionResult.error,'Could not load meeting agenda');
    lockedPostCount=Number(lockedResult.data||0);
    meetingQuestions=(meetingQuestionResult.data||[]).map((x:any)=>{const mp:any=profileMap.get(x.user_id);return{id:x.id,postId:x.post_id||undefined,body:x.body,createdAt:x.created_at,addedBy:mp?{id:x.user_id,displayName:mp.display_name||'Reader',username:mp.username||undefined,avatarUrl:mp.avatar_url||undefined}:undefined}});
    if (ratingResult.data) myClubRating = { rating:Number((ratingResult.data as any).rating), review:(ratingResult.data as any).review || undefined, recommend:(ratingResult.data as any).recommend ?? undefined };

    const postRows:any[] = postResult.data || [];
    const postIds=postRows.map((x:any)=>x.id);
    let replyRows:any[]=[]; let reactionRows:any[]=[];
    if(postIds.length){
      const [replyResult,reactionResult]=await Promise.all([
        supabase.from('replies').select('*').in('post_id',postIds).order('created_at'),
        supabase.from('reactions').select('*').in('post_id',postIds).order('created_at'),
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
      author: profileMap.get(p.user_id) ? { id: p.user_id, displayName: (profileMap.get(p.user_id) as any).display_name || 'Reader', username: (profileMap.get(p.user_id) as any).username || undefined, avatarUrl: (profileMap.get(p.user_id) as any).avatar_url || undefined } : undefined,
      reactions: reactionRows.filter((r:any)=>r.post_id===p.id).map((r:any)=>({ id:r.id,postId:r.post_id,userId:r.user_id,reaction:r.reaction,createdAt:r.created_at })),
      replyItems: replyRows.filter((r:any)=>r.post_id===p.id).map((r:any)=>{const rp:any=profileMap.get(r.user_id);return { id:r.id,postId:r.post_id,userId:r.user_id,body:r.body,createdAt:r.created_at,author:rp?{id:r.user_id,displayName:rp.display_name||'Reader',username:rp.username||undefined,avatarUrl:rp.avatar_url||undefined}:undefined };}),
    }));
    checkpoints = (checkpointResult.data || []).map((x: any) => ({ id: x.id, dueAt: x.due_at, targetChapter: x.target_chapter || undefined, targetPage: x.target_page || undefined, label: x.label || undefined }));
    memberProgressRows=progressResult.data||[];
    const mine: any = memberProgressRows.find((p: any) => p.user_id === userId);
    progress = mine ? { chapter: mine.chapter || undefined, page: mine.page || undefined, percent: mine.percent != null ? Number(mine.percent) : undefined, status: mine.status ?? mine.participation_status, format: mine.format } : undefined;
    acquired = (checkinResult.data || []).filter((x: any) => x.status === 'acquired').length;
  }

  const members: Member[] = memberRows.map((m: any) => { const p:any=profileMap.get(m.user_id); const rp:any=memberProgressRows.find(x=>x.user_id===m.user_id); return { id: m.user_id, displayName: p?.display_name || 'Reader', username: p?.username || undefined, avatarUrl: p?.avatar_url || undefined, role: m.role, chapter:rp?.chapter||undefined, status:(rp?.status??rp?.participation_status)||undefined }; });
  const currentBook: ClubBook | undefined = active ? {
    id: active.id,
    clubId,
    book: bookFrom(active.books),
    status: active.status,
    startDate: active.start_date || active.started_at || undefined,
    targetFinishDate: active.target_finish_date || active.target_finish_at || undefined,
    totalChapters: active.total_chapters || undefined,
    totalPages: active.total_pages || undefined,
  } : undefined;

  const mtg = meetings.find((m: any) => new Date(m.starts_at).getTime() > Date.now() - 10800000) || meetings[0];
  const rawResponse = mtg?.meeting_rsvps?.find((r: any) => r.user_id === userId)?.response;
  const response = rawResponse === 'yes' ? 'going' : rawResponse === 'no' ? 'cant' : rawResponse;
  const meeting = mtg ? { id: mtg.id, startsAt: mtg.starts_at, meetingType: mtg.meeting_type, meetingUrl: mtg.meeting_url || mtg.join_url || undefined, response } : undefined;
  const archiveBooks = clubBooks.filter((r: any) => ['finished','archived'].includes(r.status)).map((r: any) => bookFrom(r.books));
  const ideaBooks: ClubBook[] = clubBooks.filter((r: any) => ['idea','nominated','ballot'].includes(r.status)).map((r: any) => {
    const suggested:any = r.created_by ? profileMap.get(r.created_by) : undefined;
    return { id: r.id, clubId, book: bookFrom(r.books), status: r.status, startDate: r.start_date || r.started_at || undefined, targetFinishDate: r.target_finish_date || r.target_finish_at || undefined, totalChapters: r.total_chapters || undefined, totalPages: r.total_pages || undefined, suggestedBy: r.created_by ? { id:r.created_by, displayName:suggested?.display_name || 'Reader', username:suggested?.username || undefined, avatarUrl:suggested?.avatar_url || undefined } : undefined };
  });

  return {
    club: { id: c.id, name: c.name, ownerId: c.owner_id, tone: toneMap[c.accent_palette || c.palette] || 'rose', phase: phaseMap(c.status), inviteCode: c.invite_code, coverImageUrl: c.cover_image_url, memberCount: members.length },
    members, currentBook, ideaBooks, meeting, thoughts: thoughts.map(t=>({...t,savedForMeeting:meetingQuestions.some(q=>q.postId===t.id)})), checkpoints, acquired, myProgress: progress, archiveBooks, myClubRating, lockedPostCount, meetingQuestions,
  };
}

export async function updateProgress(id: string, chapter?: number, status = 'reading', totalChapters?: number, page?: number, totalPages?: number) {
  if (!supabase) return;
  const percent = totalChapters && chapter != null ? Math.min(100, Math.max(0, Math.round(chapter / totalChapters * 100))) : totalPages && page != null ? Math.min(100, Math.max(0, Math.round(page / totalPages * 100))) : null;
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

export async function scheduleMeeting(clubId: string, clubBookId: string | undefined, _userId: string, startsAt: string, meetingType = 'facetime', meetingUrl?: string, meetingId?: string) {
  if (!supabase) throw new Error('Supabase unavailable');
  const {data,error}=await supabase.rpc('save_club_meeting',{target_club_id:clubId,target_club_book_id:clubBookId||null,target_meeting_id:meetingId||null,target_starts_at:startsAt,target_meeting_type:meetingType,target_meeting_url:meetingUrl||null});
  if(error) fail(error,'Could not save meeting');
  void trackEvent('meeting_scheduled',{clubId,clubBookId,meetingId:data||meetingId});
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

async function ensureBook(r: { title:string; author:string; cover?:string; year?:number; isbn?:string; pages?:number; description?:string }) {
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
    const base: any = { title: r.title, author: r.author || 'Unknown author', cover_url: r.cover || null, isbn13: r.isbn || null, page_count: r.pages || null, description: r.description || null };
    const result = await supabase.from('books').insert({ ...base, first_publish_year: r.year || null }).select('id').single();
    if (result.error) fail(result.error, 'Could not save book metadata');
    bookId = result.data.id;
  }
  return bookId;
}

export async function saveBookToClub(clubId: string, r: { title:string; author:string; cover:string; year?:number; isbn?:string; pages?:number; description?:string }) {
  if (!supabase) throw new Error('Supabase unavailable');
  const bookId = await ensureBook(r);
  const existing = await supabase.from('club_books').select('id,status').eq('club_id', clubId).eq('book_id', bookId).in('status', ['idea','nominated','ballot','up_next','acquiring','reading']).maybeSingle();
  if (existing.error && existing.error.code !== 'PGRST116') fail(existing.error, 'Could not check club ideas');
  if (existing.data?.id) return { bookId, clubBookId: existing.data.id, alreadySaved: true, status: existing.data.status };
  const { data: authData } = await supabase.auth.getUser();
  const withCreator:any = { club_id: clubId, book_id: bookId, status: 'idea', created_by: authData.user?.id || null };
  const result = await supabase.from('club_books').insert(withCreator).select('id').single();
  if (result.error) fail(result.error, 'Could not add book to club ideas');
  void trackEvent('club_idea_added',{clubId,clubBookId:result.data.id,bookId});
  return { bookId, clubBookId: result.data.id, alreadySaved: false, status: 'idea' };
}

export async function savePersonalBook(userId: string, r: { title:string; author:string; cover?:string; year?:number; isbn?:string; pages?:number; description?:string }, { shelf='want_to_read', rating, dateFinished, isFavorite=false, source='search' }: { shelf?:string; rating?:number; dateFinished?:string; isFavorite?:boolean; source?:'search'|'goodreads' } = {}) {
  if (!supabase) throw new Error('Supabase unavailable');
  const bookId = await ensureBook(r);
  const payload: any = { user_id: userId, book_id: bookId, shelf, rating: rating || null, date_finished: dateFinished || null, source, is_favorite: isFavorite, updated_at: new Date().toISOString() };
  const result = await supabase.from('personal_books').upsert(payload, { onConflict: 'user_id,book_id' });
  if (result.error) fail(result.error, 'Could not save personal book');
  void trackEvent('personal_book_saved',{bookId,shelf,isFavorite,source});
  return bookId;
}

export async function updatePersonalBook(userId: string, personalBookId: string, patch: { shelf?:string; rating?:number|null; dateFinished?:string|null; isFavorite?:boolean }) {
  if (!supabase) throw new Error('Supabase unavailable');
  const payload: any = { ...patch, updated_at: new Date().toISOString() };
  if ('dateFinished' in payload) { payload.date_finished = payload.dateFinished; delete payload.dateFinished; }
  if ('isFavorite' in payload) { payload.is_favorite = payload.isFavorite; delete payload.isFavorite; }
  const result = await supabase.from('personal_books').update(payload).eq('id', personalBookId).eq('user_id', userId);
  if (result.error) fail(result.error, 'Could not update book');
}

export async function updateProfileStyle(_userId: string, style: ProfileStyle): Promise<ProfileStyle> {
  if (!supabase) throw new Error('Supabase unavailable');
  const {data,error}=await supabase.rpc('save_my_profile_style_v3', { style_payload: style });
  if(error) fail(error,'Could not save profile design');
  return (data || style) as ProfileStyle;
}

export async function getBookContext(bookId: string, chapter?: number) {
  if (!supabase) return [];
  let q = supabase.from('book_context_items').select('*,context_sources(*)').eq('book_id', bookId).order('created_at');
  if (chapter != null) q = q.or(`spoiler_chapter.is.null,spoiler_chapter.lte.${chapter}`);
  const { data, error } = await q;
  if (error) fail(error, 'Could not load Reader’s Companion');
  return (data || []).map((x: any) => ({ ...x, kind: x.kind ?? x.type ?? 'context' }));
}

export async function getPersonalLibrary(userId: string) {
  if (!supabase) return [];
  const result = await supabase.from('personal_books').select('*,books(*)').eq('user_id', userId).order('date_finished', { ascending: false, nullsFirst: false });
  if (result.error) fail(result.error, 'Could not load personal library');
  return (result.data || []).map((r: any) => ({ id: r.id, shelf: r.shelf, rating: r.rating ? Number(r.rating) : undefined, dateFinished: r.date_finished || undefined, isPublic: r.is_public, isFavorite: Boolean(r.is_favorite), book: bookFrom(r.books) }));
}

export async function getBallot(clubId: string, userId: string) {
  if (!supabase) return null;
  const ballotResult = await supabase.from('ballots').select('*').eq('club_id', clubId).eq('status', 'open').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (ballotResult.error && ballotResult.error.code !== 'PGRST116') fail(ballotResult.error, 'Could not load ballot');
  const ballot: any = ballotResult.data;
  if (!ballot) return null;
  const [nomResult, voteResult] = await Promise.all([
    supabase.from('nominations').select('*,books(*)').eq('ballot_id', ballot.id),
    supabase.from('votes').select('nomination_id').eq('user_id', userId),
  ]);
  if (nomResult.error) fail(nomResult.error, 'Could not load ballot books');
  if (voteResult.error) fail(voteResult.error, 'Could not load your vote');
  return { ...ballot, nominations: (nomResult.data || []).map((n: any) => ({ id: n.id, note: n.note ?? n.why ?? '', book: bookFrom(n.books), voted: (voteResult.data || []).some((v: any) => v.nomination_id === n.id) })) };
}

export async function startBallotFromIdeas(clubId: string) {
  if (!supabase) throw new Error('Supabase unavailable');
  const {data,error} = await supabase.rpc('start_ballot_from_ideas', { target_club_id: clubId });
  if(error) fail(error,'Could not start vote');
  void trackEvent('ballot_started',{clubId,ballotId:data});
  return data;
}

export async function castVote(nominationId: string, _userId?: string) {
  if (!supabase) return;
  const result = await supabase.rpc('cast_ballot_vote', { target_nomination_id: nominationId });
  if (result.error) fail(result.error, 'Could not save vote');
  void trackEvent('ballot_vote_cast',{nominationId});
}

export async function finalizeBallot(ballotId: string) {
  if (!supabase) throw new Error('Supabase unavailable');
  const { data, error } = await supabase.rpc('finalize_ballot', { target_ballot_id: ballotId });
  if (error) fail(error, 'Could not finalize vote');
  void trackEvent('ballot_finalized',{ballotId,clubBookId:data});
  return data;
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
  return (r.data||[]).map((x:any)=>({id:x.id,clubId:x.club_id||undefined,type:x.type,title:x.title,body:x.body||undefined,deepLink:x.deep_link||undefined,readAt:x.read_at||undefined,createdAt:x.created_at}));
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
  const {data,error}=await supabase.from('club_books').select('id,status,created_at,books(*),book_ratings(rating,review,recommend,submitted_at,profiles(display_name))').eq('club_id',clubId).in('status',['finished','archived']).order('created_at',{ascending:false});
  if(error)fail(error,'Could not load club archive');
  return (data||[]).map((x:any)=>({id:x.id,status:x.status,createdAt:x.created_at,book:bookFrom(x.books),ratings:(x.book_ratings||[]).map((r:any)=>({rating:Number(r.rating),review:r.review||undefined,recommend:r.recommend??undefined,submittedAt:r.submitted_at,displayName:r.profiles?.display_name||'Reader'}))}));
}
export async function getUnreadNotificationCount(userId:string){
  if(!supabase)return 0;const {count,error}=await supabase.from('notifications').select('id',{count:'exact',head:true}).eq('user_id',userId).is('read_at',null);if(error)return 0;return count||0;
}

export async function importGoodreads(userId: string, file: File) {
  const sb = supabase;
  if (!sb) throw new Error('Supabase unavailable');
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('No Goodreads rows found');
  const parse = (line: string) => {
    const out: string[] = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) { const ch = line[i]; if (ch === '"') { if (q && line[i+1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; }
    out.push(cur); return out;
  };
  const headers = parse(lines[0]);
  const idx = (name: string) => headers.indexOf(name);
  const rows = lines.slice(1).map(parse);
  let imported = 0;
  for (const r of rows.slice(0, 1000)) {
    const title = r[idx('Title')], author = r[idx('Author')], isbn = (r[idx('ISBN13')] || r[idx('ISBN')] || '').replace(/[="']/g, ''), shelf = (r[idx('Exclusive Shelf')] || 'to-read').replace('to-read', 'want_to_read').replace('currently-reading', 'currently_reading'), rating = Number(r[idx('My Rating')]) || undefined, date = r[idx('Date Read')] || undefined;
    if (!title) continue;
    await savePersonalBook(userId, { title, author: author || 'Unknown author', isbn }, { shelf, rating, dateFinished: date, isFavorite: rating === 5, source: 'goodreads' });
    imported++;
  }
  void trackEvent('goodreads_import_completed',{imported});
  return imported;
}

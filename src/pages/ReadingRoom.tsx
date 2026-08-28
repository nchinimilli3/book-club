import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, CalendarDays, CalendarPlus, Camera, Check, ChevronRight, Clock3, Download, FileText, Heart, LockKeyhole, MessageCircle, Minus, Plus, Quote, Search, Share2, StickyNote, Trash2, Upload } from 'lucide-react';
import { useRouter } from '../lib/router';
import { useApp } from '../lib/AppContext';
import { createReply, createThought, deleteMargin, getBookContext, getMargins, removeMeetingQuestion, saveMeetingOptions, saveMeetingQuestion, savePrivateNote, saveQuote, setMeetingOptionResponse, submitMeetingPoll, toggleReaction, updateProgress } from '../lib/data';
import { beginCalendarConnect, getCalendarStatus, getReaderContext, removeReadingPlanFromCalendar, syncReadingPlanToCalendar, transcribePassage } from '../lib/api';
import { Modal } from '../components/Modal';
import { BookCover } from '../components/BookCover';
import { FeedbackMessage, PageState } from '../components/PageState';
import { DiscussionSkeleton } from '../components/Skeleton';
import type { MarginItem } from '../lib/model';
import { getKnownChapterCount } from '../lib/books';
import { DateTimePicker } from '../components/DateTimePicker';
import { formatMeetingDateTime } from '../lib/dateTime';
import { checkpointLabel, checkpointMeetingInputs, checkpointPrepPrompts, checkpointProgressPercent, checkpointReadingMeta, coverAccent, daysRemainingLabel, daysUntilDate, googleCheckpointHref, imageToDataUrl, readingPlanIcsHref } from '../features/reading-room/readingRoomUtils';

type Depth='short'|'medium'|'deep';
type ComposerType='thought'|'question'|'prediction';
type ReadingProgressMode='chapter'|'page';
export function ReadingRoom({clubId,clubBookId}:{clubId:string;clubBookId:string}){
  const a=useApp(),{navigate:nav}=useRouter(),w=a.workspace;
  const[tab,setTab]=useState<'discussion'|'context'|'calendar'|'notes'|'characters'>(()=>{const key=`bookclub:reading-tab:${clubBookId}`;const saved=sessionStorage.getItem(key);sessionStorage.removeItem(key);return saved==='discussion'||saved==='context'||saved==='notes'?saved:'calendar'});
  const[depth,setDepth]=useState<Depth>('short');
  const[context,setContext]=useState<any[]>([]);
  const[contextLoading,setContextLoading]=useState(false);
  const[contextError,setContextError]=useState('');
  const[contextRetry,setContextRetry]=useState(0);
  const[note,setNote]=useState('');
  const[composerType,setComposerType]=useState<ComposerType>('thought');
  const[posting,setPosting]=useState(false);
  const[agendaBusyId,setAgendaBusyId]=useState<string|null>(null);
  const[reactionOverrides,setReactionOverrides]=useState<Record<string,{mine:boolean;count:number}>>({});
  const[postError,setPostError]=useState('');
  const[replyingTo,setReplyingTo]=useState<string|null>(null);
  const[replyBody,setReplyBody]=useState('');
  const[margins,setMargins]=useState<MarginItem[]>([]);
  const[marginType,setMarginType]=useState<'note'|'quote'|null>(null);
  const[marginVisibility,setMarginVisibility]=useState<'private'|'club'>('private');
  const[marginBody,setMarginBody]=useState('');
  const[marginNote,setMarginNote]=useState('');
  const[marginPage,setMarginPage]=useState<number|undefined>();
  const[marginBusy,setMarginBusy]=useState(false);
  const[ocrBusy,setOcrBusy]=useState(false);
  const[notice,setNotice]=useState('');
  const composerRef=useRef<HTMLTextAreaElement|null>(null);
  useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(''),4000);return()=>window.clearTimeout(timer)},[notice]);
  useEffect(()=>{if(tab!=='calendar'||!w)return;const key=`bookclub:reading-focus:${clubBookId}`;const target=sessionStorage.getItem(key);sessionStorage.removeItem(key);if(target)requestAnimationFrame(()=>document.getElementById(target)?.scrollIntoView({behavior:'smooth',block:'center'}));else window.scrollTo({top:0,behavior:'smooth'})},[tab,w,clubBookId]);
  const[referenceOpen,setReferenceOpen]=useState(false);
  const[referenceQuery,setReferenceQuery]=useState('');
  const[sharePending,setSharePending]=useState(false);
  const sharePendingRef=useRef(false);
  const[progressOpen,setProgressOpen]=useState(false);
  const[progressMode,setProgressMode]=useState<ReadingProgressMode>('chapter');
  const[editChapter,setEditChapter]=useState(1),[editPage,setEditPage]=useState(1),[progressBusy,setProgressBusy]=useState(false);
  const[detectedChapters,setDetectedChapters]=useState(0);
  const[postChapter,setPostChapter]=useState<number|undefined>();
  const[roomAccent,setRoomAccent]=useState({accent:'#6f6652',soft:'#f1eadc',rgb:'111,102,82',colors:['#5f86a8','#8f719d','#c06c54','#c49c37']});
  const[meetingVoteOpen,setMeetingVoteOpen]=useState(false);
  const[pollOptions,setPollOptions]=useState<string[]>([]);
  const[checkpointVoteLabel,setCheckpointVoteLabel]=useState('');
  const[checkpointVoteId,setCheckpointVoteId]=useState<string|undefined>();
  const[voteBusy,setVoteBusy]=useState(false);
  const[pendingCheckpointOptionIds,setPendingCheckpointOptionIds]=useState<Set<string>>(()=>new Set());
  const[prepOpenId,setPrepOpenId]=useState<string|null>(null);
  const[calendarConfigured,setCalendarConfigured]=useState(false),[calendarConnected,setCalendarConnected]=useState(false),[planCalendarBusy,setPlanCalendarBusy]=useState(false),[planCalendarSynced,setPlanCalendarSynced]=useState(false);
  const cb=w?.currentBook;

  if(!w||!cb||cb.id!==clubBookId)return <div className="page"><PageState kind="error" title="This reading room isn’t available." action={<button className="primary" onClick={()=>nav(clubId?`/clubs/${clubId}`:'/clubs')}>Back to club</button>}/></div>;
  const currentBook=cb,b=currentBook.book,chapter=w.myProgress?.chapter||0;
  const me=w.members.find(m=>m.id===a.user?.id);
  const canManage=w.club.ownerId===a.user?.id||me?.role==='admin'||me?.role==='owner';
  const totalPages=currentBook.totalPages||b.pages||0,totalChapters=currentBook.totalChapters||0,effectiveTotalChapters=totalChapters||detectedChapters||0;
  const readingPct=Math.max(0,Math.min(100,w.myProgress?.status==='finished'?100:w.myProgress?.percent??(effectiveTotalChapters&&chapter?chapter/effectiveTotalChapters*100:totalPages&&w.myProgress?.page?(w.myProgress.page/totalPages)*100:0)));
  const progressFormat=w.myProgress?.format;
  const readingPlace=w.myProgress?.status==='finished'?'Finished':progressFormat==='percent'&&w.myProgress?.percent!=null?`${Math.round(w.myProgress.percent)}%`:progressFormat==='page'&&w.myProgress?.page?`Page ${w.myProgress.page}`:progressFormat==='chapter'&&chapter?`Chapter ${chapter}`:w.myProgress?.percent!=null&&w.myProgress.percent>0?`${Math.round(w.myProgress.percent)}%`:w.myProgress?.page?`Page ${w.myProgress.page}`:chapter?`Chapter ${chapter}`:'Not started';
  useEffect(()=>{if(!effectiveTotalChapters&&progressMode==='chapter')setProgressMode('page')},[effectiveTotalChapters,progressMode]);

  useEffect(()=>{
    setEditChapter(w.myProgress?.chapter||1);setEditPage(w.myProgress?.page||1);
    setPostChapter(w.myProgress?.chapter||undefined);
    setProgressMode(w.myProgress?.format==='page'||(w.myProgress?.page&&!w.myProgress?.chapter)?'page':'chapter');
  },[currentBook.id,w.myProgress?.chapter,w.myProgress?.page,w.myProgress?.percent,w.myProgress?.format,readingPct]);

  useEffect(()=>{
    let cancelled=false;
    setDetectedChapters(0);
    if(totalChapters)return()=>{cancelled=true};
    void getKnownChapterCount({title:b.title,author:b.author,isbn:b.isbn}).then(count=>{if(!cancelled&&count)setDetectedChapters(count)});
    return()=>{cancelled=true};
  },[currentBook.id,totalChapters,b.title,b.author,b.isbn]);

  useEffect(()=>{
    let cancelled=false;
    void coverAccent(b.coverUrl||'',`${b.title} ${b.author}`).then(next=>{if(!cancelled)setRoomAccent(next)});
    return()=>{cancelled=true};
  },[b.coverUrl,b.title,b.author]);

  useEffect(()=>{let cancelled=false;void getCalendarStatus(currentBook.id).then(status=>{if(cancelled)return;setCalendarConfigured(Boolean(status.configured));setCalendarConnected(Boolean(status.connected));setPlanCalendarSynced(Boolean(status.planSynced))}).catch(()=>{if(!cancelled){setCalendarConfigured(false);setCalendarConnected(false)}});return()=>{cancelled=true}},[currentBook.id]);

  useEffect(()=>{
    let cancelled=false;
    setContextLoading(true);setContextError('');
    (async()=>{
      try{
        const cached=await getBookContext(b.id,chapter);
        if(cancelled)return;
        if(cached.length){setContext(cached);return}
        const generated=await getReaderContext({bookId:b.id,title:b.title,author:b.author,year:b.year,chapter});
        if(!cancelled)setContext(generated);
      }catch(err:any){if(!cancelled)setContextError('Context refresh is temporarily unavailable. Showing the book details we have.')}
      finally{if(!cancelled)setContextLoading(false)}
    })();
    return()=>{cancelled=true};
  },[b.id,b.title,b.author,b.year,chapter,contextRetry]);

  async function loadMargins(){if(a.user)try{setMargins(await getMargins(currentBook.id,a.user.id))}catch(err:any){setNotice(err?.message||'Could not load your margins.')}}
  useEffect(()=>{void loadMargins()},[currentBook.id,a.user?.id]);
  useEffect(()=>{const key=`bookclub:draft:${currentBook.id}`;const saved=sessionStorage.getItem(key);if(saved)setNote(saved)},[currentBook.id]);
  useEffect(()=>{const key=`bookclub:draft:${currentBook.id}`;if(note)sessionStorage.setItem(key,note);else sessionStorage.removeItem(key)},[currentBook.id,note]);

  const chars=context.filter(x=>String(x.kind).toLowerCase().includes('character'));
  // Keep other readers' future-chapter posts spoiler-safe, while always showing
  // the current reader the posts they just created.
  const visible=w.thoughts.filter(t=>!t.chapter||t.chapter<=chapter||t.userId===a.user?.id);
  const activeMeeting=w.meeting&&new Date(w.meeting.startsAt).getTime()+90*60*1000>Date.now()?w.meeting:null;
  const nextCheckpoint=w.checkpoints.find(c=>new Date(`${c.dueAt}T23:59:59`).getTime()>=Date.now())||w.checkpoints[0];
  const activeMeetingCheckpointId=activeMeeting?.checkpointId||null;
  const meetingOptionsByCheckpoint=new Map(w.checkpoints.map(c=>[c.id,w.meetingOptions.filter(option=>option.checkpointId===c.id)]));
  const autoSubmittedCheckpointRef=useRef<string|null>(null);
  useEffect(()=>{
    if(w.members.length!==1||activeMeeting)return;
    const candidate=w.checkpoints.map(c=>({checkpoint:c,options:meetingOptionsByCheckpoint.get(c.id)||[]})).find(x=>x.options.some(option=>option.myAvailable));
    if(!candidate||autoSubmittedCheckpointRef.current===candidate.checkpoint.id)return;
    autoSubmittedCheckpointRef.current=candidate.checkpoint.id;
    void submitCheckpointVote(candidate.checkpoint.id);
  },[w.members.length,activeMeeting?.id,w.meetingOptions.length,w.checkpoints.length]);
  const nextMeetingCheckpoint=nextCheckpoint;
  const referenceMatches=referenceQuery.trim()?context.filter(x=>`${x.title||''} ${x.summary_short||''} ${x.summary_medium||''}`.toLowerCase().includes(referenceQuery.trim().toLowerCase())).slice(0,4):[];
  const nonCharacterContext=context.filter(x=>!String(x.kind).toLowerCase().includes('character'));
  const fallbackContext=[
    b.description?{id:'catalog-overview',kind:'overview',title:'About this book',summary_short:b.description,summary_medium:b.description,summary_deep:b.description,context_sources:[]}:null,
    (b.year||b.pages)?{id:'catalog-details',kind:'metadata',title:'At a glance',summary_short:[b.year?`Published ${b.year}`:null,b.pages?`${b.pages} pages`:null,`Written by ${b.author}`].filter(Boolean).join(' · '),summary_medium:[b.year?`Published ${b.year}`:null,b.pages?`${b.pages} pages`:null,`Written by ${b.author}`].filter(Boolean).join(' · '),summary_deep:[b.year?`Published ${b.year}`:null,b.pages?`${b.pages} pages`:null,`Written by ${b.author}`].filter(Boolean).join(' · '),context_sources:[]}:null,
  ].filter(Boolean) as any[];
  const contextItems=nonCharacterContext.length?nonCharacterContext:fallbackContext;
  const hasDepthVariants=contextItems.some((x:any)=>{const short=String(x.summary_short||'').trim(),medium=String(x.summary_medium||'').trim(),deep=String(x.summary_deep||'').trim();return Boolean((medium&&medium!==short)||(deep&&deep!==medium&&deep!==short))});
  const planIcsHref=readingPlanIcsHref({clubName:w.club.name,bookTitle:b.title,checkpoints:w.checkpoints,finishDate:currentBook.targetFinishDate,meeting:activeMeeting?{id:activeMeeting.id,startsAt:activeMeeting.startsAt,meetingUrl:activeMeeting.meetingUrl}:undefined});
  const nextCheckpointGoogle=nextCheckpoint?googleCheckpointHref(`${b.title} · ${nextCheckpoint.targetChapter?`Through Chapter ${nextCheckpoint.targetChapter}`:nextCheckpoint.targetPage?`Through page ${nextCheckpoint.targetPage}`:'Reading checkpoint'}`,nextCheckpoint.dueAt,`${w.club.name} reading checkpoint`):'';

  async function syncPlanCalendar(){setPlanCalendarBusy(true);setNotice('');try{await syncReadingPlanToCalendar(currentBook.id);setPlanCalendarSynced(true);setNotice('Reading plan synced to Google Calendar.')}catch(err:any){setNotice(err?.message||'Could not sync the reading plan.')}finally{setPlanCalendarBusy(false)}}
  async function removePlanCalendar(){setPlanCalendarBusy(true);setNotice('');try{await removeReadingPlanFromCalendar(currentBook.id);setPlanCalendarSynced(false);setNotice('Reading plan removed from Google Calendar.')}catch(err:any){setNotice(err?.message||'Could not remove the reading plan from Google Calendar.')}finally{setPlanCalendarBusy(false)}}

  async function post(){
    if(!note.trim()||!a.user)return;
    setPosting(true);setPostError('');
    try{await createThought(currentBook.id,a.user.id,note.trim(),postChapter||undefined,composerType);setNote('');setComposerType('thought');await a.refresh()}
    catch(err:any){setPostError(err?.message||'Could not post your thought.')}
    finally{setPosting(false)}
  }
  async function reply(postId:string){if(!replyBody.trim())return;setPosting(true);setPostError('');try{await createReply(postId,replyBody);setReplyBody('');setReplyingTo(null);await a.refresh()}catch(err:any){setPostError(err?.message||'Could not post reply.')}finally{setPosting(false)}}
  async function react(postId:string){
    const source=w.thoughts.find(t=>t.id===postId);const hearts=(source?.reactions||[]).filter(r=>r.reaction==='heart');const current=reactionOverrides[postId]||{mine:hearts.some(r=>r.userId===a.user?.id),count:hearts.length};const next={mine:!current.mine,count:Math.max(0,current.count+(current.mine?-1:1))};
    setReactionOverrides(v=>({...v,[postId]:next}));
    try{await toggleReaction(postId,'heart');await a.refresh();setReactionOverrides(v=>{const copy={...v};delete copy[postId];return copy})}catch(err:any){setReactionOverrides(v=>({...v,[postId]:current}));setPostError(err?.message||'Could not save reaction.')}
  }
  function openMarginEditor(type:'note'|'quote'){
    setMarginType(type);setMarginVisibility('private');setMarginBody('');setMarginNote('');setMarginPage(undefined);
  }
  function closeMarginEditor(){setMarginType(null);setMarginVisibility('private');setMarginBody('');setMarginNote('');setMarginPage(undefined)}
  async function saveMargin(){
    if(!marginType||!marginBody.trim()||!a.user)return;
    const type=marginType,body=marginBody.trim(),noteText=marginNote.trim(),page=marginPage,visibility=marginVisibility,clubName=w?.club.name||'your club';
    setMarginBusy(true);
    try{
      // A margin always remains the reader's private source copy. Sharing creates an
      // explicit club-visible post; private tables are never exposed to other members.
      if(type==='note')await savePrivateNote(currentBook.id,body,chapter||undefined,page);
      else await saveQuote(currentBook.id,body,noteText,chapter||undefined,page);
      if(visibility==='club'){
        const pageSuffix=page?`\n\nPage ${page}`:'';
        const sharedBody=type==='quote'
          ? `${body}${noteText?`\n\n${noteText}`:''}${pageSuffix}`
          : `${body}${pageSuffix}`;
        await createThought(currentBook.id,a.user.id,sharedBody,chapter||undefined,type==='quote'?'quote':'thought');
        await a.refresh();
      }
      closeMarginEditor();await loadMargins();
      setNotice(visibility==='club'
        ? `${type==='note'?'Note':'Quote'} saved to your margins and shared with ${clubName}.`
        : `${type==='note'?'Note':'Quote'} saved privately.`);
    }catch(err:any){setNotice(err?.message||'Could not save.')}
    finally{setMarginBusy(false)}
  }
  async function captureMarginFile(file?:File){
    if(!file)return;
    if(file.type.startsWith('text/')||file.name.toLowerCase().endsWith('.txt')){
      setMarginBody(await file.text());
      setNotice('Text added from your upload.');
      return;
    }
    setOcrBusy(true);
    try{
      const imageDataUrl=await imageToDataUrl(file);
      const result=await transcribePassage({imageDataUrl,title:b.title,author:b.author,currentChapter:chapter||undefined});
      if(!result.text.trim())throw new Error('No readable text was found in that photo.');
      setMarginBody(result.text.trim());
      if(result.pageNumber)setMarginPage(result.pageNumber);
      setNotice(result.needsReview?'Text pulled in. Give it a quick review before saving.':'Passage added from your photo.');
    }catch(err:any){
      setNotice(err?.message||'Could not read that page yet.');
    }finally{setOcrBusy(false)}
  }
  async function removeMargin(item:MarginItem){try{await deleteMargin(item.kind,item.id);await loadMargins()}catch(err:any){setNotice(err?.message||'Could not delete this item.')}}
  async function saveReadingProgress(){
    setProgressBusy(true);
    try{
      await updateProgress(currentBook.id,progressMode==='chapter'?editChapter:undefined,'reading',effectiveTotalChapters||undefined,progressMode==='page'?editPage:undefined,totalPages||undefined,undefined);
      await a.refresh();setProgressOpen(false);setNotice('Reading progress updated.');
    }catch(err:any){setNotice(err?.message||'Could not update your progress.')}finally{setProgressBusy(false)}
  }
  async function toggleMeetingSave(postId:string,body:string,saved?:boolean){setAgendaBusyId(postId);try{if(saved){const q=w!.meetingQuestions.find(x=>x.postId===postId);if(q)await removeMeetingQuestion(q.id);setNotice('Removed from the meeting agenda.')}else{await saveMeetingQuestion(currentBook.id,postId,body);setNotice('Saved for the meeting.')}await a.refresh()}catch(err:any){setNotice(err?.message||'Could not update the meeting agenda.')}finally{setAgendaBusyId(null)}}
  function startCheckpointMeetingVote(checkpoint:{id:string;dueAt:string}){
    if(!canManage){
      setNotice('Only a club owner or admin can propose meeting times.');
      return;
    }
    setCheckpointVoteId(checkpoint.id);
    setCheckpointVoteLabel(checkpointLabel(checkpoint.dueAt));
    setPollOptions(checkpointMeetingInputs(checkpoint.dueAt));
    setMeetingVoteOpen(true);
  }
  async function saveCheckpointVote(){
    const valid=[...new Set(pollOptions.filter(Boolean))];
    if(valid.length<2){setNotice('Add at least two meeting times.');return;}
    setVoteBusy(true);
    try{
      await saveMeetingOptions(currentBook.clubId,currentBook.id,valid.map(x=>new Date(x).toISOString()),checkpointVoteId);
      await a.refresh();
      setMeetingVoteOpen(false);
      setNotice('Vote times are live for the group now.');
    }catch(err:any){
      setNotice(err?.message||'Could not save those meeting times.');
    }finally{
      setVoteBusy(false);
    }
  }
  async function toggleCheckpointVote(optionId:string,available:boolean){
    setPendingCheckpointOptionIds(prev=>new Set(prev).add(optionId));
    try{
      await setMeetingOptionResponse(optionId,available);
      await a.refresh();
      setNotice(available?'Your time vote was saved.':'Your time vote was removed.');
      const checkpoint=Array.from(meetingOptionsByCheckpoint.values()).flat().filter(option=>option.id===optionId)[0];
      const checkpointOptions=checkpoint?meetingOptionsByCheckpoint.get(checkpoint.checkpointId||'')||[]:[];
      if(available&&checkpointOptions.length>0&&((w?.members.length||0)===1||checkpointOptions.every(option=>option.id===optionId||option.myAvailable))) await submitCheckpointVote(checkpoint.checkpointId||'');
    }catch(err:any){
      setNotice(err?.message||'Could not save your vote.');
    }finally{setPendingCheckpointOptionIds(prev=>{const next=new Set(prev);next.delete(optionId);return next})}
  }
  async function submitCheckpointVote(checkpointId:string){
    setVoteBusy(true);
    try{
      const confirmed:any=await submitMeetingPoll(checkpointId);
      await a.refresh();
      setNotice(confirmed?.starts_at?'Everyone has responded — the meeting is confirmed.':'Availability submitted. The meeting confirms automatically after everyone responds.');
    }catch(err:any){
      setNotice(err?.message||'Could not submit your availability.');
    }finally{setVoteBusy(false)}
  }
  async function shareBook(){
    if(sharePendingRef.current)return;
    sharePendingRef.current=true;setSharePending(true);
    const data={title:b.title,text:`${b.title} by ${b.author}`,url:location.href};
    try{if(navigator.share)await navigator.share(data);else if(navigator.clipboard){await navigator.clipboard.writeText(location.href);setNotice('Reading room link copied.')}}
    catch(err:any){if(err?.name!=='AbortError'){try{await navigator.clipboard.writeText(location.href);setNotice('Reading room link copied.')}catch{setNotice('Sharing is unavailable right now.')}}}
    finally{sharePendingRef.current=false;setSharePending(false)}
  }

  const readingRoomStyle=({'--reading-cover':b.coverUrl?`url("${b.coverUrl.replace(/"/g,'%22')}")`:undefined,'--reading-accent':roomAccent.accent,'--reading-accent-soft':roomAccent.soft,'--reading-accent-rgb':roomAccent.rgb,'--reading-aura-1':roomAccent.colors[0],'--reading-aura-2':roomAccent.colors[1],'--reading-aura-3':roomAccent.colors[2],'--reading-aura-4':roomAccent.colors[3],'--reading-hero-wash':`linear-gradient(135deg, color-mix(in srgb, ${roomAccent.accent} 18%, white) 0%, color-mix(in srgb, ${roomAccent.accent} 10%, #f7f4ee) 38%, rgba(${roomAccent.rgb}, .16) 100%)`} as CSSProperties);

  return <div className={`page reading-room tone-${w.club.tone}`} style={readingRoomStyle}>
    <header className="reading-top"><button className="back-link" onClick={()=>nav(`/clubs/${w.club.id}`)}><ArrowLeft/> {w.club.name}</button><button className="icon-button" onClick={shareBook} disabled={sharePending} aria-busy={sharePending} aria-label="Share reading room"><Share2/></button></header>
    {notice&&<FeedbackMessage>{notice}</FeedbackMessage>}
    <section className="reading-cover-story"><div className="reading-copy"><p className="reading-club-label">{w.club.name} · current book</p><h1>{b.title}</h1><h2>{b.author}</h2><button type="button" className="position reading-position-control" onClick={()=>setProgressOpen(true)} aria-haspopup="dialog"><span className="position-copy"><span>Your place</span><b>{readingPlace} <span aria-hidden="true">⌄</span></b></span><i role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(readingPct)}><em style={{width:`${readingPct}%`}}/><u style={{left:`${readingPct}%`}}/></i></button></div><div className="reading-art"><BookCover className="main-cover" title={b.title} author={b.author} src={b.coverUrl}/></div></section>
    <nav className="reading-tabs" aria-label="Reading room">{(['calendar','discussion','context','notes'] as const).map(x=><button className={tab===x?'active':''} onClick={()=>setTab(x)} key={x}>{x==='context'?'Context':x==='calendar'?'Reading plan':x==='notes'?'My notes':'Discussion'}</button>)}</nav>

    {tab==='discussion'&&<section className="reading-section discussion-section"><header className="section-intro"><h2>Discussion</h2>{chapter>0&&<p>Through Chapter {chapter}</p>}</header>
      {w.lockedPostCount>0&&<button type="button" className="unlock-banner" onClick={()=>setProgressOpen(true)}><LockKeyhole/><span><b>{w.lockedPostCount} {w.lockedPostCount===1?'thought':'thoughts'} waiting for you</b></span></button>}
      <div className="reading-quick-tools"><button type="button" onClick={()=>{setComposerType('question');requestAnimationFrame(()=>{composerRef.current?.focus();composerRef.current?.scrollIntoView({behavior:'smooth',block:'center'})})}}><Search/> Ask about the book</button>{w.meetingQuestions.length>0&&<button type="button" onClick={()=>nav(`/clubs/${w.club.id}/books/${currentBook.id}/meeting`)}><MessageCircle/> {w.meetingQuestions.length} saved for the meeting</button>}</div>
      <div className="composer-inline">
        <div className="composer-types">{(['thought','question','prediction'] as ComposerType[]).map(x=><button type="button" key={x} className={composerType===x?'active':''} onClick={()=>setComposerType(x)}>{x[0].toUpperCase()+x.slice(1)}</button>)}</div>
        <textarea ref={composerRef} value={note} onChange={e=>setNote(e.target.value)} placeholder={composerType==='prediction'?'Make a prediction…':composerType==='question'?'What are you wondering?':postChapter?`A thought from Chapter ${postChapter}`:'Add a thought…'}/>
        <div className="composer-footer"><label className="composer-location"><span>Post at</span><span className="composer-chapter-input">Chapter <input aria-label="Chapter for this post" type="number" min="1" max={effectiveTotalChapters||undefined} value={postChapter||''} placeholder="—" onChange={e=>setPostChapter(Number(e.target.value)||undefined)}/>{effectiveTotalChapters?<small>of {effectiveTotalChapters}</small>:null}</span></label><span className="composer-seal">{composerType==='prediction'?'Sealed until meeting':''}</span><button className="primary" onClick={post} disabled={posting||!note.trim()}>{posting?'Posting…':'Post'}</button></div>{postError&&<p className="error-text">{postError}</p>}
      </div>
      <div className="thought-stream">{visible.map(t=>{
        const hearts=(t.reactions||[]).filter(r=>r.reaction==='heart');const override=reactionOverrides[t.id];const mine=override?.mine??hearts.some(r=>r.userId===a.user?.id);const heartCount=override?.count??hearts.length;
        return <article key={t.id} className={`thought thought-${t.type}${t.type==='prediction'&&!t.predictionRevealed?' sealed-prediction':''}`}><header><button type="button" className="thought-person" onClick={()=>nav(`/clubs/${w.club.id}/members/${t.userId}`)}><div className="person-dot">{t.author?.avatarUrl?<img src={t.author.avatarUrl} alt=""/>:t.author?.displayName?.slice(0,1)||'R'}</div><div><b>{t.author?.displayName||'Reader'}</b><span>{t.type==='prediction'?(t.predictionRevealed?'Prediction · revealed':'Prediction · sealed'):t.type==='question'?'Question':t.chapter?`Chapter ${t.chapter}`:'Open discussion'}</span></div></button></header>{t.type==='prediction'&&!t.predictionRevealed?<div className="sealed-note"><LockKeyhole/><b>Sealed until meeting mode</b><span>{t.chapter?`Chapter ${t.chapter}`:'Chapter not specified'}</span></div>:<p>{t.body}</p>}
          <div className="post-actions"><button type="button" className={mine?'active':''} aria-pressed={mine} onClick={()=>void react(t.id)}><Heart fill={mine?'currentColor':'none'}/> {heartCount||''}</button><button type="button" onClick={()=>{setReplyingTo(replyingTo===t.id?null:t.id);setReplyBody('')}}><MessageCircle/> Reply{t.replyItems?.length?` · ${t.replyItems.length}`:''}</button><button type="button" disabled={agendaBusyId===t.id} className={t.savedForMeeting?'active':''} onClick={()=>void toggleMeetingSave(t.id,t.body,t.savedForMeeting)}><StickyNote/> {agendaBusyId===t.id?'Saving…':t.savedForMeeting?'On agenda':'Add to agenda'}</button></div>
          {t.replyItems?.length?<div className="reply-list">{t.replyItems.map(r=><div key={r.id}><b>{r.author?.displayName||'Reader'}</b><p>{r.body}</p></div>)}</div>:null}
          {replyingTo===t.id&&<div className="reply-composer"><input value={replyBody} onChange={e=>setReplyBody(e.target.value)} placeholder="Write a reply" autoFocus/><button type="button" className="primary" disabled={!replyBody.trim()||posting} onClick={()=>reply(t.id)}>Reply</button></div>}
        </article>})}{!visible.length&&!posting&&<div className="context-empty"><MessageCircle/><h3>No thoughts yet.</h3></div>}</div>
    </section>}

    {tab==='context'&&<section className="reading-section context-section"><header className="section-intro split"><div><p className="context-kicker">About the book</p><h2>Context</h2></div>{hasDepthVariants&&<div className="depth-switch">{(['short','medium','deep'] as Depth[]).map(d=><button type="button" aria-pressed={depth===d} className={depth===d?'active':''} onClick={()=>setDepth(d)} key={d}>{d==='short'?'30 sec':d==='medium'?'2 min':'Deep dive'}</button>)}</div>}</header>{contextLoading?<div className="context-generation-notice"><span>Refreshing reader context…</span><button type="button" className="text-link" disabled aria-busy="true">Refreshing…</button></div>:contextError?<div className="context-generation-notice"><span>{contextError}</span><button type="button" className="text-link" onClick={()=>setContextRetry(x=>x+1)}>Try again</button></div>:null}<div className="context-list">{contextLoading&&!contextItems.length?<DiscussionSkeleton/>:contextItems.length?contextItems.map((x:any,i)=><article key={x.id||`${x.kind}-${i}`}><span>{String(i+1).padStart(2,'0')}</span><div><small>{String(x.kind||'context').replaceAll('_',' ')}</small><h3>{x.title}</h3><p>{depth==='short'?x.summary_short:depth==='medium'?(x.summary_medium||x.summary_short):(x.summary_deep||x.summary_medium||x.summary_short)}</p>{x.context_sources?.length>0&&<details><summary>Sources</summary>{x.context_sources.map((s:any)=><a href={s.source_url} target="_blank" rel="noreferrer" key={s.source_url}>{s.source_name||'Source'}</a>)}</details>}</div></article>):<div className="context-empty context-empty-designed"><Search/><h3>No context is available yet.</h3><p>We’ll keep the book details here while source-backed context is gathered.</p></div>}</div></section>}

    {tab==='calendar'&&<section className="reading-section calendar-section reading-plan-editorial">
      <header className="reading-plan-intro"><div><h2>{currentBook.targetFinishDate?`Finish by ${new Date(currentBook.targetFinishDate+'T12:00').toLocaleDateString('en-US',{month:'long',day:'numeric'})}`:'Set a finish target from the club home'}</h2></div></header>
      <div className="reading-plan-track" aria-label={`${Math.round(readingPct)} percent complete`}><i><em style={{width:`${readingPct}%`}}/><u style={{left:`${readingPct}%`}}/>{w.checkpoints.map(c=>{const pct=checkpointProgressPercent(c,effectiveTotalChapters,totalPages);return pct==null?null:<button type="button" key={c.id} className="reading-plan-checkpoint-dot" style={{left:`${pct}%`} as CSSProperties} onClick={()=>document.getElementById(`checkpoint-${c.id}`)?.scrollIntoView({behavior:'smooth',block:'center'})} aria-label={`Jump to ${c.label||(c.targetChapter?`Chapter ${c.targetChapter}`:c.targetPage?`page ${c.targetPage}`:'checkpoint')} on ${new Date(c.dueAt+'T12:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}`}/>})}</i><div><span>Start</span><span>{currentBook.targetFinishDate?new Date(currentBook.targetFinishDate+'T12:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):'Finish'}</span></div></div>
      <div className="reading-plan-tools"><div><span>Calendar</span><small>Add the reading plan to your calendar.</small></div><div className="reading-plan-calendar-actions">{calendarConfigured&&(calendarConnected?<><button type="button" className={`reading-plan-calendar-primary calendar-action-google ${planCalendarSynced?'synced':''}`} disabled={planCalendarBusy} onClick={()=>void syncPlanCalendar()}><CalendarPlus/><span>{planCalendarBusy?'Syncing…':planCalendarSynced?'Synced':'Sync Google Calendar'}</span></button></>:<button type="button" className="reading-plan-calendar-primary calendar-action-google" onClick={()=>void beginCalendarConnect()}><CalendarPlus/><span>Google Calendar</span></button>)}{nextCheckpointGoogle&&<a className="reading-plan-utility-link calendar-action-next" href={nextCheckpointGoogle} target="_blank" rel="noreferrer"><CalendarDays/><span>Next event</span></a>}<a className="reading-plan-utility-link calendar-action-apple" href={planIcsHref} download={`${b.title.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase()||'book'}-reading-plan.ics`}><Download/><span>Apple Calendar</span></a></div>{calendarConnected&&<button type="button" className="reading-plan-remove-calendar" disabled={planCalendarBusy} onClick={()=>void removePlanCalendar()}>Remove Google Calendar</button>}</div>
      {w.checkpoints.length?<ol className="reading-plan-milestones">{w.checkpoints.map((c,i)=>{
        const done=c.targetChapter?chapter>=c.targetChapter:c.targetPage?(w.myProgress?.page||0)>=c.targetPage:false;
        const target=c.targetChapter?`Through Chapter ${c.targetChapter}`:c.targetPage?`Through page ${c.targetPage}`:String(c.label||'').trim().toLowerCase()==='finish'&&totalPages?`Through Page ${totalPages}`:'Reading checkpoint';
        const normalize=(v:string)=>v.toLowerCase().replace(/[^a-z0-9]/g,'');
        const label=String(c.label||'').trim();
        const repeatsTarget=label&&normalize(label)===normalize(target);
        const checkpointOptions=meetingOptionsByCheckpoint.get(c.id)||[];
        const meetingForCheckpoint=activeMeeting?.checkpointId===c.id;
        const dueDays=daysUntilDate(c.dueAt),past=dueDays<0;
        const currentIndex=w.checkpoints.findIndex(cp=>cp.targetChapter?chapter<(cp.targetChapter||0):cp.targetPage?(w.myProgress?.page||0)>=0&&(w.myProgress?.page||0)<(cp.targetPage||0):false);
        const isCurrent=i===currentIndex;
        const meta=checkpointReadingMeta(c,w.checkpoints[i-1],effectiveTotalChapters,totalPages);
        const preview=[meta.pageRange,meta.readingTime].filter(Boolean).join(' · ')||'Spoiler-safe checkpoint. Plot details stay hidden until you reach it.';
        const selectedOptions=checkpointOptions.filter(option=>option.myAvailable);
        const prep=checkpointPrepPrompts(c,w.checkpoints[i-1]);
        const dueDate=new Date(`${c.dueAt}T00:00:00`); const monday=new Date(dueDate); monday.setDate(dueDate.getDate()-((dueDate.getDay()+6)%7)); monday.setHours(0,0,0,0);
        const canScheduleThisCheckpoint=canManage&&!activeMeeting&&c.id===nextMeetingCheckpoint?.id&&!checkpointOptions.length&&(i===0||Date.now()>=monday.getTime());
        return <li id={`checkpoint-${c.id}`} key={c.id} className={`${done?'complete ':''}${isCurrent?'current ':''}${past?'past ':'future '}${meetingForCheckpoint?'has-scheduled-meeting ':''}${c.id===nextCheckpoint?.id?'next-action':''}`.trim()}>
          <div className="checkpoint-date"><time>{new Date(c.dueAt+'T12:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</time><small>{daysRemainingLabel(dueDays)}</small></div>
          <span className="checkpoint-dot" aria-hidden="true"/>
          <div className="checkpoint-copy"><span className="checkpoint-title-with-tooltip" tabIndex={0} data-preview={preview}><b>{label&&!repeatsTarget?label:target}</b></span>{label&&!repeatsTarget&&<small>{target}</small>}{(meta.pageRange||meta.readingTime)&&<span className="checkpoint-reading-meta">{meta.pageRange&&<small>{meta.pageRange}</small>}{meta.readingTime&&<small>{meta.readingTime}</small>}</span>}{meetingForCheckpoint&&<small className="checkpoint-meeting">Scheduled · {formatMeetingDateTime(activeMeeting.startsAt)}</small>}{!meetingForCheckpoint&&checkpointOptions.length>0&&<small className="checkpoint-meeting"><Clock3/> Meeting poll open · pick what works</small>}{meetingForCheckpoint&&<button type="button" className={`checkpoint-prep-toggle ${prepOpenId===c.id?'open':''}`} onClick={()=>setPrepOpenId(v=>v===c.id?null:c.id)} aria-expanded={prepOpenId===c.id}><span>Meeting prep · 3 prompts</span><ChevronRight/></button>}</div>
          <div className="checkpoint-actions">{meetingForCheckpoint?<div className="checkpoint-scheduled"><span>{formatMeetingDateTime(activeMeeting.startsAt)}</span><button type="button" onClick={()=>nav(`/clubs/${w.club.id}/books/${currentBook.id}/meeting`)}>Open meeting room <span aria-hidden="true">→</span></button></div>:checkpointOptions.length?<><div className="checkpoint-vote-row">{checkpointOptions.map(option=>{const pending=pendingCheckpointOptionIds.has(option.id);return <button type="button" key={option.id} aria-pressed={option.myAvailable||pending} disabled={pending} className={`checkpoint-option-button ${option.myAvailable||pending?'selected':''}`} onClick={()=>void toggleCheckpointVote(option.id,!option.myAvailable)}><span className="checkpoint-option-heading"><b>{new Intl.DateTimeFormat('en-US',{weekday:'short'}).format(new Date(option.startsAt))}</b><small>{pending?'Saving…':`${option.availableCount} ${option.availableCount===1?'vote':'votes'}`}</small></span><span>{formatMeetingDateTime(option.startsAt,{weekday:undefined})}</span><small className="checkpoint-option-state">{pending?'Saving…':option.myAvailable?<><Check/> Your vote</>:<><Clock3/> Available?</>}</small></button>})}</div>{selectedOptions.length>0&&<p className="checkpoint-vote-confirmation"><Check/> <span><b>Your {selectedOptions.length===1?'vote':'picks'}:</b> {selectedOptions.map(option=>formatMeetingDateTime(option.startsAt,{weekday:'short',month:undefined,day:undefined})).join(' · ')}</span></p>}</>:canScheduleThisCheckpoint?<button type="button" className="checkpoint-meeting-button" onClick={()=>startCheckpointMeetingVote(c)}>Schedule meeting <span aria-hidden="true">→</span></button>:null}</div>
          {prepOpenId===c.id&&<div className="checkpoint-prep-panel"><header><span>Discussion prep</span><b>{c.targetChapter?`For Chapters ${(w.checkpoints[i-1]?.targetChapter||0)+1}–${c.targetChapter}`:c.targetPage?`Through page ${c.targetPage}`:'For this checkpoint'}</b></header><ol>{prep.map((prompt,index)=><li key={prompt}><span>0{index+1}</span><p>{prompt}</p></li>)}</ol></div>}
        </li>
      })}</ol>:<div className="reading-plan-empty"><CalendarDays/><div><h3>{currentBook.targetFinishDate?'One finish line, no forced checkpoints.':'No plan yet.'}</h3><p>{currentBook.targetFinishDate?'Your club can keep this plan simple or add checkpoints later.':'Set a finish date from the club home when everyone is ready.'}</p></div></div>}
      {activeMeeting&&!activeMeetingCheckpointId?<footer className="reading-plan-meeting scheduled-meeting-summary"><span>Next book club discussion</span><div><b>{formatMeetingDateTime(activeMeeting.startsAt,{weekday:'long',month:'long'})}</b><button type="button" onClick={()=>nav(`/clubs/${w.club.id}/books/${currentBook.id}/meeting`)}>Open meeting room <span aria-hidden="true">→</span></button></div></footer>:null}
    </section>}

    {tab==='notes'&&<section className="reading-section margins-section"><header className="section-intro split margins-heading"><div><h2>Your margins</h2></div><div className="margin-actions"><button type="button" onClick={()=>openMarginEditor('note')}><StickyNote/> Add note</button><button type="button" onClick={()=>openMarginEditor('quote')}><Quote/> Save quote</button><button type="button" onClick={()=>{setComposerType('prediction');setTab('discussion')}}>Prediction</button></div></header>{margins.length?<div className="margin-list">{margins.map(item=><article className="margin-note" key={`${item.kind}-${item.id}`}><span>{item.kind==='quote'?'Quote':'Note'}{item.chapter?` · Ch. ${item.chapter}`:''}{item.page?` · p. ${item.page}`:''}</span><p>{item.kind==='quote'?`“${item.body}”`:item.body}</p>{item.note&&<small>{item.note}</small>}<button type="button" className="margin-delete" onClick={()=>removeMargin(item)} aria-label="Delete"><Trash2/></button></article>)}</div>:<div className="context-empty margins-empty"><StickyNote/><h3>Your margins are empty.</h3></div>}</section>}

    {tab==='characters'&&<section className="reading-section"><header className="section-intro"><h2>Character map</h2></header>{chars.length?<div className="character-list">{chars.map((c:any)=><article key={c.id||c.title}><div className="character-monogram">{c.title.slice(0,1)}</div><div><h3>{c.title}</h3><p>{c.summary_short}</p></div></article>)}</div>:<div className="context-empty"><Search/><h3>Nothing to show yet.</h3></div>}</section>}

    <Modal open={progressOpen} onClose={()=>setProgressOpen(false)} title="Update reading progress" className="reading-progress-sheet">
      <div className="reading-progress-editor">
        <div className="progress-mode-switch">{(['chapter','page'] as ReadingProgressMode[]).map(x=><button type="button" key={x} aria-pressed={progressMode===x} className={progressMode===x?'selected':''} onClick={()=>setProgressMode(x)}>{x[0].toUpperCase()+x.slice(1)}</button>)}</div>
        {progressMode==='chapter'?<div className="progress-number-control"><div className="progress-control-heading"><span>Chapter</span>{effectiveTotalChapters?<small>of {effectiveTotalChapters} · {Math.round((Math.min(editChapter,effectiveTotalChapters)/effectiveTotalChapters)*100)}%</small>:<small>Enter the chapter you’re on</small>}</div><div className="progress-stepper"><button type="button" aria-label="Previous chapter" onClick={()=>setEditChapter(v=>Math.max(0,v-1))}><Minus/></button><input aria-label="Chapter progress" type="number" min="0" max={effectiveTotalChapters||undefined} value={editChapter} onChange={e=>setEditChapter(Math.max(0,Math.min(effectiveTotalChapters||9999,Number(e.target.value)||0)))}/><button type="button" aria-label="Next chapter" onClick={()=>setEditChapter(v=>Math.min(effectiveTotalChapters||9999,v+1))}><Plus/></button></div>{effectiveTotalChapters?<input aria-label="Chapter progress slider" className="progress-slider" type="range" min="0" max={effectiveTotalChapters} value={Math.min(editChapter,effectiveTotalChapters)} style={{'--progress-preview':`${Math.round((Math.min(editChapter,effectiveTotalChapters)/effectiveTotalChapters)*100)}%`} as CSSProperties} onChange={e=>setEditChapter(Number(e.target.value))}/>:null}</div>:<div className="progress-number-control"><div className="progress-control-heading"><span>Page</span>{totalPages?<small>of {totalPages} · {Math.round((Math.min(editPage,totalPages)/totalPages)*100)}%</small>:<small>Enter your page</small>}</div><div className="progress-stepper"><button type="button" aria-label="Previous page" onClick={()=>setEditPage(v=>Math.max(0,v-5))}><Minus/></button><input aria-label="Page progress" type="number" min="0" max={totalPages||undefined} value={editPage} onChange={e=>setEditPage(Math.max(0,Math.min(totalPages||99999,Number(e.target.value)||0)))}/><button type="button" aria-label="Next page" onClick={()=>setEditPage(v=>Math.min(totalPages||99999,v+5))}><Plus/></button></div>{totalPages?<input aria-label="Page progress slider" className="progress-slider" type="range" min="0" max={totalPages} value={Math.min(editPage,totalPages)} style={{'--progress-preview':`${Math.round((Math.min(editPage,totalPages)/totalPages)*100)}%`} as CSSProperties} onChange={e=>setEditPage(Number(e.target.value))}/>:null}</div>}
        <button type="button" className="primary full reading-progress-save" disabled={progressBusy} onClick={saveReadingProgress}>{progressBusy?'Saving…':'Save progress'}</button>
      </div>
    </Modal>
    <Modal open={Boolean(marginType)} onClose={closeMarginEditor} title={marginType==='quote'?'Save a quote':'Add a note'}>
      <div className="margin-editor"><div className="margin-capture-actions"><label><Upload/> {ocrBusy?'Reading…':'Upload'}<input type="file" accept="image/*,.txt,text/plain" hidden onChange={e=>void captureMarginFile(e.target.files?.[0])}/></label><label><Camera/> {ocrBusy?'Reading…':'Photo'}<input type="file" accept="image/*" capture="environment" hidden onChange={e=>void captureMarginFile(e.target.files?.[0])}/></label></div><label>{marginType==='quote'?'Quote':'Note'}<textarea value={marginBody} onChange={e=>setMarginBody(e.target.value)} autoFocus placeholder={ocrBusy?'Reading the page…':'Add your text here, or pull it in from a photo.'}/></label>
        <fieldset className="margin-visibility"><legend>Who can see this?</legend><div className="margin-visibility-options"><button type="button" className={marginVisibility==='private'?'selected':''} aria-pressed={marginVisibility==='private'} onClick={()=>setMarginVisibility('private')}><LockKeyhole/><span><b>Private</b><small>Only you can see this in Your margins.</small></span><i aria-hidden="true">{marginVisibility==='private'?<Check/>:null}</i></button><button type="button" className={marginVisibility==='club'?'selected':''} aria-pressed={marginVisibility==='club'} onClick={()=>setMarginVisibility('club')}><MessageCircle/><span><b>Share with club</b><small>Saves to Your margins and shares a copy with {w.club.name}. It can appear in discussion and Meeting Room.</small></span><i aria-hidden="true">{marginVisibility==='club'?<Check/>:null}</i></button></div></fieldset>
        <div className="margin-editor-row"><label>Page <span>optional</span><input type="number" min="1" value={marginPage||''} onChange={e=>setMarginPage(Number(e.target.value)||undefined)}/></label><button type="button" className="primary" disabled={marginBusy||ocrBusy||!marginBody.trim()} onClick={saveMargin}>{marginBusy?'Saving…':marginVisibility==='club'?'Save & share':'Save privately'}</button></div></div>
    </Modal>
    <Modal open={referenceOpen} onClose={()=>setReferenceOpen(false)} title="Quick reference">
      <div className="quick-reference"><div className="search-field"><Search/><input autoFocus value={referenceQuery} onChange={e=>setReferenceQuery(e.target.value)} placeholder="Character, place, term…"/></div>{referenceQuery.trim()&&!referenceMatches.length?<div className="context-empty compact"><h3>Not available yet.</h3></div>:<div className="reference-results">{referenceMatches.map((x:any)=><article key={`${x.kind}-${x.title}`}><small>{x.kind}</small><h3>{x.title}</h3><p>{x.summary_short||x.summary_medium}</p></article>)}</div>}</div>
    </Modal>
    <Modal open={meetingVoteOpen} onClose={()=>setMeetingVoteOpen(false)} title="Pick potential meeting times" className="checkpoint-vote-dialog">
      <div className="meeting-poll-editor">
        <p className="checkpoint-vote-label">{checkpointVoteLabel||'Pick two or three realistic times for this checkpoint discussion.'}</p>
        {pollOptions.map((value,i)=><label className="picker-field" key={i}><span>Option {i+1}</span><DateTimePicker includeTime ariaLabel={`Meeting option ${i+1}`} value={value} onChange={next=>setPollOptions(v=>v.map((x,j)=>j===i?next:x))}/></label>)}
        <div className="poll-editor-actions">
          <button type="button" className="quiet-action" disabled={pollOptions.length>=5} onClick={()=>setPollOptions(v=>[...v,''])}>Add another time</button>
          {pollOptions.length>2&&<button type="button" className="quiet-action" onClick={()=>setPollOptions(v=>v.slice(0,-1))}>Remove last</button>}
        </div>
        <button type="button" className="primary full" disabled={voteBusy||pollOptions.filter(Boolean).length<2} onClick={saveCheckpointVote}>{voteBusy?'Saving…':'Ask the group'}</button>
      </div>
    </Modal>
  </div>;
}

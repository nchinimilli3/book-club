import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, CalendarDays, Heart, LockKeyhole, MessageCircle, Minus, Plus, Quote, Search, Share2, StickyNote, Trash2 } from 'lucide-react';
import { useRouter } from '../lib/router';
import { useApp } from '../lib/AppContext';
import { createReply, createThought, deleteMargin, getBookContext, getMargins, removeMeetingQuestion, saveMeetingQuestion, savePrivateNote, saveQuote, toggleReaction, updateProgress } from '../lib/data';
import { getReaderContext } from '../lib/api';
import { Modal } from '../components/Modal';
import { BookCover } from '../components/BookCover';
import { FeedbackMessage, PageState } from '../components/PageState';
import { DiscussionSkeleton } from '../components/Skeleton';
import type { MarginItem } from '../lib/model';

type Depth='short'|'medium'|'deep';
type ComposerType='thought'|'question'|'prediction';
type ReadingProgressMode='chapter'|'page'|'percent';


export function ReadingRoom({clubId,clubBookId}:{clubId:string;clubBookId:string}){
  const a=useApp(),{navigate:nav}=useRouter(),w=a.workspace;
  const[tab,setTab]=useState<'discussion'|'context'|'calendar'|'notes'|'characters'>(()=>{const key=`bookclub:reading-tab:${clubBookId}`;const saved=sessionStorage.getItem(key);sessionStorage.removeItem(key);return saved==='calendar'?'calendar':'discussion'});
  const[depth,setDepth]=useState<Depth>('short');
  const[context,setContext]=useState<any[]>([]);
  const[contextLoading,setContextLoading]=useState(false);
  const[contextError,setContextError]=useState('');
  const[note,setNote]=useState('');
  const[composerType,setComposerType]=useState<ComposerType>('thought');
  const[posting,setPosting]=useState(false);
  const[postError,setPostError]=useState('');
  const[replyingTo,setReplyingTo]=useState<string|null>(null);
  const[replyBody,setReplyBody]=useState('');
  const[margins,setMargins]=useState<MarginItem[]>([]);
  const[marginType,setMarginType]=useState<'note'|'quote'|null>(null);
  const[marginBody,setMarginBody]=useState('');
  const[marginNote,setMarginNote]=useState('');
  const[marginPage,setMarginPage]=useState<number|undefined>();
  const[marginBusy,setMarginBusy]=useState(false);
  const[notice,setNotice]=useState('');
  const[referenceOpen,setReferenceOpen]=useState(false);
  const[referenceQuery,setReferenceQuery]=useState('');
  const[sharePending,setSharePending]=useState(false);
  const sharePendingRef=useRef(false);
  const[progressOpen,setProgressOpen]=useState(false);
  const[progressMode,setProgressMode]=useState<ReadingProgressMode>('chapter');
  const[editChapter,setEditChapter]=useState(1),[editPage,setEditPage]=useState(1),[editPercent,setEditPercent]=useState(0),[progressBusy,setProgressBusy]=useState(false);
  const cb=w?.currentBook;

  if(!w||!cb||cb.id!==clubBookId)return <div className="page"><PageState kind="error" title="This reading room isn’t available." action={<button className="primary" onClick={()=>nav(clubId?`/clubs/${clubId}`:'/clubs')}>Back to club</button>}/></div>;
  const currentBook=cb,b=currentBook.book,chapter=w.myProgress?.chapter||0;
  const totalPages=currentBook.totalPages||b.pages||0,totalChapters=currentBook.totalChapters||0;
  const readingPct=Math.max(0,Math.min(100,w.myProgress?.status==='finished'?100:w.myProgress?.percent??(totalChapters&&chapter?chapter/totalChapters*100:totalPages&&w.myProgress?.page?(w.myProgress.page/totalPages)*100:0)));
  const readingPlace=w.myProgress?.status==='finished'?'Finished':w.myProgress?.page&&!totalChapters?`Page ${w.myProgress.page}`:chapter?`Chapter ${chapter}`:'Not started';

  useEffect(()=>{
    setEditChapter(w.myProgress?.chapter||1);setEditPage(w.myProgress?.page||1);setEditPercent(Math.round(readingPct));
    setProgressMode(w.myProgress?.page&&!w.myProgress?.chapter?'page':w.myProgress?.percent!=null&&!w.myProgress?.chapter&&!w.myProgress?.page?'percent':'chapter');
  },[currentBook.id,w.myProgress?.chapter,w.myProgress?.page,w.myProgress?.percent,readingPct]);

  useEffect(()=>{
    let cancelled=false;
    setContextLoading(true);setContextError('');
    (async()=>{
      try{
        const cached=await getBookContext(b.id,chapter);
        if(cancelled)return;
        if(cached.length){setContext(cached);return}
        const generated=await getReaderContext({title:b.title,author:b.author,year:b.year,chapter});
        if(!cancelled)setContext(generated);
      }catch(err:any){if(!cancelled)setContextError(err?.message||'Could not load context.')}
      finally{if(!cancelled)setContextLoading(false)}
    })();
    return()=>{cancelled=true};
  },[b.id,b.title,b.author,b.year,chapter]);

  async function loadMargins(){if(a.user)try{setMargins(await getMargins(currentBook.id,a.user.id))}catch(err:any){setNotice(err?.message||'Could not load your margins.')}}
  useEffect(()=>{void loadMargins()},[currentBook.id,a.user?.id]);
  useEffect(()=>{const key=`bookclub:draft:${currentBook.id}`;const saved=sessionStorage.getItem(key);if(saved)setNote(saved)},[currentBook.id]);
  useEffect(()=>{const key=`bookclub:draft:${currentBook.id}`;if(note)sessionStorage.setItem(key,note);else sessionStorage.removeItem(key)},[currentBook.id,note]);

  const chars=context.filter(x=>String(x.kind).toLowerCase().includes('character'));
  const visible=w.thoughts.filter(t=>!t.chapter||t.chapter<=chapter);
  const referenceMatches=referenceQuery.trim()?context.filter(x=>`${x.title||''} ${x.summary_short||''} ${x.summary_medium||''}`.toLowerCase().includes(referenceQuery.trim().toLowerCase())).slice(0,4):[];
  const nonCharacterContext=context.filter(x=>!String(x.kind).toLowerCase().includes('character'));
  const fallbackContext=[
    b.description?{id:'catalog-overview',kind:'overview',title:'About this book',summary_short:b.description,summary_medium:b.description,summary_deep:b.description,context_sources:[]}:null,
    (b.year||b.pages)?{id:'catalog-details',kind:'metadata',title:'At a glance',summary_short:[b.year?`Published ${b.year}`:null,b.pages?`${b.pages} pages`:null,`Written by ${b.author}`].filter(Boolean).join(' · '),summary_medium:[b.year?`Published ${b.year}`:null,b.pages?`${b.pages} pages`:null,`Written by ${b.author}`].filter(Boolean).join(' · '),summary_deep:[b.year?`Published ${b.year}`:null,b.pages?`${b.pages} pages`:null,`Written by ${b.author}`].filter(Boolean).join(' · '),context_sources:[]}:null,
  ].filter(Boolean) as any[];
  const contextItems=nonCharacterContext.length?nonCharacterContext:fallbackContext;
  const hasDepthVariants=contextItems.some((x:any)=>{const short=String(x.summary_short||'').trim(),medium=String(x.summary_medium||'').trim(),deep=String(x.summary_deep||'').trim();return Boolean((medium&&medium!==short)||(deep&&deep!==medium&&deep!==short))});

  async function post(){
    if(!note.trim()||!a.user)return;
    setPosting(true);setPostError('');
    try{await createThought(currentBook.id,a.user.id,note.trim(),chapter||undefined,composerType);setNote('');setComposerType('thought');await a.refresh()}
    catch(err:any){setPostError(err?.message||'Could not post your thought.')}
    finally{setPosting(false)}
  }
  async function reply(postId:string){if(!replyBody.trim())return;setPosting(true);setPostError('');try{await createReply(postId,replyBody);setReplyBody('');setReplyingTo(null);await a.refresh()}catch(err:any){setPostError(err?.message||'Could not post reply.')}finally{setPosting(false)}}
  async function react(postId:string){try{await toggleReaction(postId,'heart');await a.refresh()}catch(err:any){setPostError(err?.message||'Could not save reaction.')}}
  async function saveMargin(){if(!marginType||!marginBody.trim())return;setMarginBusy(true);try{if(marginType==='note')await savePrivateNote(currentBook.id,marginBody,chapter||undefined,marginPage);else await saveQuote(currentBook.id,marginBody,marginNote,chapter||undefined,marginPage);setMarginType(null);setMarginBody('');setMarginNote('');setMarginPage(undefined);await loadMargins();setNotice(marginType==='note'?'Note saved privately.':'Quote saved to your margins.')}catch(err:any){setNotice(err?.message||'Could not save.')}finally{setMarginBusy(false)}}
  async function removeMargin(item:MarginItem){try{await deleteMargin(item.kind,item.id);await loadMargins()}catch(err:any){setNotice(err?.message||'Could not delete this item.')}}
  async function saveReadingProgress(){
    setProgressBusy(true);
    try{
      await updateProgress(currentBook.id,progressMode==='chapter'?editChapter:undefined,'reading',totalChapters||undefined,progressMode==='page'?editPage:undefined,totalPages||undefined,progressMode==='percent'?editPercent:undefined);
      await a.refresh();setProgressOpen(false);setNotice('Reading progress updated.');
    }catch(err:any){setNotice(err?.message||'Could not update your progress.')}finally{setProgressBusy(false)}
  }
  async function toggleMeetingSave(postId:string,body:string,saved?:boolean){try{if(saved){const q=w!.meetingQuestions.find(x=>x.postId===postId);if(q)await removeMeetingQuestion(q.id);setNotice('Removed from the meeting agenda.')}else{await saveMeetingQuestion(currentBook.id,postId,body);setNotice('Saved for the meeting.')}await a.refresh()}catch(err:any){setNotice(err?.message||'Could not update the meeting agenda.')}}
  async function shareBook(){
    if(sharePendingRef.current)return;
    sharePendingRef.current=true;setSharePending(true);
    const data={title:b.title,text:`${b.title} by ${b.author}`,url:location.href};
    try{if(navigator.share)await navigator.share(data);else if(navigator.clipboard){await navigator.clipboard.writeText(location.href);setNotice('Reading room link copied.')}}
    catch(err:any){if(err?.name!=='AbortError'){try{await navigator.clipboard.writeText(location.href);setNotice('Reading room link copied.')}catch{setNotice('Sharing is unavailable right now.')}}}
    finally{sharePendingRef.current=false;setSharePending(false)}
  }

  const readingRoomStyle=b.coverUrl?({'--reading-cover':`url("${b.coverUrl.replace(/"/g,'%22')}")`} as CSSProperties):undefined;

  return <div className={`page reading-room tone-${w.club.tone}`} style={readingRoomStyle}>
    <header className="reading-top"><button className="back-link" onClick={()=>nav(`/clubs/${w.club.id}`)}><ArrowLeft/> {w.club.name}</button><button className="icon-button" onClick={shareBook} disabled={sharePending} aria-busy={sharePending} aria-label="Share reading room"><Share2/></button></header>
    {notice&&<FeedbackMessage>{notice}</FeedbackMessage>}
    <section className="reading-cover-story"><div className="reading-copy"><p className="reading-club-label">{w.club.name} · current book</p><h1>{b.title}</h1><h2>{b.author}</h2><button type="button" className="position reading-position-control" onClick={()=>setProgressOpen(true)} aria-haspopup="dialog"><span className="position-copy"><span>Your place</span><b>{readingPlace} <span aria-hidden="true">⌄</span></b></span><i role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(readingPct)}><em style={{width:`${readingPct}%`}}/><u style={{left:`${readingPct}%`}}/></i><small>Tap to change chapter, page, or percentage</small></button></div><div className="reading-art"><BookCover className="main-cover" title={b.title} author={b.author} src={b.coverUrl}/></div></section>
    <nav className="reading-tabs" aria-label="Reading room">{(['calendar','discussion','context','notes'] as const).map(x=><button className={tab===x?'active':''} onClick={()=>setTab(x)} key={x}>{x==='context'?'Context':x==='calendar'?'Reading plan':x==='notes'?'My notes':'Discussion'}</button>)}</nav>

    {tab==='discussion'&&<section className="reading-section discussion-section"><header className="section-intro"><h2>Discussion</h2>{chapter>0&&<p>Through Chapter {chapter}</p>}</header>
      {w.lockedPostCount>0&&<button type="button" className="unlock-banner" onClick={()=>setProgressOpen(true)}><LockKeyhole/><span><b>{w.lockedPostCount} {w.lockedPostCount===1?'thought':'thoughts'} waiting for you</b></span></button>}
      <div className="reading-quick-tools"><button type="button" onClick={()=>{setReferenceQuery('');setReferenceOpen(true)}}><Search/> Ask about the book</button>{w.meetingQuestions.length>0&&<button type="button" onClick={()=>nav(`/clubs/${w.club.id}/books/${currentBook.id}/meeting`)}><MessageCircle/> {w.meetingQuestions.length} saved for the meeting</button>}</div>
      <div className="composer-inline">
        <div className="composer-types">{(['thought','question','prediction'] as ComposerType[]).map(x=><button type="button" key={x} className={composerType===x?'active':''} onClick={()=>setComposerType(x)}>{x[0].toUpperCase()+x.slice(1)}</button>)}</div>
        <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder={composerType==='prediction'?'Make a prediction…':composerType==='question'?'What are you wondering?':`A thought from Chapter ${chapter||'…'}`}/>
        <div><span>{composerType==='prediction'?'Sealed until meeting':chapter?`Chapter ${chapter}`:''}</span><button className="primary" onClick={post} disabled={posting||!note.trim()}>{posting?'Posting…':'Post'}</button></div>{postError&&<p className="error-text">{postError}</p>}
      </div>
      <div className="thought-stream">{visible.map(t=>{
        const hearts=(t.reactions||[]).filter(r=>r.reaction==='heart');const mine=hearts.some(r=>r.userId===a.user?.id);
        return <article key={t.id} className={`thought thought-${t.type}${t.type==='prediction'&&!t.predictionRevealed?' sealed-prediction':''}`}><header><button type="button" className="thought-person" onClick={()=>nav(`/clubs/${w.club.id}/members/${t.userId}`)}><div className="person-dot">{t.author?.displayName?.slice(0,1)||'R'}</div><div><b>{t.author?.displayName||'Reader'}</b><span>{t.type==='prediction'?(t.predictionRevealed?'Prediction · revealed':'Prediction · sealed'):t.type==='question'?'Question':t.chapter?`Chapter ${t.chapter}`:'Open discussion'}</span></div></button></header>{t.type==='prediction'&&!t.predictionRevealed?<div className="sealed-note"><LockKeyhole/><b>Sealed until meeting mode</b><span>{t.chapter?`Chapter ${t.chapter}`:'Chapter not specified'}</span></div>:<p>{t.body}</p>}
          <div className="post-actions"><button type="button" className={mine?'active':''} onClick={()=>react(t.id)}><Heart fill={mine?'currentColor':'none'}/> {hearts.length||''}</button><button type="button" onClick={()=>{setReplyingTo(replyingTo===t.id?null:t.id);setReplyBody('')}}><MessageCircle/> Reply{t.replyItems?.length?` · ${t.replyItems.length}`:''}</button><button type="button" className={t.savedForMeeting?'active':''} onClick={()=>toggleMeetingSave(t.id,t.body,t.savedForMeeting)}><StickyNote/> {t.savedForMeeting?'On agenda':'Discuss at meeting'}</button></div>
          {t.replyItems?.length?<div className="reply-list">{t.replyItems.map(r=><div key={r.id}><b>{r.author?.displayName||'Reader'}</b><p>{r.body}</p></div>)}</div>:null}
          {replyingTo===t.id&&<div className="reply-composer"><input value={replyBody} onChange={e=>setReplyBody(e.target.value)} placeholder="Write a reply" autoFocus/><button type="button" className="primary" disabled={!replyBody.trim()||posting} onClick={()=>reply(t.id)}>Reply</button></div>}
        </article>})}{!visible.length&&!posting&&<div className="context-empty"><MessageCircle/><h3>No thoughts yet.</h3></div>}</div>
    </section>}

    {tab==='context'&&<section className="reading-section context-section"><header className="section-intro split"><div><p className="context-kicker">About the book</p><h2>Context</h2></div>{hasDepthVariants&&<div className="depth-switch">{(['short','medium','deep'] as Depth[]).map(d=><button type="button" aria-pressed={depth===d} className={depth===d?'active':''} onClick={()=>setDepth(d)} key={d}>{d==='short'?'30 sec':d==='medium'?'2 min':'Deep dive'}</button>)}</div>}</header><div className="context-list">{contextLoading?<DiscussionSkeleton/>:contextItems.length?contextItems.map((x:any,i)=><article key={x.id||`${x.kind}-${i}`}><span>{String(i+1).padStart(2,'0')}</span><div><small>{String(x.kind||'context').replaceAll('_',' ')}</small><h3>{x.title}</h3><p>{depth==='short'?x.summary_short:depth==='medium'?(x.summary_medium||x.summary_short):(x.summary_deep||x.summary_medium||x.summary_short)}</p>{x.context_sources?.length>0&&<details><summary>Sources</summary>{x.context_sources.map((s:any)=><a href={s.source_url} target="_blank" rel="noreferrer" key={s.source_url}>{s.source_name||'Source'}</a>)}</details>}</div></article>):<div className="context-empty context-empty-designed"><Search/><h3>Context is still being gathered.</h3><p>{contextError?'Source-backed context could not load right now.':'This section will fill with sourced background as it becomes available.'}</p></div>}</div></section>}

    {tab==='calendar'&&<section className="reading-section calendar-section reading-plan-editorial"><header className="reading-plan-intro"><div><p>Reading plan</p><h2>{currentBook.targetFinishDate?`Finish by ${new Date(currentBook.targetFinishDate+'T12:00').toLocaleDateString('en-US',{month:'long',day:'numeric'})}`:'Set a finish target from the club home'}</h2></div><div className="reading-plan-progress"><strong>{Math.round(readingPct)}%</strong><span>{readingPlace}</span></div></header><div className="reading-plan-track" aria-label={`${Math.round(readingPct)} percent complete`}><i><em style={{width:`${readingPct}%`}}/><u style={{left:`${readingPct}%`}}/></i><div><span>Start</span><span>{currentBook.targetFinishDate?new Date(currentBook.targetFinishDate+'T12:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):'Finish'}</span></div></div>{w.checkpoints.length?<ol className="reading-plan-milestones">{w.checkpoints.map((c,i)=>{const done=c.targetChapter?chapter>=c.targetChapter:c.targetPage?(w.myProgress?.page||0)>=c.targetPage:false;return <li key={c.id} className={done?'complete':i===w.checkpoints.findIndex(cp=>cp.targetChapter?chapter<(cp.targetChapter||0):cp.targetPage?(w.myProgress?.page||0)<(cp.targetPage||0):false)?'current':''}><time>{new Date(c.dueAt+'T12:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</time><span><b>{c.label||`Checkpoint ${i+1}`}</b><small>{c.targetChapter?`Through Chapter ${c.targetChapter}`:c.targetPage?`Through page ${c.targetPage}`:'Reading checkpoint'}</small></span></li>})}</ol>:<div className="reading-plan-empty"><CalendarDays/><div><h3>{currentBook.targetFinishDate?'One finish line, no forced checkpoints.':'No plan yet.'}</h3><p>{currentBook.targetFinishDate?'Your club can keep this plan simple or add checkpoints later.':'Set a finish date from the club home when everyone is ready.'}</p></div></div>}{w.meeting&&<footer className="reading-plan-meeting"><span>Book club discussion</span><b>{new Intl.DateTimeFormat('en-US',{weekday:'long',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(w.meeting.startsAt))}</b></footer>}</section>}

    {tab==='notes'&&<section className="reading-section margins-section"><header className="section-intro split margins-heading"><div><h2>Your margins</h2></div><div className="margin-actions"><button type="button" onClick={()=>setMarginType('note')}><StickyNote/> Add note</button><button type="button" onClick={()=>setMarginType('quote')}><Quote/> Save quote</button><button type="button" onClick={()=>{setComposerType('prediction');setTab('discussion')}}>Prediction</button></div></header>{margins.length?<div className="margin-list">{margins.map(item=><article className="margin-note" key={`${item.kind}-${item.id}`}><span>{item.kind==='quote'?'Quote':'Note'}{item.chapter?` · Ch. ${item.chapter}`:''}{item.page?` · p. ${item.page}`:''}</span><p>{item.kind==='quote'?`“${item.body}”`:item.body}</p>{item.note&&<small>{item.note}</small>}<button type="button" className="margin-delete" onClick={()=>removeMargin(item)} aria-label="Delete"><Trash2/></button></article>)}</div>:<div className="context-empty margins-empty"><StickyNote/><h3>Your margins are empty.</h3></div>}</section>}

    {tab==='characters'&&<section className="reading-section"><header className="section-intro"><h2>Character map</h2></header>{chars.length?<div className="character-list">{chars.map((c:any)=><article key={c.id||c.title}><div className="character-monogram">{c.title.slice(0,1)}</div><div><h3>{c.title}</h3><p>{c.summary_short}</p></div></article>)}</div>:<div className="context-empty"><Search/><h3>Nothing to show yet.</h3></div>}</section>}

    <Modal open={progressOpen} onClose={()=>setProgressOpen(false)} title="Update reading progress" className="reading-progress-sheet">
      <div className="reading-progress-editor">
        <div className="progress-mode-switch">{(['chapter','page','percent'] as ReadingProgressMode[]).map(x=><button type="button" key={x} aria-pressed={progressMode===x} className={progressMode===x?'selected':''} onClick={()=>setProgressMode(x)}>{x==='percent'?'%':x[0].toUpperCase()+x.slice(1)}</button>)}</div>
        {progressMode==='chapter'?<div className="progress-slider-control"><span>Chapter</span><div className="progress-stepper"><button type="button" aria-label="Previous chapter" onClick={()=>setEditChapter(v=>Math.max(0,v-1))}><Minus/></button><b>{editChapter}</b><button type="button" aria-label="Next chapter" onClick={()=>setEditChapter(v=>Math.min(totalChapters||Math.max(v+1,40),v+1))}><Plus/></button></div><input aria-label="Chapter progress" className="progress-slider" type="range" min="0" max={totalChapters||40} value={Math.min(editChapter,totalChapters||40)} onChange={e=>setEditChapter(Number(e.target.value))}/></div>:progressMode==='page'?<div className="progress-slider-control"><span>Page</span><div className="progress-stepper"><button type="button" aria-label="Previous page" onClick={()=>setEditPage(v=>Math.max(0,v-5))}><Minus/></button><b>{editPage}</b><button type="button" aria-label="Next page" onClick={()=>setEditPage(v=>Math.min(totalPages||Math.max(v+5,500),v+5))}><Plus/></button></div><input aria-label="Page progress" className="progress-slider" type="range" min="0" max={totalPages||500} value={Math.min(editPage,totalPages||500)} onChange={e=>setEditPage(Number(e.target.value))}/></div>:<div className="progress-slider-control"><span>Percentage</span><b className="progress-percent-value">{editPercent}%</b><input aria-label="Percentage progress" className="progress-slider" type="range" min="0" max="100" value={editPercent} onChange={e=>setEditPercent(Number(e.target.value))}/></div>}
        <button type="button" className="primary full reading-progress-save" disabled={progressBusy} onClick={saveReadingProgress}>{progressBusy?'Saving…':'Save progress'}</button>
      </div>
    </Modal>
    <Modal open={Boolean(marginType)} onClose={()=>setMarginType(null)} title={marginType==='quote'?'Save a quote':'Add a private note'}>
      <div className="margin-editor"><label>{marginType==='quote'?'Quote':'Note'}<textarea value={marginBody} onChange={e=>setMarginBody(e.target.value)} autoFocus/></label>{marginType==='quote'&&<label>Why save it? <span>optional</span><input value={marginNote} onChange={e=>setMarginNote(e.target.value)}/></label>}<label>Page <span>optional</span><input type="number" min="1" value={marginPage||''} onChange={e=>setMarginPage(Number(e.target.value)||undefined)}/></label><button type="button" className="primary full" disabled={marginBusy||!marginBody.trim()} onClick={saveMargin}>{marginBusy?'Saving…':'Save'}</button></div>
    </Modal>
    <Modal open={referenceOpen} onClose={()=>setReferenceOpen(false)} title="Quick reference">
      <div className="quick-reference"><div className="search-field"><Search/><input autoFocus value={referenceQuery} onChange={e=>setReferenceQuery(e.target.value)} placeholder="Character, place, term…"/></div>{referenceQuery.trim()&&!referenceMatches.length?<div className="context-empty compact"><h3>Not available yet.</h3></div>:<div className="reference-results">{referenceMatches.map((x:any)=><article key={`${x.kind}-${x.title}`}><small>{x.kind}</small><h3>{x.title}</h3><p>{x.summary_short||x.summary_medium}</p></article>)}</div>}</div>
    </Modal>
  </div>;
}

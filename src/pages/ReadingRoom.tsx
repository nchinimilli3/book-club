import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, CalendarDays, Camera, FileText, Heart, LockKeyhole, MessageCircle, Minus, Plus, Quote, Search, Share2, StickyNote, Trash2, Upload } from 'lucide-react';
import { useRouter } from '../lib/router';
import { useApp } from '../lib/AppContext';
import { createReply, createThought, deleteMargin, getBookContext, getMargins, removeMeetingQuestion, saveMeetingOptions, saveMeetingQuestion, savePrivateNote, saveQuote, toggleReaction, updateProgress } from '../lib/data';
import { getReaderContext } from '../lib/api';
import { Modal } from '../components/Modal';
import { BookCover } from '../components/BookCover';
import { FeedbackMessage, PageState } from '../components/PageState';
import { DiscussionSkeleton } from '../components/Skeleton';
import type { MarginItem } from '../lib/model';
import { getKnownChapterCount } from '../lib/books';

type Depth='short'|'medium'|'deep';
type ComposerType='thought'|'question'|'prediction';
type ReadingProgressMode='chapter'|'page';

function coverAccent(src:string,seed:string):Promise<{accent:string;soft:string;rgb:string}>{
  const fallback={accent:'#6f6652',soft:'#f1eadc',rgb:'111,102,82'};
  if(!src)return Promise.resolve(fallback);
  return new Promise(resolve=>{
    const img=new Image();img.crossOrigin='anonymous';
    img.onload=()=>{try{
      const canvas=document.createElement('canvas');canvas.width=28;canvas.height=42;
      const ctx=canvas.getContext('2d');if(!ctx)return resolve(fallback);
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      const buckets=new Map<string,{r:number;g:number;b:number;n:number}>();
      for(let i=0;i<data.length;i+=16){
        const r=data[i],g=data[i+1],b=data[i+2],a=data[i+3],max=Math.max(r,g,b),min=Math.min(r,g,b);
        if(a<220||max>245&&min>226||max<28)continue;
        const sat=max-min;if(sat<18&&max>180)continue;
        const key=`${Math.round(r/32)}-${Math.round(g/32)}-${Math.round(b/32)}`;
        const v=buckets.get(key)||{r:0,g:0,b:0,n:0};v.r+=r;v.g+=g;v.b+=b;v.n++;buckets.set(key,v);
      }
      const best=[...buckets.values()].sort((a,b)=>b.n-a.n)[0];
      if(!best)return resolve(fallback);
      const r=Math.round(best.r/best.n),g=Math.round(best.g/best.n),b=Math.round(best.b/best.n);
      resolve({accent:`rgb(${r} ${g} ${b})`,soft:`rgba(${r}, ${g}, ${b}, .13)`,rgb:`${r},${g},${b}`});
    }catch{resolve(fallback)}};
    img.onerror=()=>resolve({...fallback,accent:`hsl(${Array.from(seed).reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0)%360} 34% 34%)`});
    img.src=src;
  });
}


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
  const[editChapter,setEditChapter]=useState(1),[editPage,setEditPage]=useState(1),[progressBusy,setProgressBusy]=useState(false);
  const[detectedChapters,setDetectedChapters]=useState(0);
  const[postChapter,setPostChapter]=useState<number|undefined>();
  const[roomAccent,setRoomAccent]=useState({accent:'#6f6652',soft:'#f1eadc',rgb:'111,102,82'});
  const cb=w?.currentBook;

  if(!w||!cb||cb.id!==clubBookId)return <div className="page"><PageState kind="error" title="This reading room isn’t available." action={<button className="primary" onClick={()=>nav(clubId?`/clubs/${clubId}`:'/clubs')}>Back to club</button>}/></div>;
  const currentBook=cb,b=currentBook.book,chapter=w.myProgress?.chapter||0;
  const totalPages=currentBook.totalPages||b.pages||0,totalChapters=currentBook.totalChapters||0,effectiveTotalChapters=totalChapters||detectedChapters||0;
  const readingPct=Math.max(0,Math.min(100,w.myProgress?.status==='finished'?100:w.myProgress?.percent??(effectiveTotalChapters&&chapter?chapter/effectiveTotalChapters*100:totalPages&&w.myProgress?.page?(w.myProgress.page/totalPages)*100:0)));
  const progressFormat=w.myProgress?.format;
  const readingPlace=w.myProgress?.status==='finished'?'Finished':progressFormat==='percent'&&w.myProgress?.percent!=null?`${Math.round(w.myProgress.percent)}%`:progressFormat==='page'&&w.myProgress?.page?`Page ${w.myProgress.page}`:progressFormat==='chapter'&&chapter?`Chapter ${chapter}`:w.myProgress?.percent!=null&&w.myProgress.percent>0?`${Math.round(w.myProgress.percent)}%`:w.myProgress?.page?`Page ${w.myProgress.page}`:chapter?`Chapter ${chapter}`:'Not started';

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
    try{await createThought(currentBook.id,a.user.id,note.trim(),postChapter||undefined,composerType);setNote('');setComposerType('thought');await a.refresh()}
    catch(err:any){setPostError(err?.message||'Could not post your thought.')}
    finally{setPosting(false)}
  }
  async function reply(postId:string){if(!replyBody.trim())return;setPosting(true);setPostError('');try{await createReply(postId,replyBody);setReplyBody('');setReplyingTo(null);await a.refresh()}catch(err:any){setPostError(err?.message||'Could not post reply.')}finally{setPosting(false)}}
  async function react(postId:string){try{await toggleReaction(postId,'heart');await a.refresh()}catch(err:any){setPostError(err?.message||'Could not save reaction.')}}
  async function saveMargin(){if(!marginType||!marginBody.trim())return;setMarginBusy(true);try{if(marginType==='note')await savePrivateNote(currentBook.id,marginBody,chapter||undefined,marginPage);else await saveQuote(currentBook.id,marginBody,marginNote,chapter||undefined,marginPage);setMarginType(null);setMarginBody('');setMarginNote('');setMarginPage(undefined);await loadMargins();setNotice(marginType==='note'?'Note saved privately.':'Quote saved to your margins.')}catch(err:any){setNotice(err?.message||'Could not save.')}finally{setMarginBusy(false)}}
  async function captureMarginFile(file?:File){
    if(!file)return;
    if(file.type.startsWith('text/')||file.name.toLowerCase().endsWith('.txt')){
      setMarginBody(await file.text());
      setNotice('Text added from your upload.');
      return;
    }
    setNotice('Image capture is ready here; OCR still needs the reader service to be connected.');
  }
  async function removeMargin(item:MarginItem){try{await deleteMargin(item.kind,item.id);await loadMargins()}catch(err:any){setNotice(err?.message||'Could not delete this item.')}}
  async function saveReadingProgress(){
    setProgressBusy(true);
    try{
      await updateProgress(currentBook.id,progressMode==='chapter'?editChapter:undefined,'reading',effectiveTotalChapters||undefined,progressMode==='page'?editPage:undefined,totalPages||undefined,undefined);
      await a.refresh();setProgressOpen(false);setNotice('Reading progress updated.');
    }catch(err:any){setNotice(err?.message||'Could not update your progress.')}finally{setProgressBusy(false)}
  }
  async function toggleMeetingSave(postId:string,body:string,saved?:boolean){try{if(saved){const q=w!.meetingQuestions.find(x=>x.postId===postId);if(q)await removeMeetingQuestion(q.id);setNotice('Removed from the meeting agenda.')}else{await saveMeetingQuestion(currentBook.id,postId,body);setNotice('Saved for the meeting.')}await a.refresh()}catch(err:any){setNotice(err?.message||'Could not update the meeting agenda.')}}
  async function startCheckpointMeetingVote(dueAt:string){
    const base=new Date(`${dueAt}T19:00:00`);
    const option=(dayOffset:number,hour:number)=>{const d=new Date(base);d.setDate(base.getDate()+dayOffset);d.setHours(hour,0,0,0);return d.toISOString()};
    try{await saveMeetingOptions(currentBook.clubId,currentBook.id,[option(-1,19),option(0,19),option(1,14)]);await a.refresh();setNotice('Three FaceTime options are ready for the club to vote on.')}
    catch(err:any){setNotice(err?.message||'Could not start that meeting vote.')}
  }
  async function shareBook(){
    if(sharePendingRef.current)return;
    sharePendingRef.current=true;setSharePending(true);
    const data={title:b.title,text:`${b.title} by ${b.author}`,url:location.href};
    try{if(navigator.share)await navigator.share(data);else if(navigator.clipboard){await navigator.clipboard.writeText(location.href);setNotice('Reading room link copied.')}}
    catch(err:any){if(err?.name!=='AbortError'){try{await navigator.clipboard.writeText(location.href);setNotice('Reading room link copied.')}catch{setNotice('Sharing is unavailable right now.')}}}
    finally{sharePendingRef.current=false;setSharePending(false)}
  }

  const readingRoomStyle=({'--reading-cover':b.coverUrl?`url("${b.coverUrl.replace(/"/g,'%22')}")`:undefined,'--reading-accent':roomAccent.accent,'--reading-accent-soft':roomAccent.soft,'--reading-accent-rgb':roomAccent.rgb} as CSSProperties);

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
        <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder={composerType==='prediction'?'Make a prediction…':composerType==='question'?'What are you wondering?':postChapter?`A thought from Chapter ${postChapter}`:'Add a thought…'}/>
        <div className="composer-footer"><label className="composer-location"><span>Post at</span><span className="composer-chapter-input">Chapter <input aria-label="Chapter for this post" type="number" min="1" max={effectiveTotalChapters||undefined} value={postChapter||''} placeholder="—" onChange={e=>setPostChapter(Number(e.target.value)||undefined)}/>{effectiveTotalChapters?<small>of {effectiveTotalChapters}</small>:null}</span></label><span className="composer-seal">{composerType==='prediction'?'Sealed until meeting':''}</span><button className="primary" onClick={post} disabled={posting||!note.trim()}>{posting?'Posting…':'Post'}</button></div>{postError&&<p className="error-text">{postError}</p>}
      </div>
      <div className="thought-stream">{visible.map(t=>{
        const hearts=(t.reactions||[]).filter(r=>r.reaction==='heart');const mine=hearts.some(r=>r.userId===a.user?.id);
        return <article key={t.id} className={`thought thought-${t.type}${t.type==='prediction'&&!t.predictionRevealed?' sealed-prediction':''}`}><header><button type="button" className="thought-person" onClick={()=>nav(`/clubs/${w.club.id}/members/${t.userId}`)}><div className="person-dot">{t.author?.avatarUrl?<img src={t.author.avatarUrl} alt=""/>:t.author?.displayName?.slice(0,1)||'R'}</div><div><b>{t.author?.displayName||'Reader'}</b><span>{t.type==='prediction'?(t.predictionRevealed?'Prediction · revealed':'Prediction · sealed'):t.type==='question'?'Question':t.chapter?`Chapter ${t.chapter}`:'Open discussion'}</span></div></button></header>{t.type==='prediction'&&!t.predictionRevealed?<div className="sealed-note"><LockKeyhole/><b>Sealed until meeting mode</b><span>{t.chapter?`Chapter ${t.chapter}`:'Chapter not specified'}</span></div>:<p>{t.body}</p>}
          <div className="post-actions"><button type="button" className={mine?'active':''} onClick={()=>react(t.id)}><Heart fill={mine?'currentColor':'none'}/> {hearts.length||''}</button><button type="button" onClick={()=>{setReplyingTo(replyingTo===t.id?null:t.id);setReplyBody('')}}><MessageCircle/> Reply{t.replyItems?.length?` · ${t.replyItems.length}`:''}</button><button type="button" className={t.savedForMeeting?'active':''} onClick={()=>toggleMeetingSave(t.id,t.body,t.savedForMeeting)}><StickyNote/> {t.savedForMeeting?'On agenda':'Discuss at meeting'}</button></div>
          {t.replyItems?.length?<div className="reply-list">{t.replyItems.map(r=><div key={r.id}><b>{r.author?.displayName||'Reader'}</b><p>{r.body}</p></div>)}</div>:null}
          {replyingTo===t.id&&<div className="reply-composer"><input value={replyBody} onChange={e=>setReplyBody(e.target.value)} placeholder="Write a reply" autoFocus/><button type="button" className="primary" disabled={!replyBody.trim()||posting} onClick={()=>reply(t.id)}>Reply</button></div>}
        </article>})}{!visible.length&&!posting&&<div className="context-empty"><MessageCircle/><h3>No thoughts yet.</h3></div>}</div>
    </section>}

    {tab==='context'&&<section className="reading-section context-section"><header className="section-intro split"><div><p className="context-kicker">About the book</p><h2>Context</h2></div>{hasDepthVariants&&<div className="depth-switch">{(['short','medium','deep'] as Depth[]).map(d=><button type="button" aria-pressed={depth===d} className={depth===d?'active':''} onClick={()=>setDepth(d)} key={d}>{d==='short'?'30 sec':d==='medium'?'2 min':'Deep dive'}</button>)}</div>}</header><div className="context-list">{contextLoading?<DiscussionSkeleton/>:contextItems.length?contextItems.map((x:any,i)=><article key={x.id||`${x.kind}-${i}`}><span>{String(i+1).padStart(2,'0')}</span><div><small>{String(x.kind||'context').replaceAll('_',' ')}</small><h3>{x.title}</h3><p>{depth==='short'?x.summary_short:depth==='medium'?(x.summary_medium||x.summary_short):(x.summary_deep||x.summary_medium||x.summary_short)}</p>{x.context_sources?.length>0&&<details><summary>Sources</summary>{x.context_sources.map((s:any)=><a href={s.source_url} target="_blank" rel="noreferrer" key={s.source_url}>{s.source_name||'Source'}</a>)}</details>}</div></article>):<div className="context-empty context-empty-designed"><Search/><h3>Context is still being gathered.</h3><p>{contextError?'Source-backed context could not load right now.':'This section will fill with sourced background as it becomes available.'}</p></div>}</div></section>}

    {tab==='calendar'&&<section className="reading-section calendar-section reading-plan-editorial"><header className="reading-plan-intro"><div><p>Reading plan</p><h2>{currentBook.targetFinishDate?`Finish by ${new Date(currentBook.targetFinishDate+'T12:00').toLocaleDateString('en-US',{month:'long',day:'numeric'})}`:'Set a finish target from the club home'}</h2></div><div className="reading-plan-progress"><strong>{Math.round(readingPct)}%</strong><span>{readingPlace}</span></div></header><div className="reading-plan-track" aria-label={`${Math.round(readingPct)} percent complete`}><i><em style={{width:`${readingPct}%`}}/><u style={{left:`${readingPct}%`}}/></i><div><span>Start</span><span>{currentBook.targetFinishDate?new Date(currentBook.targetFinishDate+'T12:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):'Finish'}</span></div></div>{w.checkpoints.length?<ol className="reading-plan-milestones">{w.checkpoints.map((c,i)=>{const done=c.targetChapter?chapter>=c.targetChapter:c.targetPage?(w.myProgress?.page||0)>=c.targetPage:false;const target=c.targetChapter?`Through Chapter ${c.targetChapter}`:c.targetPage?`Through page ${c.targetPage}`:'Reading checkpoint';const normalize=(v:string)=>v.toLowerCase().replace(/[^a-z0-9]/g,'');const label=String(c.label||'').trim();const repeatsTarget=label&&normalize(label)===normalize(target);const meetingForCheckpoint=w.meeting&&Math.abs(new Date(w.meeting.startsAt).getTime()-new Date(`${c.dueAt}T19:00:00`).getTime())<36*60*60*1000;return <li key={c.id} className={done?'complete':i===w.checkpoints.findIndex(cp=>cp.targetChapter?chapter<(cp.targetChapter||0):cp.targetPage?(w.myProgress?.page||0)>=0&&(w.myProgress?.page||0)<(cp.targetPage||0):false)?'current':''}><time>{new Date(c.dueAt+'T12:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</time><span><b>{label&&!repeatsTarget?label:target}</b>{label&&!repeatsTarget&&<small>{target}</small>}{meetingForCheckpoint&&<small className="checkpoint-meeting">FaceTime · {new Intl.DateTimeFormat('en-US',{weekday:'short',hour:'numeric',minute:'2-digit'}).format(new Date(w.meeting!.startsAt))}</small>}</span><button type="button" className="checkpoint-meeting-button" onClick={()=>void startCheckpointMeetingVote(c.dueAt)}>{meetingForCheckpoint?'Vote another time':'Vote time'}</button></li>})}</ol>:<div className="reading-plan-empty"><CalendarDays/><div><h3>{currentBook.targetFinishDate?'One finish line, no forced checkpoints.':'No plan yet.'}</h3><p>{currentBook.targetFinishDate?'Your club can keep this plan simple or add checkpoints later.':'Set a finish date from the club home when everyone is ready.'}</p></div></div>}{w.meeting&&<footer className="reading-plan-meeting"><span>Next book club discussion</span><b>{new Intl.DateTimeFormat('en-US',{weekday:'long',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(w.meeting.startsAt))}</b></footer>}</section>}

    {tab==='notes'&&<section className="reading-section margins-section"><header className="section-intro split margins-heading"><div><h2>Your margins</h2></div><div className="margin-actions"><button type="button" onClick={()=>setMarginType('note')}><StickyNote/> Add note</button><button type="button" onClick={()=>setMarginType('quote')}><Quote/> Save quote</button><button type="button" onClick={()=>{setComposerType('prediction');setTab('discussion')}}>Prediction</button></div></header>{margins.length?<div className="margin-list">{margins.map(item=><article className="margin-note" key={`${item.kind}-${item.id}`}><span>{item.kind==='quote'?'Quote':'Note'}{item.chapter?` · Ch. ${item.chapter}`:''}{item.page?` · p. ${item.page}`:''}</span><p>{item.kind==='quote'?`“${item.body}”`:item.body}</p>{item.note&&<small>{item.note}</small>}<button type="button" className="margin-delete" onClick={()=>removeMargin(item)} aria-label="Delete"><Trash2/></button></article>)}</div>:<div className="context-empty margins-empty"><StickyNote/><h3>Your margins are empty.</h3></div>}</section>}

    {tab==='characters'&&<section className="reading-section"><header className="section-intro"><h2>Character map</h2></header>{chars.length?<div className="character-list">{chars.map((c:any)=><article key={c.id||c.title}><div className="character-monogram">{c.title.slice(0,1)}</div><div><h3>{c.title}</h3><p>{c.summary_short}</p></div></article>)}</div>:<div className="context-empty"><Search/><h3>Nothing to show yet.</h3></div>}</section>}

    <Modal open={progressOpen} onClose={()=>setProgressOpen(false)} title="Update reading progress" className="reading-progress-sheet">
      <div className="reading-progress-editor">
        <div className="progress-mode-switch">{(['chapter','page'] as ReadingProgressMode[]).map(x=><button type="button" key={x} aria-pressed={progressMode===x} className={progressMode===x?'selected':''} onClick={()=>setProgressMode(x)}>{x[0].toUpperCase()+x.slice(1)}</button>)}</div>
        {progressMode==='chapter'?<div className="progress-number-control"><div className="progress-control-heading"><span>Chapter</span>{effectiveTotalChapters?<small>of {effectiveTotalChapters} · {Math.round((Math.min(editChapter,effectiveTotalChapters)/effectiveTotalChapters)*100)}%</small>:<small>Enter the chapter you’re on</small>}</div><div className="progress-stepper"><button type="button" aria-label="Previous chapter" onClick={()=>setEditChapter(v=>Math.max(0,v-1))}><Minus/></button><input aria-label="Chapter progress" type="number" min="0" max={effectiveTotalChapters||undefined} value={editChapter} onChange={e=>setEditChapter(Math.max(0,Math.min(effectiveTotalChapters||9999,Number(e.target.value)||0)))}/><button type="button" aria-label="Next chapter" onClick={()=>setEditChapter(v=>Math.min(effectiveTotalChapters||9999,v+1))}><Plus/></button></div>{effectiveTotalChapters?<input aria-label="Chapter progress slider" className="progress-slider" type="range" min="0" max={effectiveTotalChapters} value={Math.min(editChapter,effectiveTotalChapters)} style={{'--progress-preview':`${Math.round((Math.min(editChapter,effectiveTotalChapters)/effectiveTotalChapters)*100)}%`} as CSSProperties} onChange={e=>setEditChapter(Number(e.target.value))}/>:null}</div>:<div className="progress-number-control"><div className="progress-control-heading"><span>Page</span>{totalPages?<small>of {totalPages} · {Math.round((Math.min(editPage,totalPages)/totalPages)*100)}%</small>:<small>Enter your page</small>}</div><div className="progress-stepper"><button type="button" aria-label="Previous page" onClick={()=>setEditPage(v=>Math.max(0,v-5))}><Minus/></button><input aria-label="Page progress" type="number" min="0" max={totalPages||undefined} value={editPage} onChange={e=>setEditPage(Math.max(0,Math.min(totalPages||99999,Number(e.target.value)||0)))}/><button type="button" aria-label="Next page" onClick={()=>setEditPage(v=>Math.min(totalPages||99999,v+5))}><Plus/></button></div>{totalPages?<input aria-label="Page progress slider" className="progress-slider" type="range" min="0" max={totalPages} value={Math.min(editPage,totalPages)} style={{'--progress-preview':`${Math.round((Math.min(editPage,totalPages)/totalPages)*100)}%`} as CSSProperties} onChange={e=>setEditPage(Number(e.target.value))}/>:null}</div>}
        <button type="button" className="primary full reading-progress-save" disabled={progressBusy} onClick={saveReadingProgress}>{progressBusy?'Saving…':'Save progress'}</button>
      </div>
    </Modal>
    <Modal open={Boolean(marginType)} onClose={()=>setMarginType(null)} title={marginType==='quote'?'Save a quote':'Add a private note'}>
      <div className="margin-editor"><div className="margin-capture-actions"><label><Upload/> Upload<input type="file" accept="image/*,.txt,text/plain" hidden onChange={e=>void captureMarginFile(e.target.files?.[0])}/></label><label><Camera/> Photo<input type="file" accept="image/*" capture="environment" hidden onChange={e=>void captureMarginFile(e.target.files?.[0])}/></label><button type="button" onClick={()=>setNotice('Take a screenshot, then upload it here to attach it to your margins.')}><FileText/> Screenshot</button></div><label>{marginType==='quote'?'Quote':'Note'}<textarea value={marginBody} onChange={e=>setMarginBody(e.target.value)} autoFocus/></label>{marginType==='quote'&&<label>Why save it? <span>optional</span><input value={marginNote} onChange={e=>setMarginNote(e.target.value)}/></label>}<div className="margin-editor-row"><label>Page <span>optional</span><input type="number" min="1" value={marginPage||''} onChange={e=>setMarginPage(Number(e.target.value)||undefined)}/></label><button type="button" className="primary" disabled={marginBusy||!marginBody.trim()} onClick={saveMargin}>{marginBusy?'Saving…':'Save'}</button></div></div>
    </Modal>
    <Modal open={referenceOpen} onClose={()=>setReferenceOpen(false)} title="Quick reference">
      <div className="quick-reference"><div className="search-field"><Search/><input autoFocus value={referenceQuery} onChange={e=>setReferenceQuery(e.target.value)} placeholder="Character, place, term…"/></div>{referenceQuery.trim()&&!referenceMatches.length?<div className="context-empty compact"><h3>Not available yet.</h3></div>:<div className="reference-results">{referenceMatches.map((x:any)=><article key={`${x.kind}-${x.title}`}><small>{x.kind}</small><h3>{x.title}</h3><p>{x.summary_short||x.summary_medium}</p></article>)}</div>}</div>
    </Modal>
  </div>;
}

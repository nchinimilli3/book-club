import { useEffect, useState } from 'react';
import { ArrowLeft, Heart, MessageCircle, Quote, Search, Share2, Sparkles, StickyNote, Trash2 } from 'lucide-react';
import { useRouter } from '../lib/router';
import { useApp } from '../lib/AppContext';
import { createReply, createThought, deleteMargin, getBookContext, getMargins, removeMeetingQuestion, saveMeetingQuestion, savePrivateNote, saveQuote, toggleReaction } from '../lib/data';
import { getReaderContext } from '../lib/api';
import { Modal } from '../components/Modal';
import type { MarginItem } from '../lib/model';

type Depth='short'|'medium'|'deep';
type ComposerType='thought'|'question'|'prediction';

async function commons(query:string){
  try{
    const u=`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url|mime&iiurlwidth=900&format=json&origin=*`;
    const r=await fetch(u);const j=await r.json();
    return Object.values(j.query?.pages||{}).map((p:any)=>({url:p.imageinfo?.[0]?.thumburl||p.imageinfo?.[0]?.url,mime:p.imageinfo?.[0]?.mime,title:p.title?.replace('File:','')}))
      .filter((x:any)=>x.url&&String(x.mime||'').startsWith('image/')&&!/\.svg$/i.test(x.title||''))
      .slice(0,6);
  }catch{return[]}
}

export function ReadingRoom({clubId,clubBookId}:{clubId:string;clubBookId:string}){
  const a=useApp(),{navigate:nav}=useRouter(),w=a.workspace;
  const[tab,setTab]=useState<'discussion'|'context'|'calendar'|'notes'|'characters'>('discussion');
  const[depth,setDepth]=useState<Depth>('short');
  const[context,setContext]=useState<any[]>([]);
  const[contextLoading,setContextLoading]=useState(false);
  const[contextError,setContextError]=useState('');
  const[images,setImages]=useState<any[]>([]);
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
  const cb=w?.currentBook;

  if(!w||!cb||cb.id!==clubBookId)return <div className="page"><div className="empty-state"><h2>This reading room isn't available.</h2><button className="primary" onClick={()=>nav(clubId?`/clubs/${clubId}`:'/clubs')}>Back to club</button></div></div>;
  const currentBook=cb,b=currentBook.book,chapter=w.myProgress?.chapter||0;

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
    Promise.all([commons(`${b.author} portrait`),commons(`${b.title} ${b.author} setting history`)]).then(([one,two])=>{if(!cancelled)setImages([...one,...two].filter((x,i,a)=>a.findIndex(y=>y.url===x.url)===i).slice(0,6))});
    return()=>{cancelled=true};
  },[b.id,b.title,b.author,b.year,chapter]);

  async function loadMargins(){if(a.user)try{setMargins(await getMargins(currentBook.id,a.user.id))}catch(err:any){setNotice(err?.message||'Could not load your margins.')}}
  useEffect(()=>{void loadMargins()},[currentBook.id,a.user?.id]);

  const chars=context.filter(x=>String(x.kind).toLowerCase().includes('character'));
  const visible=w.thoughts.filter(t=>!t.chapter||t.chapter<=chapter);
  const referenceMatches=referenceQuery.trim()?context.filter(x=>`${x.title||''} ${x.summary_short||''} ${x.summary_medium||''}`.toLowerCase().includes(referenceQuery.trim().toLowerCase())).slice(0,4):[];

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
  async function toggleMeetingSave(postId:string,body:string,saved?:boolean){try{if(saved){const q=w!.meetingQuestions.find(x=>x.postId===postId);if(q)await removeMeetingQuestion(q.id);setNotice('Removed from the meeting agenda.')}else{await saveMeetingQuestion(currentBook.id,postId,body);setNotice('Saved for the meeting.')}await a.refresh()}catch(err:any){setNotice(err?.message||'Could not update the meeting agenda.')}}
  async function shareBook(){const data={title:b.title,text:`${b.title} by ${b.author}`,url:location.href};try{if(navigator.share)await navigator.share(data);else if(navigator.clipboard){await navigator.clipboard.writeText(location.href);setNotice('Reading room link copied.')}}catch(err:any){if(err?.name!=='AbortError')setNotice('Could not share this page.')}}

  return <div className={`page reading-room tone-${w.club.tone}`}>
    <header className="reading-top"><button className="back-link" onClick={()=>nav(`/clubs/${w.club.id}`)}><ArrowLeft/> {w.club.name}</button><button className="icon-button" onClick={shareBook} aria-label="Share reading room"><Share2/></button></header>
    {notice&&<div className="save-notice" role="status">{notice}</div>}
    <section className="reading-cover-story"><div className="reading-copy"><p>{w.club.name} · current book</p><h1>{b.title}</h1><h2>{b.author}</h2><div className="position"><span>Your place</span><b>{w.myProgress?.page&&!currentBook.totalChapters?`Page ${w.myProgress.page}`:chapter?`Chapter ${chapter}`:'Not started'}</b></div></div><div className="reading-art">{b.coverUrl&&<img className="main-cover" src={b.coverUrl} alt={`Cover of ${b.title}`}/>} {images[0]&&<figure className="archive-image one"><img src={images[0].url} alt=""/></figure>}{images[1]&&<figure className="archive-image two"><img src={images[1].url} alt=""/></figure>}</div></section>
    <nav className="reading-tabs">{(['discussion','context','calendar','notes','characters'] as const).map(x=><button className={tab===x?'active':''} onClick={()=>setTab(x)} key={x}>{x}</button>)}</nav>

    {tab==='discussion'&&<section className="reading-section discussion-section"><header className="section-intro"><h2>Discussion</h2><p>Your progress is the spoiler boundary.</p></header>
      {w.lockedPostCount>0&&<button type="button" className="unlock-banner" onClick={()=>setNotice('Update your progress from the club home to unlock these when you reach them.')}><Sparkles/><span><b>{w.lockedPostCount} {w.lockedPostCount===1?'thought':'thoughts'} waiting for you</b><small>They unlock automatically as you catch up.</small></span></button>}
      <div className="reading-quick-tools"><button type="button" onClick={()=>{setReferenceQuery('');setReferenceOpen(true)}}><Search/> Who is that? / What does that mean?</button>{w.meetingQuestions.length>0&&<button type="button" onClick={()=>setTab('calendar')}><MessageCircle/> {w.meetingQuestions.length} for the meeting</button>}</div>
      <div className="composer-inline">
        <div className="composer-types">{(['thought','question','prediction'] as ComposerType[]).map(x=><button type="button" key={x} className={composerType===x?'active':''} onClick={()=>setComposerType(x)}>{x[0].toUpperCase()+x.slice(1)}</button>)}</div>
        <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder={composerType==='prediction'?'Make a prediction…':composerType==='question'?'What are you wondering?':`A thought from Chapter ${chapter||'…'}`}/>
        <div><span>{composerType==='prediction'?'Predictions are sealed after posting.':`Tagged at Ch. ${chapter||'—'}`}</span><button className="primary" onClick={post} disabled={posting||!note.trim()}>{posting?'Posting…':'Post'}</button></div>{postError&&<p className="error-text">{postError}</p>}
      </div>
      <div className="thought-stream">{visible.map(t=>{
        const hearts=(t.reactions||[]).filter(r=>r.reaction==='heart');const mine=hearts.some(r=>r.userId===a.user?.id);
        return <article key={t.id} className={`thought thought-${t.type}`}><header><div className="person-dot">{t.author?.displayName?.slice(0,1)||'R'}</div><div><b>{t.author?.displayName||'Reader'}</b><span>{t.type==='prediction'?'Prediction · sealed':t.type==='question'?'Question':t.chapter?`Chapter ${t.chapter}`:'No spoiler tag'}</span></div></header><p>{t.body}</p>
          <div className="post-actions"><button type="button" className={mine?'active':''} onClick={()=>react(t.id)}><Heart fill={mine?'currentColor':'none'}/> {hearts.length||''}</button><button type="button" onClick={()=>{setReplyingTo(replyingTo===t.id?null:t.id);setReplyBody('')}}><MessageCircle/> Reply{t.replyItems?.length?` · ${t.replyItems.length}`:''}</button><button type="button" className={t.savedForMeeting?'active':''} onClick={()=>toggleMeetingSave(t.id,t.body,t.savedForMeeting)}><StickyNote/> {t.savedForMeeting?'On agenda':'Discuss at meeting'}</button></div>
          {t.replyItems?.length?<div className="reply-list">{t.replyItems.map(r=><div key={r.id}><b>{r.author?.displayName||'Reader'}</b><p>{r.body}</p></div>)}</div>:null}
          {replyingTo===t.id&&<div className="reply-composer"><input value={replyBody} onChange={e=>setReplyBody(e.target.value)} placeholder="Write a reply" autoFocus/><button type="button" className="primary" disabled={!replyBody.trim()||posting} onClick={()=>reply(t.id)}>Reply</button></div>}
        </article>})}{!visible.length&&!posting&&<div className="context-empty"><MessageCircle/><h3>No thoughts here yet.</h3><p>Post the first one for this reading cycle.</p></div>}</div>
    </section>}

    {tab==='context'&&<section className="reading-section context-section"><header className="section-intro split"><div><h2>The world around {b.title}</h2><p>Source-backed context for this specific book.</p></div><div className="depth-switch">{(['short','medium','deep'] as Depth[]).map(d=><button className={depth===d?'active':''} onClick={()=>setDepth(d)} key={d}>{d==='short'?'30 sec':d==='medium'?'2 min':'Deep dive'}</button>)}</div></header><div className="context-collage">{images.slice(0,3).map((im,i)=><figure key={im.url} className={`collage-${i}`}><img src={im.url} alt=""/></figure>)}<div className="context-pull"><span>{b.year||''}</span><p>{b.author}</p></div></div><div className="context-list">{contextLoading?<div className="context-empty"><Sparkles/><h3>Loading research…</h3></div>:contextError?<div className="context-empty"><h3>Research couldn't load.</h3><p>{contextError}</p></div>:context.length?context.filter(x=>!String(x.kind).toLowerCase().includes('character')).map((x:any,i)=><article key={x.id||`${x.kind}-${i}`}><span>{String(i+1).padStart(2,'0')}</span><div><h3>{x.title}</h3><p>{depth==='short'?x.summary_short:depth==='medium'?x.summary_medium:x.summary_deep}</p>{x.context_sources?.length>0&&<details><summary>Sources</summary>{x.context_sources.map((s:any)=><a href={s.source_url} target="_blank" rel="noreferrer" key={s.source_url}>{s.source_name||'Source'}</a>)}</details>}</div></article>):<div className="context-empty"><Sparkles/><h3>Context isn't ready for this title yet.</h3><p>The app will only show research it can ground in sources.</p></div>}</div></section>}

    {tab==='calendar'&&<section className="reading-section calendar-section"><header className="section-intro"><h2>Meeting agenda</h2><p>Questions and moments your club saved while reading.</p></header>{w.meetingQuestions.length?<div className="meeting-agenda-list">{w.meetingQuestions.map((q,i)=><article key={q.id}><span>{String(i+1).padStart(2,'0')}</span><div><b>{q.body}</b>{q.addedBy&&<small>Added by {q.addedBy.displayName}</small>}</div></article>)}</div>:<div className="context-empty compact"><MessageCircle/><h3>Nothing saved yet.</h3><p>Use “Discuss at meeting” on a post to build the agenda as you read.</p></div>}<header className="section-intro reading-plan-head"><h2>Reading plan</h2><p>{currentBook.targetFinishDate?`Finish target · ${new Date(currentBook.targetFinishDate+'T12:00').toLocaleDateString()}`:'Set a finish date from club Home to build the timeline.'}</p></header>{w.checkpoints.length?<div className="timeline">{w.checkpoints.map((c,i)=><article key={c.id}><time>{new Date(c.dueAt+'T12:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</time><div className="timeline-rule"><i className={i===0?'current':''}/></div><div><span>{c.label||'Checkpoint'}</span><h3>{c.targetChapter?`Through Chapter ${c.targetChapter}`:c.targetPage?`Through page ${c.targetPage}`:'Reading checkpoint'}</h3></div></article>)}</div>:<div className="context-empty"><CalendarIcon/><h3>No checkpoints yet.</h3><p>Set the finish date on club Home and BOOK CLUB will build them.</p></div>}</section>}

    {tab==='notes'&&<section className="reading-section margins-section"><header className="section-intro split"><div><h2>Your margins</h2><p>Notes and saved quotes here are private to you.</p></div><div className="margin-actions"><button type="button" onClick={()=>setMarginType('note')}><StickyNote/> Add note</button><button type="button" onClick={()=>setMarginType('quote')}><Quote/> Save quote</button><button type="button" onClick={()=>{setComposerType('prediction');setTab('discussion')}}><Sparkles/> Prediction</button></div></header>{margins.length?<div className="margin-list">{margins.map(item=><article key={`${item.kind}-${item.id}`}><span>{item.kind==='quote'?'Quote':'Note'}{item.chapter?` · Ch. ${item.chapter}`:''}{item.page?` · p. ${item.page}`:''}</span><p>{item.kind==='quote'?`“${item.body}”`:item.body}</p>{item.note&&<small>{item.note}</small>}<button type="button" onClick={()=>removeMargin(item)} aria-label="Delete"><Trash2/></button></article>)}</div>:<div className="context-empty"><StickyNote/><h3>Your margins are empty.</h3><p>Save something you want to remember without posting it to the club.</p></div>}</section>}

    {tab==='characters'&&<section className="reading-section"><header className="section-intro"><h2>Character map</h2><p>Only character information returned by source-backed research.</p></header>{chars.length?<div className="character-list">{chars.map((c:any)=><article key={c.id||c.title}><div className="character-monogram">{c.title.slice(0,1)}</div><div><h3>{c.title}</h3><p>{c.summary_short}</p></div></article>)}</div>:<div className="context-empty"><Search/><h3>No verified character data yet.</h3><p>BOOK CLUB leaves this empty instead of inventing relationships.</p></div>}</section>}

    <Modal open={Boolean(marginType)} onClose={()=>setMarginType(null)} title={marginType==='quote'?'Save a quote':'Add a private note'}>
      <div className="margin-editor"><label>{marginType==='quote'?'Quote':'Note'}<textarea value={marginBody} onChange={e=>setMarginBody(e.target.value)} autoFocus/></label>{marginType==='quote'&&<label>Why save it? <span>optional</span><input value={marginNote} onChange={e=>setMarginNote(e.target.value)}/></label>}<label>Page <span>optional</span><input type="number" min="1" value={marginPage||''} onChange={e=>setMarginPage(Number(e.target.value)||undefined)}/></label><button type="button" className="primary full" disabled={marginBusy||!marginBody.trim()} onClick={saveMargin}>{marginBusy?'Saving…':'Save'}</button></div>
    </Modal>
    <Modal open={referenceOpen} onClose={()=>setReferenceOpen(false)} title="Quick reference">
      <div className="quick-reference"><p>Search only the source-backed context available for where you are in the book.</p><div className="search-field"><Search/><input autoFocus value={referenceQuery} onChange={e=>setReferenceQuery(e.target.value)} placeholder="Character, place, term…"/></div>{referenceQuery.trim()&&!referenceMatches.length?<div className="context-empty compact"><h3>Not verified yet.</h3><p>There isn’t source-backed context for that term at your current spoiler boundary.</p></div>:<div className="reference-results">{referenceMatches.map((x:any)=><article key={`${x.kind}-${x.title}`}><small>{x.kind}</small><h3>{x.title}</h3><p>{x.summary_short||x.summary_medium}</p></article>)}</div>}</div>
    </Modal>
  </div>;
}

function CalendarIcon(){return <span aria-hidden="true" style={{fontSize:30}}>○</span>}

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpen, Calendar, Check, ExternalLink, Lightbulb, MessageCircle, Plus, Sparkles, Star, Trash2, UserPlus, Vote } from 'lucide-react';
import { useRouter } from '../lib/router';
import { useApp } from '../lib/AppContext';
import {
  archiveClubBook,
  cancelMeeting,
  castVote,
  createOrGetInvite,
  finalizeBallot,
  finishClubBook,
  getBallot,
  markAcquired,
  rsvp,
  saveBookToClub,
  saveClubRating,
  scheduleMeeting,
  setFinishDate,
  startBallotFromIdeas,
  updateProgress,
} from '../lib/data';
import { beginCalendarConnect, getCalendarStatus, getClubRecommendations, removeMeetingFromCalendar, syncMeetingToCalendar, type ClubRecommendation } from '../lib/api';
import type { ClubBook } from '../lib/model';

const fmt=(iso?:string)=>iso?new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(iso)):'';
const localInput=(iso?:string)=>{if(!iso)return'';const d=new Date(iso);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)};
function googleCalendarHref(title:string,start:string,details=''){
  const d=new Date(start),end=new Date(d.getTime()+90*60*1000);const f=(x:Date)=>x.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${f(d)}/${f(end)}&details=${encodeURIComponent(details)}`;
}

export function HomePage(){
  const a=useApp(),w=a.workspace,{navigate:nav}=useRouter();
  const[ballot,setBallot]=useState<any>(null);
  const[chapter,setChapter]=useState(w?.myProgress?.chapter||1);
  const[page,setPage]=useState(w?.myProgress?.page||1);
  const[progressOpen,setProgressOpen]=useState(false);
  const[finishOpen,setFinishOpen]=useState(false);
  const[finish,setFinish]=useState('');
  const[planChapters,setPlanChapters]=useState(w?.currentBook?.totalChapters||0);
  const[planPages,setPlanPages]=useState(w?.currentBook?.totalPages||w?.currentBook?.book.pages||0);
  const[meetingOpen,setMeetingOpen]=useState(false);
  const[meetingWhen,setMeetingWhen]=useState('');
  const[meetingType,setMeetingType]=useState('facetime');
  const[meetingUrl,setMeetingUrl]=useState('');
  const[ratingOpen,setRatingOpen]=useState(false);
  const[rating,setRating]=useState(w?.myClubRating?.rating||0);
  const[review,setReview]=useState(w?.myClubRating?.review||'');
  const[recommend,setRecommend]=useState<boolean|undefined>(w?.myClubRating?.recommend);
  const[acquireOpen,setAcquireOpen]=useState(false);
  const[readingFormat,setReadingFormat]=useState('Physical');
  const[recOpen,setRecOpen]=useState(false);
  const[recommendations,setRecommendations]=useState<ClubRecommendation[]>([]);
  const[recLoading,setRecLoading]=useState(false);
  const[calendarConnected,setCalendarConnected]=useState(false);
  const[busy,setBusy]=useState(false);
  const[actionError,setActionError]=useState('');
  const[actionNotice,setActionNotice]=useState('');

  useEffect(()=>{
    if(w?.club.phase==='choosing'&&a.user)getBallot(w.club.id,a.user.id).then(setBallot).catch(e=>setActionError(e.message));
    else setBallot(null);
  },[w?.club.id,w?.club.phase,a.user?.id]);
  useEffect(()=>{setChapter(w?.myProgress?.chapter||1);setPage(w?.myProgress?.page||1)},[w?.myProgress?.chapter,w?.myProgress?.page,w?.currentBook?.id]);
  useEffect(()=>{setPlanChapters(w?.currentBook?.totalChapters||0);setPlanPages(w?.currentBook?.totalPages||w?.currentBook?.book.pages||0)},[w?.currentBook?.id,w?.currentBook?.totalChapters,w?.currentBook?.totalPages]);
  useEffect(()=>{setRating(w?.myClubRating?.rating||0);setReview(w?.myClubRating?.review||'');setRecommend(w?.myClubRating?.recommend)},[w?.currentBook?.id,w?.myClubRating?.rating,w?.myClubRating?.review,w?.myClubRating?.recommend]);

  if(!w)return <div className="page"><div className="empty-state"><h2>This club couldn't load.</h2></div></div>;
  const workspace=w,b=workspace.currentBook?.book;
  const me=workspace.members.find(m=>m.id===a.user?.id);
  const canManage=workspace.club.ownerId===a.user?.id||me?.role==='admin'||me?.role==='owner';
  const usePages=!workspace.currentBook?.totalChapters&&Boolean(workspace.currentBook?.totalPages||b?.pages);
  const pct=workspace.myProgress?.percent??(
    workspace.currentBook?.totalChapters&&workspace.myProgress?.chapter?Math.round(workspace.myProgress.chapter/workspace.currentBook.totalChapters*100):
    (workspace.currentBook?.totalPages||b?.pages)&&workspace.myProgress?.page?Math.round((workspace.myProgress.page||0)/(workspace.currentBook?.totalPages||b?.pages||1)*100):undefined
  );
  const unlocked=workspace.thoughts.slice(0,3);
  const myFinished=workspace.myProgress?.status==='finished'||(pct!=null&&pct>=100);
  const finishedMembers=workspace.members.filter(m=>m.status==='finished').length;

  async function run(fn:()=>Promise<void>){setBusy(true);setActionError('');setActionNotice('');try{await fn()}catch(e:any){setActionError(e?.message||'That action could not be completed.')}finally{setBusy(false)}}
  async function saveProgress(){if(!workspace.currentBook)return;await run(async()=>{await updateProgress(workspace.currentBook!.id,usePages?undefined:chapter,'reading',workspace.currentBook!.totalChapters,usePages?page:undefined,workspace.currentBook!.totalPages||b?.pages);await a.refresh();setProgressOpen(false)})}
  async function markFinished(){if(!workspace.currentBook)return;await run(async()=>{await updateProgress(workspace.currentBook!.id,workspace.currentBook!.totalChapters||chapter,'finished',workspace.currentBook!.totalChapters,workspace.currentBook!.totalPages||b?.pages,workspace.currentBook!.totalPages||b?.pages);await a.refresh();setProgressOpen(false);setActionNotice('Marked finished for you.')})}
  async function gotIt(){if(!workspace.currentBook)return;await run(async()=>{await markAcquired(workspace.currentBook!.id,readingFormat);await a.refresh();setAcquireOpen(false);setActionNotice(`${readingFormat} copy saved.`)})}
  async function saveFinish(){if(!workspace.currentBook||!finish)return;await run(async()=>{await setFinishDate(workspace.currentBook!.id,finish,planChapters||undefined,planPages||undefined);await a.refresh();setFinishOpen(false)})}
  async function startVote(){await run(async()=>{await startBallotFromIdeas(workspace.club.id);await a.refresh();if(a.user)setBallot(await getBallot(workspace.club.id,a.user.id))})}
  async function finishVote(){if(!ballot)return;await run(async()=>{await finalizeBallot(ballot.id);setBallot(null);await a.refresh()})}
  async function saveMeeting(){if(!a.user||!meetingWhen)return;await run(async()=>{const saved:any=await scheduleMeeting(workspace.club.id,workspace.currentBook?.id,a.user!.id,new Date(meetingWhen).toISOString(),meetingType,meetingUrl||undefined,workspace.meeting?.id);await a.refresh();setMeetingOpen(false);setActionNotice(workspace.meeting?'Meeting updated.':'Meeting scheduled.');if(calendarConnected&&saved?.id){try{await syncMeetingToCalendar(saved.id);setActionNotice('Meeting saved and synced to Google Calendar.')}catch{setActionNotice('Meeting saved. Calendar sync can be retried from meeting details.')}}})}
  async function setRsvp(response:'going'|'maybe'|'cant'){if(!workspace.meeting||!a.user)return;await run(async()=>{await rsvp(workspace.meeting!.id,a.user!.id,response);await a.refresh()})}
  async function moveToRatings(){if(!workspace.currentBook)return;await run(async()=>{await finishClubBook(workspace.currentBook!.id);await a.refresh();setRatingOpen(true)})}
  async function saveRating(){if(!workspace.currentBook||!rating)return;await run(async()=>{await saveClubRating(workspace.currentBook!.id,rating,review,recommend);await a.refresh();setRatingOpen(false);setActionNotice('Rating saved.')})}
  async function archiveRead(){if(!workspace.currentBook)return;await run(async()=>{await archiveClubBook(workspace.currentBook!.id);await a.refresh();setActionNotice('Added to the club shelf. Time to choose the next one.')})}
  async function shareInvite(){
    try{const code=await createOrGetInvite(workspace.club.id);const url=`${location.origin}/join/${code}`;if(navigator.share)await navigator.share({title:workspace.club.name,url});else if(navigator.clipboard)await navigator.clipboard.writeText(url);else throw new Error('Clipboard unavailable');setActionNotice('Invite ready to share.')}catch(e:any){if(e?.name!=='AbortError')setActionError(e?.message||'Could not share the invite.')}
  }
  async function openMeetingEditor(){setMeetingWhen(localInput(workspace.meeting?.startsAt));setMeetingType(workspace.meeting?.meetingType||'facetime');setMeetingUrl(workspace.meeting?.meetingUrl||'');setMeetingOpen(true);const cs=await getCalendarStatus();setCalendarConnected(Boolean(cs.connected))}
  function openIdea(x:ClubBook){sessionStorage.setItem('bookclub:open-book',JSON.stringify({key:`db:${x.book.id}`,source:'openlibrary',title:x.book.title,author:x.book.author,cover:x.book.coverUrl||'',year:x.book.year,isbn:x.book.isbn,pages:x.book.pages,description:x.book.description}));nav('/search')}
  async function loadRecommendations(){setRecOpen(true);setRecLoading(true);setActionError('');try{setRecommendations(await getClubRecommendations(workspace.club.id))}catch(e:any){setActionError(e?.message||'Could not build recommendations.');setRecommendations([])}finally{setRecLoading(false)}}
  async function addRecommendation(r:ClubRecommendation){await run(async()=>{await saveBookToClub(workspace.club.id,{title:r.title,author:r.author,cover:r.cover||'',year:r.year,isbn:r.isbn,pages:r.pages,description:r.description});await a.refresh();setActionNotice(`${r.title} added to the table.`)})}
  async function syncCalendar(){if(!workspace.meeting)return;await run(async()=>{await syncMeetingToCalendar(workspace.meeting!.id);setActionNotice('Synced to your Google Calendar.')})}
  async function cancelCurrentMeeting(){if(!workspace.meeting)return;await run(async()=>{try{await removeMeetingFromCalendar(workspace.meeting!.id)}catch{}await cancelMeeting(workspace.meeting!.id);setMeetingOpen(false);await a.refresh();setActionNotice('Meeting cancelled.')})}

  return <div className={`page club-home tone-${workspace.club.tone}`}>
    <section className="club-masthead">
      <div className="club-masthead-copy"><p>{workspace.club.memberCount} {workspace.club.memberCount===1?'reader':'readers'} · private</p><h1>{workspace.club.name}</h1></div>
      <div className="club-top-actions">
        <button type="button" onClick={()=>void openMeetingEditor()}><Calendar/><span>{workspace.meeting?fmt(workspace.meeting.startsAt):'Calendar'}</span></button>
        {!b&&canManage&&<button type="button" disabled={busy||workspace.ideaBooks.length<2} onClick={startVote}><Vote/><span>Vote</span></button>}
        <button type="button" onClick={shareInvite}><UserPlus/><span>Invite</span></button>
      </div>
    </section>

    {actionError&&<div className="save-notice error-text" role="alert">{actionError}</div>}
    {actionNotice&&<div className="save-notice" role="status">{actionNotice}</div>}

    {workspace.club.phase==='choosing'&&ballot?<section className="ballot-home">
      <header><div><span className="choice-kicker">Voting now</span><h2>Choose the next book</h2></div><p>Your vote stays private until the ballot closes.</p></header>
      <div className="ballot-covers">{ballot.nominations.map((n:any)=><button type="button" key={n.id} className={n.voted?'voted':''} disabled={busy} onClick={()=>run(async()=>{await castVote(n.id);if(a.user)setBallot(await getBallot(workspace.club.id,a.user.id))})}>{n.book.coverUrl&&<img src={n.book.coverUrl} alt={`Cover of ${n.book.title}`}/>}<b>{n.book.title}</b><span>{n.voted?'Your vote':'Vote'}</span></button>)}</div>
      {canManage&&<button type="button" className="primary" disabled={busy} onClick={finishVote}>Close vote & pick winner</button>}
    </section>:!b?<>
      <section className="club-choice-stage">
        <div className="choice-stage-copy"><span className="choice-kicker">Next read</span><h2>What should we read?</h2><div className="choice-meta"><b>{workspace.ideaBooks.length}</b><span>{workspace.ideaBooks.length===1?'book on the table':'books on the table'}</span></div></div>
        <div className="choice-stage-actions"><button type="button" className="primary" onClick={()=>nav('/search')}><Plus/> Add a book</button><button type="button" className="quiet-action recommendation-cta" onClick={()=>void loadRecommendations()}><Sparkles/> Get suggestions</button>{canManage&&<button type="button" className="vote-cta" disabled={busy||workspace.ideaBooks.length<2} onClick={startVote}><Vote/> Start the vote <ArrowRight/></button>}<button type="button" className="quiet-action" onClick={shareInvite}><UserPlus/> Invite friends</button></div>
      </section>
      <section className="idea-pile-home">
        <header><div><h2>Books on the table</h2><span>{workspace.ideaBooks.length} potential {workspace.ideaBooks.length===1?'pick':'picks'}</span></div><div className="idea-header-actions"><button type="button" onClick={()=>nav('/search')}><Plus/> Add another</button><button type="button" onClick={()=>void openMeetingEditor()}><Calendar/> Calendar</button>{canManage&&<button type="button" className="idea-vote-button" disabled={busy||workspace.ideaBooks.length<2} onClick={startVote}><Vote/> Vote</button>}</div></header>
        {workspace.ideaBooks.length?<div className="idea-pile-covers">{workspace.ideaBooks.map(x=><button type="button" className="idea-book-card" key={x.id} onClick={()=>openIdea(x)}>{x.book.coverUrl&&<img loading="lazy" src={x.book.coverUrl} alt={`Cover of ${x.book.title}`}/>}<div><b>{x.book.title}</b><span>{x.book.author}</span><small>Suggested by {x.suggestedBy?.id===a.user?.id?'you':x.suggestedBy?.displayName||'a club member'}</small></div></button>)}</div>:<div className="idea-empty"><button type="button" onClick={()=>nav('/search')}>Find the first book <ArrowRight/></button></div>}
      </section>
      <section className="club-calendar-strip"><div><Calendar/><span>Next meeting</span></div>{workspace.meeting?<><b>{fmt(workspace.meeting.startsAt)}</b><button type="button" onClick={()=>void openMeetingEditor()}>View</button></>:<><b>Not scheduled</b>{canManage&&<button type="button" onClick={()=>void openMeetingEditor()}>Pick a time</button>}</>}</section>
    </>:<>
      <section className="book-hero">
        <div className="hero-copy">
          <p className="phase">{workspace.club.phase==='acquiring'?'Getting copies':workspace.club.phase==='rating'?'Finished together':'Currently reading'}</p>
          <h2>{b.title}</h2><p className="author">{b.author}</p>
          {workspace.club.phase==='acquiring'?<><p className="state-line"><b>{workspace.acquired} of {workspace.members.length}</b> have their copy</p><div className="hero-actions"><button type="button" className="primary" onClick={()=>setAcquireOpen(true)}><Check/> I have it</button>{canManage&&workspace.acquired>=Math.max(1,workspace.members.length)&&<button type="button" className="secondary" onClick={()=>setFinishOpen(true)}>Set finish date</button>}</div></>
          :workspace.club.phase==='rating'?<div className="hero-actions"><button type="button" className="primary" onClick={()=>setRatingOpen(true)}><Star/> {workspace.myClubRating?'Edit your rating':'Rate this book'}</button>{canManage&&<button type="button" className="secondary" onClick={archiveRead}>Add to club shelf</button>}</div>
          :<><button type="button" className="progress-button" onClick={()=>setProgressOpen(true)}><span>You're at</span><b>{usePages?`Page ${workspace.myProgress?.page||1}`:`Chapter ${workspace.myProgress?.chapter||1}`}</b><em>{pct!=null?`${pct}%`:''}</em></button><div className="hero-actions"><button type="button" className="primary open-reading-room" onClick={()=>nav(`/clubs/${workspace.club.id}/books/${workspace.currentBook!.id}`)}>Open reading room <ArrowRight/></button>{canManage&&myFinished&&<button type="button" className="secondary" onClick={moveToRatings}>Move to ratings</button>}</div></>}
        </div>
        <div className="hero-cover-wrap">{b.coverUrl&&<img src={b.coverUrl} alt={`Cover of ${b.title}`}/>}<div className="color-plane"/></div>
      </section>

      {workspace.club.phase!=='rating'&&<section className="action-dashboard"><header><h2>For you</h2></header><div className="action-grid"><button type="button" onClick={()=>setProgressOpen(true)}><BookOpen/><div><b>Update progress</b><span>{usePages?`Page ${workspace.myProgress?.page||1}`:`Chapter ${workspace.myProgress?.chapter||1}`}</span></div><ArrowRight/></button>{workspace.meeting&&<button type="button" onClick={()=>void openMeetingEditor()}><Calendar/><div><b>{fmt(workspace.meeting.startsAt)}</b><span>{workspace.meeting.response?`RSVP · ${workspace.meeting.response==='cant'?"can't":workspace.meeting.response}`:'RSVP'}</span></div><ArrowRight/></button>}<button type="button" onClick={()=>nav(`/clubs/${workspace.club.id}/books/${workspace.currentBook!.id}`)}><MessageCircle/><div><b>{workspace.lockedPostCount?`${workspace.lockedPostCount} waiting to unlock`:`${unlocked.length} recent posts`}</b><span>Discussion through your progress</span></div><ArrowRight/></button></div></section>}

      {unlocked.length>0&&<section className="home-discussion"><header><div><h2>Recently unlocked</h2></div><button type="button" onClick={()=>nav(`/clubs/${workspace.club.id}/books/${workspace.currentBook!.id}`)}>See discussion</button></header><div>{unlocked.map(t=><article key={t.id}><div className="post-meta"><b>{t.author?.displayName||'Reader'}</b><span>{t.chapter?`Chapter ${t.chapter}`:'No spoiler tag'}</span></div><p>{t.body}</p></article>)}</div></section>}

      <section className="club-lower-grid">
        <article className="meeting-panel"><header><Calendar/><span>Next meeting</span></header>{workspace.meeting?<><h3>{fmt(workspace.meeting.startsAt)}</h3><p>{finishedMembers}/{workspace.members.length} finished · {workspace.meetingQuestions.length} agenda {workspace.meetingQuestions.length===1?'item':'items'}</p><div className="button-row"><button type="button" className="secondary" onClick={()=>void openMeetingEditor()}>RSVP / details</button>{workspace.meeting.meetingUrl&&<a className="primary link-button" href={workspace.meeting.meetingUrl}>Join</a>}</div>{workspace.meetingQuestions.length>0&&<ol className="meeting-agenda-preview">{workspace.meetingQuestions.slice(0,3).map(q=><li key={q.id}>{q.body}</li>)}</ol>}</>:<><h3>Nothing scheduled yet.</h3>{canManage?<button type="button" className="primary" onClick={()=>void openMeetingEditor()}>Schedule meeting</button>:<p>An owner or admin can schedule the next meeting.</p>}</>}</article>
        <article className="shelf-panel"><header><span>Club shelf</span><button type="button" onClick={()=>nav(`/clubs/${workspace.club.id}/archive`)}>{workspace.archiveBooks.length} finished <ArrowRight/></button></header><div className="mini-shelf">{workspace.archiveBooks.slice(0,5).map(x=><div key={x.id}>{x.coverUrl&&<img loading="lazy" src={x.coverUrl} alt={`Cover of ${x.title}`}/>}</div>)}</div></article>
      </section>
    </>}

    {progressOpen&&<div className="modal-backdrop"><section className="dialog compact"><button className="dialog-close" onClick={()=>setProgressOpen(false)}>×</button><h2>Where are you?</h2>{usePages?<><label>Page</label><input type="number" min="1" max={workspace.currentBook?.totalPages||b?.pages} value={page} onChange={e=>setPage(Number(e.target.value))}/></>:<><label>Chapter</label><input type="number" min="1" max={workspace.currentBook?.totalChapters} value={chapter} onChange={e=>setChapter(Number(e.target.value))}/></>}<div className="modal-actions vertical"><button className="primary full" disabled={busy} onClick={saveProgress}>{busy?'Saving…':'Save progress'}</button><button className="secondary full" disabled={busy} onClick={markFinished}>I finished the book</button></div></section></div>}

    {acquireOpen&&<div className="modal-backdrop"><section className="dialog compact"><button className="dialog-close" onClick={()=>setAcquireOpen(false)}>×</button><h2>Got your copy?</h2><p>Choose the format you’re reading. You can change this later.</p><div className="format-picker">{['Physical','Kindle / ebook','Audiobook','Library'].map(x=><button type="button" className={readingFormat===x?'selected':''} onClick={()=>setReadingFormat(x)} key={x}>{x}</button>)}</div><button className="primary full" disabled={busy} onClick={gotIt}>{busy?'Saving…':'I have it'}</button></section></div>}

    {finishOpen&&<div className="modal-backdrop"><section className="dialog compact"><button className="dialog-close" onClick={()=>setFinishOpen(false)}>×</button><h2>Set the reading plan</h2><label>Finish by<input type="date" value={finish} onChange={e=>setFinish(e.target.value)}/></label><div className="plan-counts"><label>Chapters <span>if known</span><input type="number" min="1" value={planChapters||''} onChange={e=>setPlanChapters(Number(e.target.value)||0)}/></label><label>Pages <span>if known</span><input type="number" min="1" value={planPages||''} onChange={e=>setPlanPages(Number(e.target.value)||0)}/></label></div><button className="primary full" disabled={busy||!finish||(!planChapters&&!planPages)} onClick={saveFinish}>Create reading plan</button></section></div>}

    {meetingOpen&&<div className="modal-backdrop"><section className="dialog meeting-dialog"><button className="dialog-close" onClick={()=>setMeetingOpen(false)}>×</button><h2>{workspace.meeting?'Meeting details':'Schedule meeting'}</h2>{workspace.meeting&&<div className="meeting-readiness"><b>{finishedMembers}/{workspace.members.length} finished</b><span>{workspace.members.filter(m=>m.status!=='finished'&&m.chapter).slice(0,3).map(m=>`${m.displayName} ch. ${m.chapter}`).join(' · ')}</span></div>}{workspace.meeting&&<div className="rsvp-picker"><span>Your RSVP</span><div>{(['going','maybe','cant'] as const).map(x=><button type="button" key={x} className={workspace.meeting?.response===x?'selected':''} disabled={busy} onClick={()=>setRsvp(x)}>{x==='going'?'Going':x==='maybe'?'Maybe':"Can't make it"}</button>)}</div></div>}{canManage?<><label>Date and time<input type="datetime-local" value={meetingWhen} onChange={e=>setMeetingWhen(e.target.value)}/></label><label>Type<select value={meetingType} onChange={e=>setMeetingType(e.target.value)}><option value="facetime">FaceTime</option><option value="in_person">In person</option><option value="other">Other</option></select></label><label>Meeting link <span>optional</span><input value={meetingUrl} onChange={e=>setMeetingUrl(e.target.value)} placeholder="FaceTime or meeting URL"/></label><button className="primary full" disabled={busy||!meetingWhen} onClick={saveMeeting}>{busy?'Saving…':workspace.meeting?'Save meeting':'Schedule'}</button></>:!workspace.meeting&&<p>The club owner or an admin can schedule the next meeting.</p>}{workspace.meeting&&<div className="calendar-sync-actions">{calendarConnected?<button type="button" className="secondary full" onClick={syncCalendar}><Calendar/> Sync to Google Calendar</button>:<button type="button" className="secondary full" onClick={()=>void beginCalendarConnect()}><Calendar/> Connect Google Calendar</button>}<a className="secondary link-button full" href={googleCalendarHref(`${workspace.club.name} · ${b?.title||'Book club'}`,workspace.meeting.startsAt,workspace.meeting.meetingUrl||'')} target="_blank" rel="noreferrer"><ExternalLink/> One-time calendar add</a>{canManage&&<button type="button" className="meeting-cancel" onClick={cancelCurrentMeeting}><Trash2/> Cancel meeting</button>}</div>}</section></div>}

    {ratingOpen&&workspace.currentBook&&<div className="modal-backdrop"><section className="dialog rating-dialog"><button className="dialog-close" onClick={()=>setRatingOpen(false)}>×</button><h2>Rate {b?.title}</h2><div className="star-rating club-rating">{[1,2,3,4,5].map(n=><button type="button" key={n} className={rating>=n?'selected':''} onClick={()=>setRating(n)}><Star fill={rating>=n?'currentColor':'none'}/></button>)}</div><label>One-line take <span>optional</span><textarea value={review} maxLength={280} onChange={e=>setReview(e.target.value)} placeholder="What will you remember about it?"/></label><div className="recommend-picker"><span>Would you recommend it?</span><button type="button" className={recommend===true?'selected':''} onClick={()=>setRecommend(true)}>Yes</button><button type="button" className={recommend===false?'selected':''} onClick={()=>setRecommend(false)}>No</button></div><button className="primary full" disabled={busy||!rating} onClick={saveRating}>Save rating</button></section></div>}

    {recOpen&&<div className="modal-backdrop"><section className="dialog recommendation-dialog"><button className="dialog-close" onClick={()=>setRecOpen(false)}>×</button><div className="recommendation-head"><Sparkles/><div><h2>Suggestions for {workspace.club.name}</h2><p>Based on the club’s saved books, favorites, ratings, and finished reads.</p></div></div>{recLoading?<div className="recommendation-loading">Finding books that actually fit this group…</div>:recommendations.length?<div className="recommendation-list">{recommendations.map(r=><article key={`${r.title}-${r.author}`}><div className="recommendation-cover">{r.cover?<img src={r.cover} alt={`Cover of ${r.title}`}/>:<Lightbulb/>}</div><div><h3>{r.title}</h3><p className="author">{r.author}</p><p>{r.reason}</p><small>{[r.year,r.pages?`${r.pages} pages`:null,r.confidence].filter(Boolean).join(' · ')}</small></div><button type="button" className="secondary" onClick={()=>addRecommendation(r)}><Plus/> Add idea</button></article>)}</div>:<div className="empty-state compact-empty"><h3>No recommendations yet.</h3><p>Add a few favorites or rated books to member profiles, then try again.</p></div>}</section></div>}
  </div>;
}

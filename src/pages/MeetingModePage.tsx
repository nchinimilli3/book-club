import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, Heart, LockKeyhole, MessageCircleQuestion, Sparkles, Star, Users } from 'lucide-react';
import { BookCover } from '../components/BookCover';
import { revealPrediction, setCheckpointCheckin } from '../lib/data';
import { getMeetingGuide, type MeetingGuide } from '../lib/api';
import { formatMeetingDateTime } from '../lib/dateTime';
import { useApp } from '../lib/AppContext';
import { useRouter } from '../lib/router';
import { FeedbackMessage, PageState } from '../components/PageState';
import type { Checkpoint, Member, Thought, Workspace } from '../lib/model';
import { coverAccent } from '../features/reading-room/readingRoomUtils';

type GuideMode='themes'|'characters'|'plot';

const FALLBACK_GUIDE:MeetingGuide={
  themes:['What idea or tension kept resurfacing for you in this section?','Where did two people in the room interpret the same moment differently?','What feels more complicated now than it did at the start of this section?'],
  characters:['Whose choices are hardest to make sense of so far?','Which relationship or point of view changed your impression the most?','Who do you understand differently now, and what changed that?'],
  plotQuestions:['Which detail from this section feels most worth revisiting?','What question are you carrying into the next section?','What prediction would you make right now without reading ahead?'],
  openingQuestion:'What is the first thing you want to talk about from this section?',
  sourceBacked:false,
  ai:false,
};

function checkpointTitle(checkpoint?:Checkpoint){
  if(!checkpoint)return 'Current reading checkpoint';
  if(checkpoint.label)return checkpoint.label;
  if(checkpoint.targetChapter)return `Through Chapter ${checkpoint.targetChapter}`;
  if(checkpoint.targetPage)return `Through page ${checkpoint.targetPage}`;
  return 'Current reading checkpoint';
}

function memberReached(member:Member,checkpoint?:Checkpoint,current?:Workspace['currentBook']){if(member.status==='finished')return true;if(!checkpoint)return false;if(checkpoint.targetChapter&&member.chapter!=null)return member.chapter>=checkpoint.targetChapter;if(checkpoint.targetPage&&member.page!=null)return member.page>=checkpoint.targetPage;const total=current?.totalPages||current?.book.pages;if(checkpoint.targetPage&&total&&member.percent!=null)return member.percent>=checkpoint.targetPage/total*100;if(checkpoint.targetChapter&&current?.totalChapters&&member.percent!=null)return member.percent>=checkpoint.targetChapter/current.totalChapters*100;return false}
function memberProgressLabel(member:Member){if(member.status==='finished')return 'Finished';if(member.status==='dnf'||member.status==='sitting_out')return 'Sitting this one out';if(member.page!=null)return `Page ${member.page}`;if(member.chapter!=null)return `Chapter ${member.chapter}`;if(member.percent!=null)return `${Math.round(member.percent)}%`;return 'No progress update yet'}

function findMeetingCheckpoint(w:Workspace){
  if(!w.checkpoints.length)return undefined;
  if(w.meeting){
    const meetingTime=new Date(w.meeting.startsAt).getTime();
    const ranked=[...w.checkpoints].map(checkpoint=>({checkpoint,distance:Math.abs(new Date(`${checkpoint.dueAt}T19:00:00`).getTime()-meetingTime)})).sort((a,b)=>a.distance-b.distance);
    if(ranked[0]?.distance<=72*60*60*1000)return ranked[0].checkpoint;
  }
  const today=new Date();today.setHours(0,0,0,0);
  return w.checkpoints.find(checkpoint=>new Date(`${checkpoint.dueAt}T12:00:00`).getTime()>=today.getTime())||w.checkpoints[w.checkpoints.length-1];
}

export function MeetingModePage({clubId,clubBookId}:{clubId:string;clubBookId:string}){
  const a=useApp(),{navigate}=useRouter(),w=a.workspace;
  if(!w?.currentBook||w.currentBook.id!==clubBookId)return <div className="page"><PageState kind="error" title="Meeting mode isn’t available." action={<button className="primary" onClick={()=>navigate(`/clubs/${clubId}`)}>Back to club</button>}/></div>;
  return <MeetingRoomContent clubId={clubId} workspace={w} userId={a.user?.id} refresh={a.refresh} navigate={navigate}/>;
}

function MeetingRoomContent({clubId,workspace:w,userId,refresh,navigate}:{clubId:string;workspace:Workspace;userId?:string;refresh:()=>Promise<void>|void;navigate:(path:string,replace?:boolean)=>void}){
  const cb=w.currentBook!,b=cb.book;
  const[busy,setBusy]=useState<string|null>(null),[notice,setNotice]=useState(''),[step,setStep]=useState(0),[guideMode,setGuideMode]=useState<GuideMode>('themes'),[meetingGuide,setMeetingGuide]=useState<MeetingGuide|null>(null),[guideLoading,setGuideLoading]=useState(true),[bookAccent,setBookAccent]=useState('#bdd0b9');

  const checkpoint=useMemo(()=>findMeetingCheckpoint(w),[w.meeting?.startsAt,w.checkpoints]);
  const checkpointCheckins=useMemo(()=>checkpoint?w.checkpointCheckins.filter(item=>item.checkpointId===checkpoint.id):[],[checkpoint?.id,w.checkpointCheckins]);
  const checkinByUser=useMemo(()=>new Map(checkpointCheckins.map(item=>[item.userId,item.status])),[checkpointCheckins]);
  const reachedCount=checkpointCheckins.filter(item=>item.status==='reached').length,catchingUpCount=checkpointCheckins.filter(item=>item.status==='catching_up').length,notYetCount=checkpointCheckins.filter(item=>item.status==='not_yet').length;
  const persistedMyStatus=userId?checkinByUser.get(userId):undefined,myMember=userId?w.members.find(member=>member.id===userId):undefined,suggestedMyStatus:any=persistedMyStatus||(myMember&&memberReached(myMember,checkpoint,cb)?'reached':undefined);
  const checkpointIndex=checkpoint?w.checkpoints.findIndex(item=>item.id===checkpoint.id):-1;
  const previousCheckpoint=checkpointIndex>0?w.checkpoints[checkpointIndex-1]:undefined;
  const nextCheckpoint=checkpointIndex>=0&&checkpointIndex<w.checkpoints.length-1?w.checkpoints[checkpointIndex+1]:undefined;
  const isFinalCheckpoint=checkpointIndex>=0&&checkpointIndex===w.checkpoints.length-1;
  const rangeLabel=checkpoint?.targetChapter?`Chapters ${(previousCheckpoint?.targetChapter||0)+1}–${checkpoint.targetChapter}`:checkpoint?.targetPage?`Pages ${(previousCheckpoint?.targetPage||0)+1}–${checkpoint.targetPage}`:checkpointTitle(checkpoint);
  const withinBoundary=(thought:Thought)=>!checkpoint?.targetChapter||!thought.chapter||thought.chapter<=checkpoint.targetChapter;
  const visibleThoughts=useMemo(()=>w.thoughts.filter(withinBoundary),[w.thoughts,checkpoint?.targetChapter]);
  const predictions=useMemo(()=>visibleThoughts.filter(x=>x.type==='prediction'),[visibleThoughts]);
  const questionPostIds=useMemo(()=>new Set(w.meetingQuestions.map(q=>q.postId).filter(Boolean)),[w.meetingQuestions]);
  const savedThoughts=useMemo(()=>visibleThoughts.filter(x=>x.savedForMeeting&&x.type!=='prediction'&&!questionPostIds.has(x.id)),[visibleThoughts,questionPostIds]);
  const discussionPosts=useMemo(()=>visibleThoughts.filter(x=>x.type!=='prediction').sort((x,y)=>(y.reactions?.length||0)-(x.reactions?.length||0)),[visibleThoughts]);
  const favorites=discussionPosts.slice(0,4).filter(x=>(x.reactions?.length||0)>0);
  const unresolved=discussionPosts.filter(x=>x.type==='question'&&!x.savedForMeeting).slice(0,3);

  useEffect(()=>{let cancelled=false;void coverAccent(b.coverUrl||'',`${b.title} ${b.author}`).then(next=>{if(!cancelled)setBookAccent(next.accent)});return()=>{cancelled=true}},[b.id,b.coverUrl]);

  const aiPosts=useMemo(()=>visibleThoughts.filter(x=>x.type!=='prediction'&&(x.savedForMeeting||(x.reactions?.length||0)>0)).slice(0,10).map(x=>({type:x.type,body:x.body,chapter:x.chapter,author:x.author?.displayName,reactions:x.reactions?.length||0})),[visibleThoughts]);
  const aiQuestions=useMemo(()=>w.meetingQuestions.slice(0,10).map(q=>({body:q.body,author:q.addedBy?.displayName})),[w.meetingQuestions]);

  useEffect(()=>{
    let cancelled=false;
    setGuideLoading(true);
    getMeetingGuide({
      title:b.title,
      author:b.author,
      year:b.year,
      checkpoint:checkpoint?{label:checkpoint.label,targetChapter:checkpoint.targetChapter,targetPage:checkpoint.targetPage,previousTargetChapter:previousCheckpoint?.targetChapter,previousTargetPage:previousCheckpoint?.targetPage,isFinal:isFinalCheckpoint}:undefined,
      clubQuestions:aiQuestions,
      sharedPosts:aiPosts,
    }).then(result=>{if(!cancelled)setMeetingGuide(result)}).finally(()=>{if(!cancelled)setGuideLoading(false)});
    return()=>{cancelled=true};
  },[b.id,checkpoint?.id,isFinalCheckpoint,JSON.stringify(aiQuestions),JSON.stringify(aiPosts)]);

  async function reveal(id:string){setBusy(id);setNotice('');try{await revealPrediction(id);await refresh();setNotice('Prediction revealed.')}catch(e:any){setNotice(e?.message||'Could not reveal prediction.')}finally{setBusy(null)}}
  async function saveCheckin(status:'reached'|'catching_up'|'not_yet'){if(!checkpoint)return;setBusy(`checkin:${status}`);setNotice('');try{await setCheckpointCheckin(checkpoint.id,status);await refresh();setNotice('Check-in saved.')}catch(e:any){setNotice(e?.message||'Could not save check-in.')}finally{setBusy(null)}}

  const guide=meetingGuide||FALLBACK_GUIDE;
  const guidePrompts=guideMode==='themes'?guide.themes:guideMode==='characters'?guide.characters:guide.plotQuestions;
  const guideLabel=guideMode==='themes'?'Themes':guideMode==='characters'?'Characters':'Plot questions';
  const meetingWhen=w.meeting?formatMeetingDateTime(w.meeting.startsAt):'';
  const stepLabels=['','Check in','Your club saved','Guided discussion','From your discussion','Wrap up'];
  const last=5;

  return <div className={`page meeting-mode meeting-mode-page tone-${w.club.tone}`} style={{'--meeting-book-accent':bookAccent} as CSSProperties}>
    <header className="meeting-mode-top"><button className="back-link" onClick={()=>{sessionStorage.setItem(`bookclub:reading-tab:${cb.id}`,'calendar');sessionStorage.removeItem(`bookclub:reading-focus:${cb.id}`);navigate(`/clubs/${clubId}/books/${cb.id}`)}}><ArrowLeft/> Leave meeting room</button><span>{meetingWhen||w.club.name}</span></header>
    {notice&&<FeedbackMessage>{notice}</FeedbackMessage>}

    {step===0?<section className="meeting-opening meeting-room-opening"><div className="meeting-opening-copy"><p className="meeting-room-eyebrow">Meeting room</p><h1>{b.title}</h1><h2>{b.author}</h2><div className="meeting-opening-meta"><strong>{checkpointTitle(checkpoint)}</strong>{meetingWhen&&<span>{meetingWhen}</span>}</div><p className="meeting-opening-intro">Everything here comes from this club’s actual reading progress, saved discussion material, and spoiler-bounded guidance for {rangeLabel.toLowerCase()}.</p><div className="meeting-attendees">{w.members.map(m=><button key={m.id} onClick={()=>navigate(`/clubs/${clubId}/members/${m.id}`)}><span>{m.avatarUrl?<img src={m.avatarUrl} alt=""/>:m.displayName.slice(0,1)}</span>{m.displayName}</button>)}</div><button className="meeting-next meeting-room-start" onClick={()=>setStep(2)}>Start meeting <ArrowRight/></button></div><BookCover title={b.title} author={b.author} src={b.coverUrl}/></section>:<>
      <nav className="meeting-progress" aria-label="Meeting sections"><span>{String(Math.max(1,step-1)).padStart(2,'0')} / 04</span><div>{stepLabels.slice(2).map((label,i)=><i key={label} aria-label={label} className={step>=i+2?'active':''}/>)}</div></nav>

      {step===1&&<section className="meeting-chapter meeting-stage meeting-checkin-stage"><header><span>01</span><div><p>Check in</p><h2>{reachedCount}/{w.members.length} checked in as reached</h2><p>{checkpointCheckins.length?`${catchingUpCount} catching up · ${notYetCount} not there yet`:'No one has checked in for this checkpoint yet.'}</p></div></header>{checkpoint&&userId&&<div className="meeting-checkin-choices" aria-label="Your checkpoint check-in"><p>Your check-in{!persistedMyStatus&&suggestedMyStatus==='reached'?<small>Progress suggests Reached it</small>:null}</p><div>{([['reached','Reached it'],['catching_up','Catching up'],['not_yet','Not there yet']] as const).map(([status,label])=><button type="button" key={status} aria-pressed={(persistedMyStatus||suggestedMyStatus)===status} className={(persistedMyStatus||suggestedMyStatus)===status?'selected':''} disabled={busy?.startsWith('checkin:')} onClick={()=>void saveCheckin(status)}><span>{label}</span><b>{checkpointCheckins.filter(item=>item.status===status).length}</b></button>)}</div></div>}<div className="meeting-checkin-list">{w.members.map(member=>{const persisted=checkinByUser.get(member.id);const progressReached=memberReached(member,checkpoint,cb);const statusLabel=member.status==='dnf'||member.status==='sitting_out'?'Sitting out':persisted==='reached'?'Reached it':persisted==='catching_up'?'Catching up':persisted==='not_yet'?'Not there yet':progressReached?'Progress: reached':'Not checked in';return <article key={member.id} className={persisted==='reached'?'reached':''}><span className="meeting-checkin-avatar">{member.avatarUrl?<img src={member.avatarUrl} alt=""/>:member.displayName.slice(0,1)}</span><div><b>{member.displayName}</b><small>{memberProgressLabel(member)}</small></div><strong>{statusLabel}</strong></article>})}</div></section>}

      {step===2&&<section className="meeting-chapter meeting-stage meeting-saved-stage"><header><span>02</span><div><p>Your club saved</p><h2>Start with what people flagged while reading.</h2><p>Only club-visible material appears here. Private notes and private saved quotes stay private.</p></div></header><div className="meeting-saved-grid">{w.meetingQuestions.map(q=>{const sourceThought=q.postId?visibleThoughts.find(t=>t.id===q.postId):undefined;const kind=sourceThought?.type==='quote'?'Quote':sourceThought?.type==='question'?'Question':'Saved for meeting';return <article key={q.id} className="meeting-saved-item"><span>{kind}</span><blockquote>{q.body}</blockquote>{q.addedBy&&<small>— {q.addedBy.displayName}</small>}</article>})}{savedThoughts.map(item=><article key={item.id} className="meeting-saved-item"><span>{item.type==='quote'?'Quote':'Saved thought'}</span><blockquote>{item.body}</blockquote><small>— {item.author?.displayName||'Reader'}</small></article>)}{predictions.map(item=><article key={item.id} className={`meeting-saved-item meeting-saved-prediction ${item.predictionRevealed?'revealed':''}`}><span><LockKeyhole/> Prediction from {item.author?.displayName||'Reader'}</span>{item.predictionRevealed?<blockquote>{item.body}</blockquote>:<><p>Sealed until the room is ready.</p><button type="button" disabled={busy===item.id} onClick={()=>reveal(item.id)}>{busy===item.id?'Opening…':'Reveal'} <ArrowRight/></button></>}</article>)}{!w.meetingQuestions.length&&!savedThoughts.length&&!predictions.length&&<div className="meeting-empty"><p>Nobody saved anything for this meeting yet. Use the guided discussion next.</p></div>}</div></section>}

      {step===3&&<section className="meeting-chapter meeting-stage guided-discussion-stage"><header><span>03</span><div><p>Guided discussion · {rangeLabel}</p><h2>{guideLabel}</h2><p>{guideLoading?'Preparing spoiler-safe prompts…':guide.ai?'Generated from verified book context and this club’s visible discussion material.':'Spoiler-safe prompts based on the current checkpoint.'}</p></div></header>{guide.openingQuestion&&<aside className="meeting-opening-question"><Sparkles/><div><span>Start here</span><p>{guide.openingQuestion}</p></div></aside>}<div className="meeting-guide-tabs" role="tablist" aria-label="Discussion guide"><button type="button" className={guideMode==='themes'?'selected':''} onClick={()=>setGuideMode('themes')}><Sparkles/> Themes</button><button type="button" className={guideMode==='characters'?'selected':''} onClick={()=>setGuideMode('characters')}><Users/> Characters</button><button type="button" className={guideMode==='plot'?'selected':''} onClick={()=>setGuideMode('plot')}><MessageCircleQuestion/> Plot questions</button></div><div className="guided-prompt-list">{guidePrompts.map((prompt,index)=><article key={`${guideMode}-${prompt}`}><span>0{index+1}</span><p>{prompt}</p></article>)}</div></section>}

      {step===4&&<section className="meeting-chapter meeting-stage meeting-discussion-stage"><header><span>04</span><div><p>From your discussion</p><h2>What already has energy.</h2><p>Posts people reacted to most, plus questions that are still open.</p></div></header>{favorites.length?<><h3 className="meeting-subhead">Moments that landed</h3><div className="meeting-favorites">{favorites.map(x=><article key={x.id}><div><b>{x.author?.displayName||'Reader'}</b><span>{x.chapter?`Ch. ${x.chapter}`:''}</span></div><p>{x.body}</p><small><Heart/> {x.reactions?.length||0}</small></article>)}</div></>:<div className="meeting-empty"><p>No discussion post has reactions yet.</p></div>}{unresolved.length>0&&<div className="meeting-unresolved"><h3 className="meeting-subhead">Unresolved questions</h3>{unresolved.map(item=><article key={item.id}><MessageCircleQuestion/><div><p>{item.body}</p><small>{item.author?.displayName||'Reader'}{item.chapter?` · Chapter ${item.chapter}`:''}</small></div></article>)}</div>}</section>}

      {step===5&&<section className="meeting-closing meeting-stage meeting-wrap-stage"><Star/><p className="meeting-room-eyebrow">05 · Wrap up</p><h2>{isFinalCheckpoint?'You made it to the end.':'Keep the momentum going.'}</h2><p>{isFinalCheckpoint?'When the club is ready, move into the existing rating and archive flow.':nextCheckpoint?`Next checkpoint: ${checkpointTitle(nextCheckpoint)} · ${new Date(`${nextCheckpoint.dueAt}T12:00:00`).toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'})}.`:'Head back to the Reading Room for the next section.'}</p><div className="meeting-wrap-actions">{isFinalCheckpoint?<button className="primary" onClick={()=>navigate(`/clubs/${clubId}`)}>Rate & wrap up</button>:<button className="primary" onClick={()=>{sessionStorage.setItem(`bookclub:reading-tab:${cb.id}`,'calendar');sessionStorage.removeItem(`bookclub:reading-focus:${cb.id}`);navigate(`/clubs/${clubId}/books/${cb.id}`)}}>Back to reading room</button>}<button className="meeting-back-step" onClick={()=>navigate(`/clubs/${clubId}`)}>Back to club</button></div></section>}

      {step<last&&<div className="meeting-step-actions"><button className="meeting-back-step" onClick={()=>setStep(Math.max(2,step-1))}>Back</button><button className="meeting-next meeting-next-step" onClick={()=>setStep(Math.min(last,step+1))}>Next</button></div>}
    </>}
  </div>;
}

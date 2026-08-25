import { useMemo, useState } from 'react';
import { ArrowLeft, Heart, LockKeyhole, Star } from 'lucide-react';
import { BookCover } from '../components/BookCover';
import { revealPrediction } from '../lib/data';
import { useApp } from '../lib/AppContext';
import { useRouter } from '../lib/router';
import { FeedbackMessage, PageState } from '../components/PageState';

export function MeetingModePage({clubId,clubBookId}:{clubId:string;clubBookId:string}){
  const a=useApp(),{navigate}=useRouter(),w=a.workspace;const[busy,setBusy]=useState<string|null>(null),[notice,setNotice]=useState(''),[step,setStep]=useState(0);
  if(!w?.currentBook||w.currentBook.id!==clubBookId)return <div className="page"><PageState kind="error" title="Meeting mode isn’t available." action={<button className="primary" onClick={()=>navigate(`/clubs/${clubId}`)}>Back to club</button>}/></div>;
  const cb=w.currentBook,b=cb.book;
  const predictions=w.thoughts.filter(x=>x.type==='prediction');
  const favorites=useMemo(()=>[...w.thoughts].sort((x,y)=>(y.reactions?.length||0)-(x.reactions?.length||0)).slice(0,4),[w.thoughts]);
  async function reveal(id:string){setBusy(id);setNotice('');try{await revealPrediction(id);await a.refresh();setNotice('Prediction revealed.')}catch(e:any){setNotice(e?.message||'Could not reveal prediction.')}finally{setBusy(null)}}
  const steps=[
    {label:'Predictions',number:'01'},
    {label:'Saved for tonight',number:'02'},
    ...(favorites.length?[{label:'Moments that landed',number:'03'}]:[]),
    {label:'Wrap up',number:favorites.length?'04':'03'},
  ];
  const last=steps.length-1;
  return <div className={`page meeting-mode meeting-mode-page tone-${w.club.tone}`}>
    <header className="meeting-mode-top"><button className="back-link" onClick={()=>navigate(`/clubs/${clubId}`)}><ArrowLeft/> Leave meeting mode</button><span>Tonight · {w.club.name}</span></header>
    {notice&&<FeedbackMessage>{notice}</FeedbackMessage>}
    {step===0?<section className="meeting-opening"><div><p>{w.members.filter(m=>m.status==='finished').length}/{w.members.length} finished</p><h1>{b.title}</h1><h2>{b.author}</h2><div className="meeting-attendees">{w.members.map(m=><button key={m.id} onClick={()=>navigate(`/clubs/${clubId}/members/${m.id}`)}><span>{m.avatarUrl?<img src={m.avatarUrl} alt=""/>:m.displayName.slice(0,1)}</span>{m.displayName}</button>)}</div><button className="meeting-next" onClick={()=>setStep(1)}>Begin</button></div><BookCover title={b.title} author={b.author} src={b.coverUrl}/></section>:<>
      <nav className="meeting-progress" aria-label="Meeting sections"><span>{String(step).padStart(2,'0')} / {String(last).padStart(2,'0')}</span><div>{steps.slice(0,last).map((item,i)=><i key={item.label} className={step>=i+1?'active':''}/>)}</div></nav>
      {step===1&&<section className="meeting-chapter meeting-stage"><header><span>01</span><div><h2>Predictions</h2></div></header>{predictions.length?<div className="prediction-reveal-grid">{predictions.map(p=><article key={p.id} className={p.predictionRevealed?'revealed':''}><div><LockKeyhole/><span>{p.author?.displayName||'Reader'} · Chapter {p.chapter||'—'}</span></div>{p.predictionRevealed?<p>{p.body}</p>:<><p className="sealed-copy">Prediction sealed</p><button disabled={busy===p.id} onClick={()=>reveal(p.id)}>{busy===p.id?'Opening…':'Reveal'}</button></>}</article>)}</div>:<div className="meeting-empty"><p>No predictions were sealed this time.</p></div>}</section>}
      {step===2&&<section className="meeting-chapter meeting-stage"><header><span>02</span><div><h2>Saved for tonight</h2></div></header>{w.meetingQuestions.length?<ol className="meeting-mode-agenda">{w.meetingQuestions.map(q=><li key={q.id}><div><b>{q.body}</b>{q.addedBy&&<small>{q.addedBy.displayName}</small>}</div></li>)}</ol>:<div className="meeting-empty"><p>Nothing was added to the agenda. Start with the moment everyone remembers.</p></div>}</section>}
      {favorites.length>0&&step===3&&<section className="meeting-chapter meeting-stage"><header><span>03</span><div><h2>Moments that landed</h2><p>The discussion posts your group reacted to most.</p></div></header><div className="meeting-favorites">{favorites.map(x=><article key={x.id}><div><b>{x.author?.displayName||'Reader'}</b><span>{x.chapter?`Ch. ${x.chapter}`:''}</span></div><p>{x.type==='prediction'&&!x.predictionRevealed?'A sealed prediction':x.body}</p><small><Heart/> {x.reactions?.length||0}</small></article>)}</div></section>}
      {step===last&&<section className="meeting-closing meeting-stage"><Star/><h2>Last question: how was the book?</h2><p>Rate it individually, then put it on the club shelf when everyone is ready.</p><button className="primary" onClick={()=>navigate(`/clubs/${clubId}`)}>Rate & wrap up</button></section>}
      {step<last&&<div className="meeting-step-actions"><button className="meeting-back-step" onClick={()=>setStep(Math.max(0,step-1))}>Back</button><button className="meeting-next" onClick={()=>setStep(Math.min(last,step+1))}><span>Next</span><b>{steps[step]?.label}</b></button></div>}
    </>}
  </div>;
}

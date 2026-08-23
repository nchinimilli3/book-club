import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Star } from 'lucide-react';
import { useApp } from '../lib/AppContext';
import { useRouter } from '../lib/router';
import { getClubArchive } from '../lib/data';

type ArchiveRating={rating:number;review?:string;recommend?:boolean;submittedAt?:string;displayName:string};
type ArchiveItem={id:string;status:string;createdAt?:string;book:{id:string;title:string;author:string;coverUrl?:string;pages?:number};ratings:ArchiveRating[]};

export function ArchivePage({clubId}:{clubId:string}){
  const a=useApp(),{navigate}=useRouter();
  const[items,setItems]=useState<ArchiveItem[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{let live=true;setLoading(true);getClubArchive(clubId).then(x=>{if(live){setItems(x);setError('')}}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[clubId]);
  const stats=useMemo(()=>{
    const ratings=items.flatMap(x=>x.ratings||[]).map(x=>x.rating).filter(Boolean);
    const pages=items.reduce((sum,x)=>sum+(x.book.pages||0),0);
    return{count:items.length,pages,avg:ratings.length?(ratings.reduce((a,b)=>a+b,0)/ratings.length).toFixed(1):'—'};
  },[items]);
  const club=a.clubs.find(c=>c.id===clubId);
  const year=new Date().getFullYear();
  const yearItems=items.filter(x=>!x.createdAt||new Date(x.createdAt).getFullYear()===year);
  const yearReviews=yearItems.flatMap(x=>x.ratings||[]).filter(r=>r.review);
  const yearTop=[...yearItems].sort((a,b)=>{const aa=a.ratings.length?a.ratings.reduce((s,r)=>s+r.rating,0)/a.ratings.length:0;const bb=b.ratings.length?b.ratings.reduce((s,r)=>s+r.rating,0)/b.ratings.length:0;return bb-aa})[0];
  return <div className={`page archive-page tone-${club?.tone||'rose'}`}>
    <button type="button" className="back-link" onClick={()=>navigate(`/clubs/${clubId}`)}><ArrowLeft/> {club?.name||'Club'}</button>
    <section className="archive-hero"><div><span>Club archive</span><h1>The books you finished together.</h1></div><div className="archive-stats"><article><b>{stats.count}</b><span>books</span></article><article><b>{stats.pages.toLocaleString()}</b><span>pages tracked</span></article><article><b>{stats.avg}</b><span>avg rating</span></article></div></section>
    {!loading&&!error&&items.length>0&&<section className="annual-volume"><div className="annual-volume-title"><span>Volume {year}</span><h2>Your year together.</h2></div><div className="annual-volume-facts"><article><b>{yearItems.length}</b><span>finished this year</span></article><article><b>{yearTop?.book.title||'—'}</b><span>highest-rated read</span></article><article><b>{yearReviews.length}</b><span>one-line takes saved</span></article></div></section>}
    {loading?<div className="archive-loading">Opening the shelf…</div>:error?<div className="error-text">{error}</div>:items.length?<section className="archive-grid">{items.map((x,index)=>{
      const rs=x.ratings||[];const avg=rs.length?rs.reduce((s,r)=>s+r.rating,0)/rs.length:0;
      return <article key={x.id} className="archive-book"><div className="archive-book-number">{String(index+1).padStart(2,'0')}</div><div className="archive-book-cover">{x.book.coverUrl?<img loading="lazy" src={x.book.coverUrl} alt={`Cover of ${x.book.title}`}/>:<BookOpen/>}</div><div className="archive-book-copy"><h2>{x.book.title}</h2><p>{x.book.author}</p>{avg>0&&<div className="archive-rating"><Star fill="currentColor"/> {avg.toFixed(1)}</div>}{rs.filter(r=>r.review).slice(0,3).map((r,i)=><blockquote key={i}>“{r.review}” <span>— {r.displayName}</span></blockquote>)}</div></article>
    })}</section>:<div className="empty-state"><h2>Your first issue starts after you finish a book.</h2><p>Ratings and one-line takes will collect here automatically.</p></div>}
  </div>
}

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Heart } from 'lucide-react';
import { BookCover } from '../components/BookCover';
import { getSharedMemberProfile } from '../lib/data';
import { useApp } from '../lib/AppContext';
import { useRouter } from '../lib/router';

export function MemberProfilePage({clubId,memberId}:{clubId:string;memberId:string}){
  const a=useApp(),{navigate}=useRouter();
  const[data,setData]=useState<any>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{let cancelled=false;setLoading(true);getSharedMemberProfile(clubId,memberId).then(x=>{if(!cancelled)setData(x)}).catch(e=>{if(!cancelled)setError(e?.message||'Could not load this profile.')}).finally(()=>{if(!cancelled)setLoading(false)});return()=>{cancelled=true}},[clubId,memberId]);
  const books:any[]=data?.books||[];
  const sections=useMemo(()=>[
    ['Currently reading',books.filter(x=>x.shelf==='currently_reading')],
    ['Favorites',books.filter(x=>x.isFavorite)],
    ['Books read',books.filter(x=>x.shelf==='read')],
    ['Want to read',books.filter(x=>x.shelf==='want_to_read')],
  ] as const,[books]);
  const shared=useMemo(()=>{const titles=new Set(a.workspace?.archiveBooks.map(x=>`${x.title.toLowerCase()}|${x.author.toLowerCase()}`)||[]);return books.filter(x=>titles.has(`${String(x.book?.title||'').toLowerCase()}|${String(x.book?.author||'').toLowerCase()}`))},[books,a.workspace?.archiveBooks]);
  function openBook(item:any){sessionStorage.setItem('bookclub:search-return',JSON.stringify({path:`/clubs/${clubId}/members/${memberId}`,label:'Member profile',scrollY:window.scrollY}));sessionStorage.setItem('bookclub:open-book',JSON.stringify({key:`db:${item.book.id}`,source:'openlibrary',title:item.book.title,author:item.book.author,cover:item.book.coverUrl||'',year:item.book.year,isbn:item.book.isbn,pages:item.book.pages}));navigate('/search')}
  if(loading)return <div className="page member-profile-page"><div className="profile-loading"><i/><i/><i/></div></div>;
  if(error||!data?.profile)return <div className="page member-profile-unavailable"><button className="back-link" onClick={()=>navigate(`/clubs/${clubId}`)}><ArrowLeft/> {a.workspace?.club.name||'Club'}</button><section className="profile-missing-card"><div className="profile-missing-art" aria-hidden="true"><span>?</span><i/><i/><i/></div><div><p>Reader unavailable</p><h1>This profile isn’t on the shelf.</h1><span>They may have left the club, changed their sharing settings, or this link may be old.</span><button className="primary" onClick={()=>navigate(`/clubs/${clubId}`)}>Back to {a.workspace?.club.name||'club'}</button></div></section></div>;
  const p=data.profile;
  return <div className="page member-profile-page">
    <button className="back-link" onClick={()=>navigate(`/clubs/${clubId}`)}><ArrowLeft/> {a.workspace?.club.name||'Club'}</button>
    <section className="member-profile-hero">
      <div className="member-profile-avatar">{p.avatarUrl?<img src={p.avatarUrl} alt=""/>:<span>{p.displayName?.slice(0,1)||'R'}</span>}</div>
      <div><p>{p.username?`@${p.username}`:'Club member'}</p><h1>{p.displayName||'Reader'}</h1><span>{books.length} shared {books.length===1?'book':'books'}</span></div>
    </section>
    {shared.length>0&&<section className="shared-books-callout"><div><BookOpen/><span>You’ve both read</span></div><div>{shared.slice(0,5).map(x=><button key={x.id} onClick={()=>openBook(x)}><BookCover title={x.book.title} author={x.book.author} src={x.book.coverUrl}/><span>{x.book.title}</span></button>)}</div></section>}
    {sections.map(([title,items])=>items.length>0&&<section className="member-shelf" key={title}><header><h2>{title}</h2><span>{items.length}</span></header><div>{items.map((x:any)=><button key={x.id} onClick={()=>openBook(x)}><BookCover title={x.book.title} author={x.book.author} src={x.book.coverUrl}/><span><b>{x.book.title}</b><small>{x.book.author}</small>{x.isFavorite&&<em><Heart fill="currentColor"/> Favorite</em>}</span></button>)}</div></section>)}
  </div>;
}

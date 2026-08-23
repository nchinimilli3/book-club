import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Heart, Plus, Search, X } from 'lucide-react';
import { buildLocalDecisionGuide, getBookDecisionDetails, searchBooks, type BookDecisionDetails, type BookSearchResult } from '../lib/books';
import { getDecisionGuide, type DecisionGuide } from '../lib/api';
import { saveBookToClub, savePersonalBook } from '../lib/data';
import { useApp } from '../lib/AppContext';
import { useRouter } from '../lib/router';

const SEARCH_KEY='bookclub:last-search';
const OPEN_BOOK_KEY='bookclub:open-book';
const PROFILE_TARGET_KEY='bookclub:profile-save-target';

export function SearchPage(){
  const a=useApp(),{navigate:nav}=useRouter();
  const[q,setQ]=useState(()=>sessionStorage.getItem(SEARCH_KEY)||'');
  const[results,setResults]=useState<BookSearchResult[]>([]);
  const[loading,setLoading]=useState(false);
  const[detail,setDetail]=useState<BookSearchResult|null>(null);
  const[details,setDetails]=useState<BookDecisionDetails|null>(null);
  const[guide,setGuide]=useState<DecisionGuide|null>(null);
  const[guideLoading,setGuideLoading]=useState(false);
  const[saved,setSaved]=useState<Set<string>>(new Set());
  const[busyKey,setBusyKey]=useState<string|null>(null);
  const[busy,setBusy]=useState<'club'|'personal'|null>(null);
  const[notice,setNotice]=useState('');
  const[personalShelf,setPersonalShelf]=useState('want_to_read');
  const[favorite,setFavorite]=useState(false);
  const[profileReturn,setProfileReturn]=useState(false);

  useEffect(()=>{
    sessionStorage.setItem(SEARCH_KEY,q);
    const t=setTimeout(async()=>{
      if(q.trim().length<2){setResults([]);return}
      setLoading(true);
      try{setResults(await searchBooks(q))}finally{setLoading(false)}
    },250);
    return()=>clearTimeout(t)
  },[q]);

  useEffect(()=>{
    const raw=sessionStorage.getItem(OPEN_BOOK_KEY);
    if(raw){
      try{const parsed=JSON.parse(raw) as BookSearchResult;setDetail(parsed)}catch{}
    }
    const target=sessionStorage.getItem(PROFILE_TARGET_KEY);
    if(target){
      sessionStorage.removeItem(PROFILE_TARGET_KEY);
      setProfileReturn(true);
      try{const parsed=JSON.parse(target);if(parsed.shelf)setPersonalShelf(parsed.shelf);if(parsed.favorite)setFavorite(true)}catch{}
    }
  },[]);

  useEffect(()=>{
    if(!detail){setDetails(null);setGuide(null);setNotice('');return}
    let cancelled=false;
    setGuideLoading(true);
    setNotice('');
    (async()=>{
      const full=await getBookDecisionDetails(detail);
      if(cancelled)return;
      setDetails(full);
      const ai=await getDecisionGuide(full);
      if(!cancelled)setGuide(ai);
      if(!cancelled)setGuideLoading(false);
    })();
    return()=>{cancelled=true}
  },[detail?.key]);

  const local=useMemo(()=>details?buildLocalDecisionGuide(details):null,[details]);

  async function quickAdd(book:BookSearchResult){
    if(!a.activeClubId){setNotice('Open or create a club first.');return}
    setBusyKey(book.key);setNotice('');
    try{
      const result=await saveBookToClub(a.activeClubId,book);
      setSaved(s=>new Set(s).add(book.key));
      setNotice(result.alreadySaved?`${book.title} is already in ${a.workspace?.club.name||'this club'}.`:`${book.title} added to ${a.workspace?.club.name||'your club'} ideas.`);
      // Keep the search exactly where it is. Realtime will update the club; this refresh is
      // intentionally background-only and never navigates or clears the query/results.
      void a.refresh();
    }catch(err:any){setNotice(err?.message||'Could not add this book.')}
    finally{setBusyKey(null)}
  }

  async function addToClub(){
    if(!detail||!a.activeClubId)return;
    setBusy('club');setNotice('');
    try{
      const result=await saveBookToClub(a.activeClubId,{...detail,description:details?.description});
      setSaved(s=>new Set(s).add(detail.key));
      setNotice(result.alreadySaved?`Already in ${a.workspace?.club.name||'this club'}.`:`Added to ${a.workspace?.club.name||'your active club'} ideas. It only becomes the club pick after a vote.`);
      void a.refresh();
    }catch(err:any){setNotice(err?.message||'Could not add this book.')}
    finally{setBusy(null)}
  }

  async function saveForMe(){
    if(!detail||!a.user)return;
    setBusy('personal');setNotice('');
    try{
      await savePersonalBook(a.user.id,{...detail,description:details?.description},{shelf:personalShelf,isFavorite:favorite});
      const shelfName=personalShelf==='want_to_read'?'Want to read':personalShelf==='currently_reading'?'Currently reading':'Books read';
      setNotice(`Saved to ${shelfName}${favorite?' + Favorites':''}.`);
      if(profileReturn){sessionStorage.removeItem(OPEN_BOOK_KEY);nav('/me')}
    }catch(err:any){setNotice(err?.message||'Could not save this book.')}
    finally{setBusy(null)}
  }

  if(detail){
    return <div className="page book-preview">
      <button type="button" className="back-link" onClick={()=>{sessionStorage.removeItem(OPEN_BOOK_KEY);setDetail(null)}}><ArrowLeft/> Back to results</button>
      <section className="book-choice-layout">
        <aside className="preview-cover-column">
          <div className="preview-cover">{detail.cover&&<img src={detail.cover} alt={`Cover of ${detail.title}`}/>}</div>
          <div className="preview-metadata">
            <span>{detail.year||'Year varies'}</span>
            <span>{details?.pages?`${details.pages} pages`:'Page count varies'}</span>
            {detail.editionCount&&<span>{detail.editionCount} editions cataloged</span>}
          </div>
        </aside>
        <div className="preview-copy">
          <div className="preview-heading"><h1>{detail.title}</h1><p className="author">{detail.author}</p></div>
          <div className="decision-guide">
            <header><h2>Would this work for your club?</h2>{guide?.sourceBacked&&<span>Source-backed</span>}</header>
            {guideLoading&&!local?<p className="decision-loading">Pulling together the useful parts…</p>:<>
              {guide?.whatItsAbout&&<article className="decision-about"><h3>What it’s about</h3><p>{guide.whatItsAbout}</p></article>}
              {local&&<div className="decision-grid">
                <article><h3>Commitment</h3><p>{local.commitment}</p></article>
                <article><h3>Discussion potential</h3><p>{guide?.whyItWorks||local.fit}</p></article>
                <article><h3>What you’ll probably talk about</h3><p>{guide?.conversation?.join(' · ')||local.discussion}</p></article>
                <article><h3>Reading shape</h3><p>{guide?.headsUp||`This reads as a ${local.shape}. ${detail.year?`It was first published around ${detail.year}.`:''}`}</p></article>
              </div>}
              <div className="decision-topics">{(guide?.vibe||local?.topics||[]).slice(0,5).map(x=><span key={x}>{x}</span>)}</div>
            </>}
          </div>
          <div className="book-save-actions">
            <button type="button" className="primary" onClick={addToClub} disabled={!a.activeClubId||busy!==null}>{busy==='club'?'Adding…':`Add to ${a.workspace?.club.name||'active club'} ideas`}</button>
            <div className="personal-save-panel" aria-label="Save to your profile">
              <span className="personal-save-label">Save for me</span>
              <div className="personal-shelf-options" role="group" aria-label="Choose shelf">
                <button type="button" className={personalShelf==='want_to_read'?'selected':''} onClick={()=>setPersonalShelf('want_to_read')}>Want to read</button>
                <button type="button" className={personalShelf==='currently_reading'?'selected':''} onClick={()=>setPersonalShelf('currently_reading')}>Reading</button>
                <button type="button" className={personalShelf==='read'?'selected':''} onClick={()=>setPersonalShelf('read')}>Read</button>
              </div>
              <button type="button" className={`favorite-toggle ${favorite?'selected':''}`} onClick={()=>setFavorite(v=>!v)} aria-pressed={favorite}><Heart fill={favorite?'currentColor':'none'}/> Favorite</button>
              <button type="button" className="secondary save-personal-button" onClick={saveForMe} disabled={!a.user||busy!==null}>{busy==='personal'?'Saving…':'Save'}</button>
            </div>
          </div>
          {notice&&<div className="save-notice" role="status">{notice}</div>}
        </div>
      </section>
    </div>
  }

  return <div className="page search-page">
    <header className="page-title"><div><h1>Find a book</h1></div></header>
    <div className="search-field"><Search/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search books" autoFocus/>{q&&<button type="button" onClick={()=>setQ('')} aria-label="Clear search"><X/></button>}</div>
    {notice&&<div className="save-notice search-notice" role="status">{notice}</div>}
    {loading&&<div className="search-status">Searching…</div>}
    <div className="book-wall">{results.map(b=><article className="search-book-card" key={b.key}>
      <button type="button" className="search-book-open" onClick={()=>{sessionStorage.setItem(OPEN_BOOK_KEY,JSON.stringify(b));setDetail(b)}} aria-label={`Open ${b.title}`}>
        <div className="book-image">{b.cover&&<img src={b.cover} alt=""/>}</div><b>{b.title}</b><small>{b.author}</small>
      </button>
      <button type="button" className={`search-quick-add ${saved.has(b.key)?'saved':''}`} disabled={busyKey===b.key||!a.activeClubId} onClick={()=>quickAdd(b)} aria-label={`Add ${b.title} to active club ideas`} title="Quick add to your active club’s potential reads">
        {busyKey===b.key?'…':saved.has(b.key)?<><Check/> Added</>:<><Plus/> Add idea</>}
      </button>
    </article>)}</div>
  </div>
}

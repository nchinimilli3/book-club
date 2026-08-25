import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Heart, Plus, Search, X } from 'lucide-react';
import { BookCover } from '../components/BookCover';
import { BookSkeleton } from '../components/Skeleton';
import { BookRail } from '../components/BookRail';
import { BookAddMenu, type BookAddTarget } from '../components/BookAddMenu';
import { FeedbackMessage, PageState } from '../components/PageState';
import { SelectMenu } from '../components/SelectMenu';
import { buildLocalDecisionGuide, getBookDecisionDetails, searchBooks, type BookDecisionDetails, type BookSearchResult } from '../lib/books';
import { getBookDiscovery, getDecisionGuide, type DecisionGuide, type DiscoveryBook } from '../lib/api';
import { catalogToSearchResult, discoveryToCatalog, type CatalogBook } from '../lib/catalog';
import { saveBookToClub, savePersonalBook } from '../lib/data';
import { useApp } from '../lib/AppContext';
import { useRouter } from '../lib/router';

const SEARCH_KEY='bookclub:last-search';
const OPEN_BOOK_KEY='bookclub:open-book';
const PROFILE_TARGET_KEY='bookclub:profile-save-target';
const SEARCH_RETURN_KEY='bookclub:search-return';
const SCROLL_KEY='bookclub:search-scroll';
type ReturnTarget={path:string;label?:string;scrollY?:number};

const shelfLabel=(shelf:string)=>shelf==='want_to_read'?'Want to read':shelf==='currently_reading'?'Currently reading':'Books read';
function topicTone(topic:string){let n=0;for(const c of topic)n=(n+c.charCodeAt(0))%5;return `topic-tone-${n+1}`}
function usefulGuideText(value?:string){const text=(value||'').trim();if(!text)return undefined;return /this reads as a book|catalog metadata|catalog .*subject data|predict discussion themes|thematic range|enough .*support a conversation/i.test(text)?undefined:text}
function cleanSubject(value:string){return value.replace(/--.*$/,'').replace(/ fiction$/i,'').trim()}

export function SearchPage(){
  const a=useApp(),{navigate:nav}=useRouter();
  const[q,setQ]=useState(()=>sessionStorage.getItem(SEARCH_KEY)||'');
  const[results,setResults]=useState<BookSearchResult[]>([]),[loading,setLoading]=useState(false);
  const[detail,setDetail]=useState<BookSearchResult|null>(null),[details,setDetails]=useState<BookDecisionDetails|null>(null),[guide,setGuide]=useState<DecisionGuide|null>(null),[guideLoading,setGuideLoading]=useState(false);
  const[busy,setBusy]=useState<'club'|'personal'|'quick'|null>(null),[notice,setNotice]=useState('');
  const[personalShelf,setPersonalShelf]=useState('want_to_read'),[favorite,setFavorite]=useState(false),[profileReturn,setProfileReturn]=useState(false);
  const[quickAdd,setQuickAdd]=useState<BookSearchResult|null>(null);
  const[discovery,setDiscovery]=useState<{nyt:DiscoveryBook[];apple:DiscoveryBook[];nytConfigured:boolean}>({nyt:[],apple:[],nytConfigured:false}),[discoveryLoading,setDiscoveryLoading]=useState(true);
  const[returnTarget,setReturnTarget]=useState<ReturnTarget|null>(null);
  const pushedRef=useRef(false);

  useEffect(()=>{
    let cancelled=false;
    if(q.trim()){setDiscoveryLoading(false);return()=>{cancelled=true}}
    setDiscoveryLoading(true);getBookDiscovery().then(x=>{if(!cancelled)setDiscovery(x)}).finally(()=>{if(!cancelled)setDiscoveryLoading(false)});
    return()=>{cancelled=true};
  },[q.trim().length===0]);

  useEffect(()=>{
    sessionStorage.setItem(SEARCH_KEY,q);
    const t=setTimeout(async()=>{if(q.trim().length<2){setResults([]);return}setLoading(true);try{setResults(await searchBooks(q))}finally{setLoading(false)}},250);
    return()=>clearTimeout(t)
  },[q]);

  useEffect(()=>{
    const rawReturn=sessionStorage.getItem(SEARCH_RETURN_KEY);if(rawReturn){try{setReturnTarget(JSON.parse(rawReturn))}catch{}}
    const raw=sessionStorage.getItem(OPEN_BOOK_KEY);if(raw){try{setDetail(JSON.parse(raw))}catch{}}
    const target=sessionStorage.getItem(PROFILE_TARGET_KEY);if(target){setProfileReturn(true);try{const parsed=JSON.parse(target);if(parsed.shelf)setPersonalShelf(parsed.shelf);if(parsed.favorite)setFavorite(true)}catch{}}
    const onPop=()=>{if(pushedRef.current){pushedRef.current=false;sessionStorage.removeItem(OPEN_BOOK_KEY);setDetail(null);requestAnimationFrame(()=>scrollTo(0,Number(sessionStorage.getItem(SCROLL_KEY)||0)))}};
    addEventListener('popstate',onPop);return()=>removeEventListener('popstate',onPop);
  },[]);

  useEffect(()=>{
    if(!detail){setDetails(null);setGuide(null);setNotice('');return}
    let cancelled=false;setGuideLoading(true);setNotice('');
    (async()=>{try{const full=await getBookDecisionDetails(detail);if(cancelled)return;setDetails(full);const ai=await getDecisionGuide(full);if(!cancelled)setGuide(ai)}finally{if(!cancelled)setGuideLoading(false)}})();
    return()=>{cancelled=true}
  },[detail?.key]);

  const local=useMemo(()=>details?buildLocalDecisionGuide(details):null,[details]);
  function openDetail(book:BookSearchResult){setQuickAdd(null);sessionStorage.setItem(SCROLL_KEY,String(scrollY));sessionStorage.setItem(OPEN_BOOK_KEY,JSON.stringify(book));history.pushState({bookPreview:true},'',location.href);pushedRef.current=true;setDetail(book)}
  function exitSearch(){const target=returnTarget;sessionStorage.removeItem(OPEN_BOOK_KEY);sessionStorage.removeItem(PROFILE_TARGET_KEY);sessionStorage.removeItem(SEARCH_RETURN_KEY);nav(target?.path||(a.activeClubId?`/clubs/${a.activeClubId}`:'/clubs'),true);if(typeof target?.scrollY==='number')requestAnimationFrame(()=>requestAnimationFrame(()=>scrollTo({top:target.scrollY,behavior:'instant' as ScrollBehavior})))}
  function closeDetail(){sessionStorage.removeItem(OPEN_BOOK_KEY);if(pushedRef.current)history.back();else if(returnTarget?.path)exitSearch();else{setDetail(null);requestAnimationFrame(()=>scrollTo(0,Number(sessionStorage.getItem(SCROLL_KEY)||0)))}}

  async function suggestToClub(){if(!detail||!a.activeClubId)return;setBusy('club');setNotice('');try{const result=await saveBookToClub(a.activeClubId,{...detail,description:details?.description});setNotice(result.alreadySaved?`Already on ${a.workspace?.club.name||'this club'}’s table.`:`Suggested to ${a.workspace?.club.name||'your club'}.`);void a.refresh()}catch(err:any){setNotice(err?.message||'Could not suggest this book.')}finally{setBusy(null)}}
  async function saveForMe(){if(!detail||!a.user)return;setBusy('personal');setNotice('');try{await savePersonalBook(a.user.id,{...detail,description:details?.description},{shelf:personalShelf,isFavorite:favorite});setNotice(`Saved to ${shelfLabel(personalShelf)}${favorite?' and Favorites':''}.`);if(profileReturn)exitSearch()}catch(err:any){setNotice(err?.message||'Could not save this book.')}finally{setBusy(null)}}
  async function quickSave(book:BookSearchResult,target:'club'|'want_to_read'|'currently_reading'|'read'){
    setBusy('quick');setNotice('');
    try{
      if(target==='club'){
        if(!a.activeClubId)throw new Error('Choose a club first.');
        const result=await saveBookToClub(a.activeClubId,book);setNotice(result.alreadySaved?`${book.title} is already on the table.`:`${book.title} added to ${a.workspace?.club.name||'the club'}’s table.`);void a.refresh();
      }else{
        if(!a.user)throw new Error('Sign in to save books.');
        await savePersonalBook(a.user.id,book,{shelf:target});setNotice(`${book.title} saved to ${shelfLabel(target)}.`);
      }
      setQuickAdd(null);
    }catch(err:any){setNotice(err?.message||'Could not add this book.')}finally{setBusy(null)}
  }

  const nytBooks=useMemo(()=>discovery.nyt.map(b=>discoveryToCatalog(b,'nyt')),[discovery.nyt]);
  const appleBooks=useMemo(()=>discovery.apple.map(b=>discoveryToCatalog(b,'apple')),[discovery.apple]);
  function openCatalogBook(book:CatalogBook){openDetail(catalogToSearchResult(book))}
  function addCatalogBook(book:CatalogBook){setQuickAdd(catalogToSearchResult(book))}
  function chooseQuickTarget(book:BookSearchResult,target:BookAddTarget){void quickSave(book,target)}


  if(detail)return <div className="page book-preview">
    <div className="book-preview-nav"><button type="button" className="back-link" onClick={closeDetail}><ArrowLeft/> {pushedRef.current?'Back to search':returnTarget?.label||'Back'}</button>{returnTarget&&<button type="button" className="preview-exit" onClick={exitSearch} aria-label={`Close and return to ${returnTarget.label||'previous page'}`}><X/></button>}</div>
    <section className="book-choice-layout">
      <aside className="preview-cover-column"><BookCover className="preview-cover" title={detail.title} author={detail.author} src={detail.cover}/><div className="preview-metadata book-facts"><div><small>Published</small><b>{detail.year||'Varies'}</b></div>{details?.pages&&<div><small>Length</small><b>{details.pages} pages</b></div>}{details?.subjects?.slice(0,2).map(subject=><div key={subject}><small>Genre</small><b>{cleanSubject(subject)}</b></div>)}</div></aside>
      <div className="preview-copy">
        <div className="preview-heading"><h1>{detail.title}</h1><p className="author">{detail.author}</p></div>
        <section className="decision-guide"><header><h2>Would this work for your club?</h2></header>{guideLoading&&!local?<div className="decision-loading">Checking this book…</div>:<>{usefulGuideText(guide?.whatItsAbout)&&<article className="decision-about"><h3>What it’s about</h3><p>{usefulGuideText(guide?.whatItsAbout)}</p></article>}{local&&<div className="decision-grid"><article className="decision-time"><h3>Time commitment</h3><p>{local.commitment}</p></article><article className="decision-fit"><h3>Why it could work</h3><p>{usefulGuideText(guide?.whyItWorks)||local.fit}</p></article>{(guide?.conversation?.length||local.topics.length>0)&&<article className="decision-talk"><h3>Likely discussion</h3><p>{usefulGuideText(guide?.conversation?.join(' · '))||local.discussion}</p></article>}{usefulGuideText(guide?.headsUp)&&<article className="decision-headsup"><h3>Worth knowing</h3><p>{usefulGuideText(guide?.headsUp)}</p></article>}</div>}<div className="decision-topics">{(guide?.vibe||local?.topics||[]).slice(0,5).map(x=><span className={topicTone(x)} key={x}>{x}</span>)}</div></>}</section>
        <div className="relationship-actions preview-save-actions">
          <section className="preview-personal-save"><label className="preview-shelf-field"><span>Save to</span><SelectMenu className="preview-shelf-menu" ariaLabel="Personal shelf" value={personalShelf} options={[{value:'want_to_read',label:'Want to read'},{value:'currently_reading',label:'Currently reading'},{value:'read',label:'Books read'}]} onChange={setPersonalShelf}/></label><div className="preview-save-row"><button type="button" className={`favorite-toggle ${favorite?'selected':''}`} onClick={()=>setFavorite(v=>!v)} aria-pressed={favorite}><Heart fill={favorite?'currentColor':'none'}/> {favorite?'Favorite':'Mark favorite'}</button><button type="button" className="primary preview-personal-save-button" onClick={saveForMe} disabled={!a.user||busy!==null}>{busy==='personal'?'Saving…':`Save to ${shelfLabel(personalShelf)}`}</button></div></section>
          <section className="preview-club-save"><button type="button" className="primary" onClick={suggestToClub} disabled={!a.activeClubId||busy!==null}>{busy==='club'?'Adding…':`Add to ${a.workspace?.club.name||'club'} shortlist`}</button></section>
        </div>
        {notice&&<FeedbackMessage>{notice}</FeedbackMessage>}
      </div>
    </section>
  </div>;

  return <div className="page search-page"><header className="page-title search-title"><h1>Find a book</h1>{returnTarget&&<button type="button" className="search-exit" onClick={exitSearch} aria-label={`Close search and return to ${returnTarget.label||'previous page'}`}><X/></button>}</header><div className="search-field"><Search/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Title, author, ISBN" autoFocus/>{q&&<button type="button" onClick={()=>setQ('')} aria-label="Clear search"><X/></button>}</div>{notice&&<FeedbackMessage className="search-notice">{notice}</FeedbackMessage>}
    {!q.trim()?<div className="search-discovery">
      <BookRail title="NYT Best Sellers" books={nytBooks} loading={discoveryLoading} meta={b=>b.rank?`#${b.rank} · ${b.listName||'Best Sellers'}`:(b.listName||'Best Sellers')} onOpen={openCatalogBook} onAdd={addCatalogBook} renderOverlay={book=>quickAdd?.key===book.key?<BookAddMenu title={book.title} clubName={a.workspace?.club.name} showClub={!!a.activeClubId} busy={busy==='quick'} onClose={()=>setQuickAdd(null)} onChoose={target=>chooseQuickTarget(catalogToSearchResult(book),target)}/>:null} emptyMessage={discovery.nytConfigured?'Best Sellers are unavailable right now.':'Best Sellers will appear once NYT is connected.'}/>
      <BookRail title="Explore Apple Books" books={appleBooks} loading={discoveryLoading} onOpen={openCatalogBook} onAdd={addCatalogBook} renderOverlay={book=>quickAdd?.key===book.key?<BookAddMenu title={book.title} clubName={a.workspace?.club.name} showClub={!!a.activeClubId} busy={busy==='quick'} onClose={()=>setQuickAdd(null)} onChoose={target=>chooseQuickTarget(catalogToSearchResult(book),target)}/>:null} emptyMessage="Apple Books discovery is unavailable right now."/>
      {!discovery.nytConfigured&&<p className="discovery-config-note">NYT Best Sellers is ready for a Worker API key.</p>}
    </div>:loading?<BookSkeleton count={8}/>:q.trim().length>=2&&!results.length?<PageState title="No match yet." body="Try the title and author." compact/>:<div className="book-wall">{results.map(b=><article className="search-book-card" key={b.key}><button type="button" className="search-book-open" onClick={()=>openDetail(b)} aria-label={`Open ${b.title}`}><BookCover className="book-image" title={b.title} author={b.author} src={b.cover}/><b>{b.title}</b><small>{b.author}</small></button><button type="button" className="search-quick-add" aria-expanded={quickAdd?.key===b.key} aria-label={`Add ${b.title}`} onClick={()=>setQuickAdd(x=>x?.key===b.key?null:b)}><Plus/> Add</button>{quickAdd?.key===b.key&&<BookAddMenu title={b.title} clubName={a.workspace?.club.name} showClub={!!a.activeClubId} busy={busy==='quick'} onClose={()=>setQuickAdd(null)} onChoose={target=>chooseQuickTarget(b,target)}/>}</article>)}</div>}
  </div>
}

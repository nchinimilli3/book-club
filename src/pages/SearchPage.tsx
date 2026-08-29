import { useEffect, useMemo, useRef, useState } from 'react';
import { Heart, Plus, Search, X } from 'lucide-react';
import { BookCover } from '../components/BookCover';
import { BookSkeleton } from '../components/Skeleton';
import { BookRail } from '../components/BookRail';
import { BookAddMenu, type BookAddTarget } from '../components/BookAddMenu';
import { FeedbackMessage, PageState } from '../components/PageState';
import { SelectMenu } from '../components/SelectMenu';
import { buildLocalDecisionGuide, displayBookGenres, getBookDecisionDetails, searchBooks, type BookDecisionDetails, type BookSearchResult } from '../lib/books';
import { getBookDiscovery, getDecisionGuide, type BookDiscoveryResponse, type DecisionGuide } from '../lib/api';
import { catalogToSearchResult, discoveryToCatalog, type CatalogBook } from '../lib/catalog';
import { getPersonalLibrary, saveBookToClub, savePersonalBook } from '@book-club/data';
import { useApp } from '../lib/AppContext';
import { useRouter } from '../lib/router';

const SEARCH_KEY='bookclub:last-search';
const OPEN_BOOK_KEY='bookclub:open-book';
const PROFILE_TARGET_KEY='bookclub:profile-save-target';
const SEARCH_RETURN_KEY='bookclub:search-return';
const SCROLL_KEY='bookclub:search-scroll';
type ReturnTarget={path:string;label?:string;scrollY?:number};

const shelfLabel=(shelf:string)=>shelf==='want_to_read'?'Want to read':shelf==='currently_reading'?'Currently reading':'Books read';
const sameBook=(a?:BookSearchResult,b?:{title?:string;isbn?:string})=>!!a&&!!b&&((a.isbn&&b.isbn&&a.isbn===b.isbn)||a.title.trim().toLowerCase()===b.title?.trim().toLowerCase());
function topicTone(topic:string){let n=0;for(const c of topic)n=(n+c.charCodeAt(0))%5;return `topic-tone-${n+1}`}
function usefulGuideText(value?:string){const text=(value||'').trim();if(!text)return undefined;return /this reads as a book|catalog metadata|catalog .*subject data|predict discussion themes|thematic range|enough .*support a conversation/i.test(text)?undefined:text}

export function SearchPage(){
  const a=useApp(),{navigate:nav}=useRouter();
  const[q,setQ]=useState(()=>sessionStorage.getItem(SEARCH_KEY)||'');
  const[results,setResults]=useState<BookSearchResult[]>([]),[loading,setLoading]=useState(false);
  const[detail,setDetail]=useState<BookSearchResult|null>(null),[details,setDetails]=useState<BookDecisionDetails|null>(null),[guide,setGuide]=useState<DecisionGuide|null>(null),[guideLoading,setGuideLoading]=useState(false);
  const[busy,setBusy]=useState<'club'|'personal'|'quick'|null>(null),[notice,setNotice]=useState('');
  const[personalSaved,setPersonalSaved]=useState(false),[clubSaved,setClubSaved]=useState(false);
  const[personalLibrary,setPersonalLibrary]=useState<any[]>([]);
  const[personalShelf,setPersonalShelf]=useState('want_to_read'),[favorite,setFavorite]=useState(false),[profileReturn,setProfileReturn]=useState(false);
  const[quickAdd,setQuickAdd]=useState<BookSearchResult|null>(null);
  const[discovery,setDiscovery]=useState<BookDiscoveryResponse>({nyt:[],nytConfigured:false,nytStatus:'not_configured',apiReachable:true}),[discoveryLoading,setDiscoveryLoading]=useState(true);
  const[returnTarget,setReturnTarget]=useState<ReturnTarget|null>(null);
  const pushedRef=useRef(false);

  useEffect(()=>{
    if(!a.user){setPersonalLibrary([]);return}
    let cancelled=false;
    getPersonalLibrary(a.user.id).then(items=>{if(!cancelled)setPersonalLibrary(items)}).catch(()=>undefined);
    return()=>{cancelled=true};
  },[a.user?.id]);

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

  useEffect(()=>{
    if(!detail||!a.user){setPersonalSaved(false);return}
    let cancelled=false;
    getPersonalLibrary(a.user.id).then(items=>{
      if(cancelled)return;
      const saved=items.find((item: any)=>sameBook(detail,item.book));
      setPersonalSaved(!!saved);
      if(saved){setPersonalShelf(saved.shelf);setFavorite(saved.isFavorite)}
    }).catch(()=>undefined);
    return()=>{cancelled=true};
  },[detail?.key,a.user?.id]);

  useEffect(()=>{
    const inShortlist=!!detail&&(!!a.workspace?.ideaBooks.some(item=>sameBook(detail,item.book))||sameBook(detail,a.workspace?.currentBook?.book));
    setClubSaved(inShortlist);
  },[detail?.key,a.workspace?.ideaBooks,a.workspace?.currentBook?.id]);

  const local=useMemo(()=>details?buildLocalDecisionGuide(details):null,[details]);
  const clubPickLimitReached=(a.workspace?.ideaBooks.filter(item=>item.status==='idea'&&item.suggestedBy?.id===a.user?.id).length||0)>=3;
  function openDetail(book:BookSearchResult){setQuickAdd(null);sessionStorage.setItem(SCROLL_KEY,String(scrollY));sessionStorage.setItem(OPEN_BOOK_KEY,JSON.stringify(book));history.pushState({bookPreview:true},'',location.href);pushedRef.current=true;setDetail(book)}
  function exitSearch(){const target=returnTarget;sessionStorage.removeItem(OPEN_BOOK_KEY);sessionStorage.removeItem(PROFILE_TARGET_KEY);sessionStorage.removeItem(SEARCH_RETURN_KEY);nav(target?.path||(a.activeClubId?`/clubs/${a.activeClubId}`:'/clubs'),true);if(typeof target?.scrollY==='number')requestAnimationFrame(()=>requestAnimationFrame(()=>scrollTo({top:target.scrollY,behavior:'instant' as ScrollBehavior})))}
  function closeDetail(){sessionStorage.removeItem(OPEN_BOOK_KEY);if(pushedRef.current)history.back();else if(returnTarget?.path)exitSearch();else{setDetail(null);requestAnimationFrame(()=>scrollTo(0,Number(sessionStorage.getItem(SCROLL_KEY)||0)))}}

  async function suggestToClub(){if(!detail||!a.activeClubId)return;setBusy('club');setNotice('');try{const result=await saveBookToClub(a.activeClubId,{...detail,description:details?.description,subjects:details?.subjects||detail.subjects});setClubSaved(true);setNotice(result.alreadySaved?`Already on ${a.workspace?.club.name||'this club'}’s table.`:`Suggested to ${a.workspace?.club.name||'your club'}.`);void a.refresh()}catch(err:any){setNotice(err?.message||'Could not suggest this book.')}finally{setBusy(null)}}
  async function saveForMe(){if(!detail||!a.user)return;setBusy('personal');setNotice('');try{await savePersonalBook(a.user.id,{...detail,description:details?.description},{shelf:personalShelf,isFavorite:favorite});setPersonalSaved(true);setNotice(`Saved to ${shelfLabel(personalShelf)}${favorite?' and Favorites':''}.`);if(profileReturn)exitSearch()}catch(err:any){setNotice(err?.message||'Could not save this book.')}finally{setBusy(null)}}
  async function quickSave(book:BookSearchResult,target:'club'|'want_to_read'|'currently_reading'|'read'){
    setBusy('quick');setNotice('');
    try{
      if(target==='club'){
        if(!a.activeClubId)throw new Error('Choose a club first.');
        const result=await saveBookToClub(a.activeClubId,book);setNotice(result.alreadySaved?`${book.title} is already on the table.`:`${book.title} added to ${a.workspace?.club.name||'the club'}’s table.`);void a.refresh();
      }else{
        if(!a.user)throw new Error('Sign in to save books.');
        await savePersonalBook(a.user.id,book,{shelf:target});setPersonalLibrary(items=>[...items.filter(item=>!sameBook(book,item.book)),{book,shelf:target}]);setNotice(`${book.title} saved to ${shelfLabel(target)}.`);
      }
      setQuickAdd(null);
    }catch(err:any){setNotice(err?.message||'Could not add this book.')}finally{setBusy(null)}
  }

  const nytBooks=useMemo(()=>discovery.nyt.map(b=>discoveryToCatalog(b,'nyt')),[discovery.nyt]);
  function openCatalogBook(book:CatalogBook){openDetail(catalogToSearchResult(book))}
  function addCatalogBook(book:CatalogBook){setQuickAdd(catalogToSearchResult(book))}
  function chooseQuickTarget(book:BookSearchResult,target:BookAddTarget){void quickSave(book,target)}
  function savedTargetsFor(book:BookSearchResult):Partial<Record<BookAddTarget,boolean>>{
    return {
      club:!!a.workspace?.ideaBooks.some(item=>sameBook(book,item.book))||sameBook(book,a.workspace?.currentBook?.book),
      ...Object.fromEntries(personalLibrary.filter(item=>sameBook(book,item.book)).map(item=>[item.shelf,true]))
    } as Partial<Record<BookAddTarget,boolean>>;
  }


  if(detail)return <div className="page book-preview">
    <div className="book-preview-nav"><button type="button" className="preview-exit" onClick={closeDetail} aria-label="Close book preview"><X/></button></div>
    <section className="book-choice-layout">
      <aside className="preview-cover-column"><BookCover className="preview-cover" title={detail.title} author={detail.author} src={detail.cover}/><div className="preview-metadata book-facts"><div><small>Published</small><b>{detail.year||'Varies'}</b></div>{details?.pages&&<div><small>Length</small><b>{details.pages} pages</b></div>}{displayBookGenres(details?.subjects).map(genre=><div key={genre}><small>Genre</small><b>{genre}</b></div>)}</div></aside>
      <div className="preview-copy">
        <div className="preview-heading"><h1>{detail.title}</h1><p className="author">{detail.author}</p></div>
        <section className="decision-guide"><header><h2>Would this work for your club?</h2></header>{guideLoading&&!local?<div className="decision-loading">Checking this book…</div>:<>{usefulGuideText(guide?.whatItsAbout)&&<article className="decision-about"><h3>What it’s about</h3><p>{usefulGuideText(guide?.whatItsAbout)}</p></article>}{local&&<div className="decision-grid"><article className="decision-time"><h3>Time commitment</h3><p>{local.commitment}</p></article><article className="decision-fit"><h3>Why it could work</h3><p>{usefulGuideText(guide?.whyItWorks)||local.fit}</p></article>{(usefulGuideText(guide?.conversation?.join(' · '))||local.discussion)&&<article className="decision-talk"><h3>Likely discussion</h3><p>{usefulGuideText(guide?.conversation?.join(' · '))||local.discussion}</p></article>}{usefulGuideText(guide?.headsUp)&&<article className="decision-headsup"><h3>Worth knowing</h3><p>{usefulGuideText(guide?.headsUp)}</p></article>}</div>}<div className="decision-topics">{(guide?.vibe||local?.topics||[]).slice(0,5).map(x=><span className={topicTone(x)} key={x}>{x}</span>)}</div></>}</section>
        <div className="relationship-actions preview-save-actions">
          <section className="preview-personal-save"><label className="preview-shelf-field"><span>Save to</span><SelectMenu className="preview-shelf-menu" ariaLabel="Personal shelf" value={personalShelf} options={[{value:'want_to_read',label:'Want to read'},{value:'currently_reading',label:'Currently reading'},{value:'read',label:'Books read'}]} onChange={value=>{setPersonalShelf(value);setPersonalSaved(false)}}/></label><div className="preview-save-row"><button type="button" className={`favorite-toggle ${favorite?'selected':''}`} onClick={()=>setFavorite(v=>!v)} aria-pressed={favorite}><Heart fill={favorite?'currentColor':'none'}/> {favorite?'Favorite':'Mark favorite'}</button><button type="button" className="primary preview-personal-save-button" onClick={saveForMe} disabled={!a.user||busy!==null}>{busy==='personal'?'Saving…':personalSaved?`Saved to ${shelfLabel(personalShelf)}`:`Save to ${shelfLabel(personalShelf)}`}</button></div></section>
          <section className="preview-club-save"><button type="button" className="primary" onClick={suggestToClub} disabled={!a.activeClubId||busy!==null||(clubPickLimitReached&&!clubSaved)}>{busy==='club'?'Adding…':clubSaved?`In ${a.workspace?.club.name||'club'} shortlist`:clubPickLimitReached?'Your 3 club picks are used':`Add to ${a.workspace?.club.name||'club'} shortlist`}</button></section>
        </div>
        {notice&&<FeedbackMessage>{notice}</FeedbackMessage>}
      </div>
    </section>
  </div>;

  return <div className="page search-page"><header className="page-title search-title"><h1>Find a book</h1>{returnTarget&&<button type="button" className="search-exit" onClick={exitSearch} aria-label={`Close search and return to ${returnTarget.label||'previous page'}`}><X/></button>}</header><div className="search-field"><Search/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Title, author, ISBN" autoFocus/>{q&&<button type="button" onClick={()=>setQ('')} aria-label="Clear search"><X/></button>}</div>{notice&&<FeedbackMessage className="search-notice">{notice}</FeedbackMessage>}
    {!q.trim()?<div className="search-discovery">
      <BookRail title="NYT Best Sellers" books={nytBooks} loading={discoveryLoading} meta={b=>b.rank?`#${b.rank} · ${b.listName||'Best Sellers'}`:(b.listName||'Best Sellers')} onOpen={openCatalogBook} onAdd={addCatalogBook} renderOverlay={book=>quickAdd?.key===book.key?<BookAddMenu title={book.title} clubName={a.workspace?.club.name} showClub={!!a.activeClubId} busy={busy==='quick'} clubLimitReached={clubPickLimitReached} savedTargets={savedTargetsFor(catalogToSearchResult(book))} onClose={()=>setQuickAdd(null)} onChoose={target=>chooseQuickTarget(catalogToSearchResult(book),target)}/>:null} emptyMessage={!discovery.apiReachable?'The deployed site cannot reach the Book Club API.':!discovery.nytConfigured?'NYT is not configured on the API Worker.':discovery.nytStatus==='error'?'NYT is connected, but its request was rejected.':'Best Sellers are unavailable right now.'}/>
      {!discovery.apiReachable?<p className="discovery-config-note discovery-config-error">API connection failed: {discovery.nytError||'the Pages app could not reach the BOOK CLUB API.'}</p>:discovery.nytStatus==='error'?<p className="discovery-config-note discovery-config-error">NYT Worker check failed: {discovery.nytError||'provider request failed.'}</p>:!discovery.nytConfigured?<p className="discovery-config-note">Add NYT_BOOKS_API_KEY to the BOOK CLUB API Worker and redeploy it.</p>:null}
    </div>:loading?<BookSkeleton count={8}/>:q.trim().length>=2&&!results.length?<PageState title="No match yet." body="Try the title and author." compact/>:<div className="book-wall">{results.map(b=><article className="search-book-card" key={b.key}><button type="button" className="search-book-open" onClick={()=>openDetail(b)} aria-label={`Open ${b.title}`}><BookCover className="book-image" title={b.title} author={b.author} src={b.cover}/><b>{b.title}</b><small>{b.author}</small></button><button type="button" className="search-quick-add" aria-expanded={quickAdd?.key===b.key} aria-label={`Add ${b.title}`} onClick={()=>setQuickAdd(x=>x?.key===b.key?null:b)}><Plus/> Add</button>{quickAdd?.key===b.key&&<BookAddMenu title={b.title} clubName={a.workspace?.club.name} showClub={!!a.activeClubId} busy={busy==='quick'} clubLimitReached={clubPickLimitReached} savedTargets={savedTargetsFor(b)} onClose={()=>setQuickAdd(null)} onChoose={target=>chooseQuickTarget(b,target)}/>}</article>)}</div>}
  </div>
}

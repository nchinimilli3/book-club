import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Eye, EyeOff, Heart, Palette, Plus, Search, Settings, Star, Sticker as StickerIcon, Upload } from 'lucide-react';
import { useRouter } from '../lib/router';
import { useApp } from '../lib/AppContext';
import { getPersonalLibrary, importGoodreads, previewGoodreadsImport, repairBookCover, updatePersonalBook, updateProfileStyle, type GoodreadsImportPreview, type GoodreadsImportResult } from '@book-club/data';
import { Modal } from '../components/Modal';
import { BookCover } from '../components/BookCover';
import { SelectMenu } from '../components/SelectMenu';
import AcrylicBookshelf from '../components/AcrylicBookshelf';
import { StickerBoard, StickerTray } from '../components/StickerBoard';
import { stickerDefaultScale } from '../lib/stickers';
import { readProfileStyleCache, writeProfileStyleCache } from '../lib/profileStyleCache';
import type { ProfileStyle } from '../lib/model';
import { findBestBookCover } from '../lib/books';
import { resolveBookCover } from '../lib/api';

const YEAR=new Date().getFullYear();
const defaultStyle:ProfileStyle={palette:'rose',layout:'scrapbook',note:'',stickers:[]};
const PROFILE_TARGET_KEY='bookclub:profile-save-target';
const SEARCH_RETURN_KEY='bookclub:search-return';
type LibraryItem = Awaited<ReturnType<typeof getPersonalLibrary>>[number];

export function ProfilePage(){
  const a=useApp(),{navigate:nav}=useRouter();
  const[items,setItems]=useState<LibraryItem[]>([]);
  const[libraryLoading,setLibraryLoading]=useState(true);
  const[importing,setImporting]=useState(false);
  const[importOpen,setImportOpen]=useState(false);
  const[importFile,setImportFile]=useState<File|null>(null);
  const[importPreview,setImportPreview]=useState<GoodreadsImportPreview|null>(null);
  const[importResult,setImportResult]=useState<GoodreadsImportResult|null>(null);
  const[importProgress,setImportProgress]=useState({done:0,total:0});
  const[importError,setImportError]=useState('');
  const[importStage,setImportStage]=useState<'choose'|'preview'|'importing'|'success'>('choose');
  const[notice,setNotice]=useState('');
  const[customizeOpen,setCustomizeOpen]=useState(false);
  const[editItem,setEditItem]=useState<LibraryItem|null>(null);
  const[ratingOpen,setRatingOpen]=useState(false);
  const[stickering,setStickering]=useState(false);
  const stickerEditBase=useRef<ProfileStyle|null>(null);
  const[style,setStyle]=useState<ProfileStyle>(a.profile?.style||defaultStyle);
  const[syncError,setSyncError]=useState('');
  const[saving,setSaving]=useState(false);
  const[editorStatus,setEditorStatus]=useState('');
  const[verifiedCovers,setVerifiedCovers]=useState<Set<string>>(()=>new Set());
  const[failedCovers,setFailedCovers]=useState<Set<string>>(()=>new Set());
  const coverRepairAttempts=useRef<Set<string>>(new Set());
  const coverValidationAttempts=useRef<Set<string>>(new Set());

  async function reload(showLoading=false){
    if(!a.user){setItems([]);setLibraryLoading(false);return}
    if(showLoading)setLibraryLoading(true);
    try{setItems(await getPersonalLibrary(a.user.id))}finally{if(showLoading)setLibraryLoading(false)}
  }
  useEffect(()=>{
    let cancelled=false;
    const userId=a.user?.id;
    setLibraryLoading(true);
    if(!userId){setItems([]);setLibraryLoading(false);return()=>{cancelled=true}};
    void getPersonalLibrary(userId)
      .then(next=>{if(!cancelled)setItems(next)})
      .catch((error:any)=>{if(!cancelled){setItems([]);setNotice(error?.message||'Could not load your library.')}})
      .finally(()=>{if(!cancelled)setLibraryLoading(false)});
    return()=>{cancelled=true};
  },[a.user?.id]);
  useEffect(()=>{
    if(stickering||!a.user)return;
    const cached=readProfileStyleCache(a.user.id);
    if(cached?.pending){
      setStyle(cached.style);a.applyProfileStyle(cached.style);
      setSyncError('Your sticker layout is saved on this device but still needs to sync.');
      return;
    }
    setStyle(a.profile?.style||defaultStyle);
  },[a.user?.id,a.profile?.style,stickering]);
  useEffect(()=>{if(stickering&&a.user)writeProfileStyleCache(a.user.id,style,true)},[style,stickering,a.user?.id]);
  useEffect(()=>{
    if(!a.user||stickering)return;
    const userId=a.user.id,cached=readProfileStyleCache(userId);
    if(!cached?.pending)return;
    let cancelled=false;
    const sync=async()=>{
      if(cancelled||!navigator.onLine)return;
      try{const persisted=await updateProfileStyle(userId,cached.style);if(cancelled)return;setStyle(persisted);a.applyProfileStyle(persisted);writeProfileStyleCache(userId,persisted,false);setSyncError('');setNotice('Sticker layout synced to the cloud.')}catch(err:any){if(!cancelled)setSyncError(err?.message||'Your sticker layout is saved here and will retry automatically.')}
    };
    const timer=window.setTimeout(()=>void sync(),900);
    const onOnline=()=>void sync();window.addEventListener('online',onOnline);
    return()=>{cancelled=true;window.clearTimeout(timer);window.removeEventListener('online',onOnline)};
  },[a.user?.id,stickering]);

  const read=items.filter(x=>['read','finished'].includes(x.shelf));
  const want=items.filter(x=>['want_to_read','to-read'].includes(x.shelf));
  const current=items.filter(x=>['currently_reading','currently-reading'].includes(x.shelf));
  const year=read.filter(x=>Boolean(x.dateFinished)&&x.dateFinished!.startsWith(String(YEAR)));
  const rated=read.filter(x=>x.rating);
  const avg=rated.length?(rated.reduce((s,x)=>s+(x.rating||0),0)/rated.length).toFixed(1):'—';
  const favorites=items.filter(x=>x.isFavorite);
  const favoriteReads=useMemo(()=>[...favorites,...items.filter(x=>x.rating===5)].filter((x,i,list)=>list.findIndex(y=>y.book.id===x.book.id)===i),[favorites,items]);
  const collage=useMemo(()=>[...favorites,...current,...read,...want].filter((x,i,list)=>list.findIndex(y=>y.book.id===x.book.id)===i).slice(0,5),[items]);
  const hasGoodreads=items.some(x=>x.source==='goodreads');
  function coverPriority(item:LibraryItem){if(verifiedCovers.has(item.id))return 3;if(item.book.coverUrl&&!failedCovers.has(item.id))return 2;return 1}
  function shelfPreview(list:LibraryItem[],limit:number){return [...list].sort((x,y)=>coverPriority(y)-coverPriority(x)).slice(0,limit)}
  async function recoverCover(item:LibraryItem,force=false){
    if(!a.user||(!force&&coverRepairAttempts.current.has(item.id)))return;
    coverRepairAttempts.current.add(item.id);
    const resolved=await resolveBookCover({title:item.book.title,author:item.book.author,isbn:item.book.isbn,currentCover:item.book.coverUrl});
    const cover=resolved?.url||await findBestBookCover({title:item.book.title,author:item.book.author,isbn:item.book.isbn});
    if(!cover){setFailedCovers(old=>new Set(old).add(item.id));return}
    const saved=await repairBookCover(item.book.id,cover);
    if(!saved){setFailedCovers(old=>new Set(old).add(item.id));return}
    setItems(old=>old.map(x=>x.id===item.id?{...x,book:{...x.book,coverUrl:cover}}:x));
    setFailedCovers(old=>{const next=new Set(old);next.delete(item.id);return next});
    setVerifiedCovers(old=>{const next=new Set(old);next.delete(item.id);return next});
    coverValidationAttempts.current.delete(item.id);
  }
  useEffect(()=>{
    if(!a.user||!items.length)return;
    const pending=items.filter(item=>!item.book.coverUrl&&!failedCovers.has(item.id)&&!coverRepairAttempts.current.has(item.id)).slice(0,8);
    pending.forEach(item=>void recoverCover(item));
  },[a.user?.id,items,failedCovers]);
  useEffect(()=>{
    if(!a.user||!items.length)return;
    let cancelled=false;
    const pending=items.filter(item=>item.book.coverUrl&&!verifiedCovers.has(item.id)&&!failedCovers.has(item.id)&&!coverValidationAttempts.current.has(item.id)).slice(0,18);
    pending.forEach(item=>{
      coverValidationAttempts.current.add(item.id);
      const img=new Image();
      img.onload=()=>{if(!cancelled)setVerifiedCovers(old=>new Set(old).add(item.id))};
      img.onerror=()=>{if(cancelled)return;setFailedCovers(old=>new Set(old).add(item.id));void recoverCover(item,true)};
      img.src=item.book.coverUrl!;
    });
    return()=>{cancelled=true};
  },[a.user?.id,items,verifiedCovers,failedCovers]);

  function rememberSearchReturn(){sessionStorage.setItem(SEARCH_RETURN_KEY,JSON.stringify({path:'/me',label:'Profile',scrollY:window.scrollY}))}

  function openBook(item:LibraryItem){
    rememberSearchReturn();
    sessionStorage.setItem('bookclub:open-book',JSON.stringify({key:`db:${item.book.id}`,source:'openlibrary',title:item.book.title,author:item.book.author,cover:item.book.coverUrl||'',year:item.book.year,isbn:item.book.isbn,pages:item.book.pages,description:item.book.description}));
    nav('/search');
  }

  function findForProfile(shelf='want_to_read',favorite=false){
    rememberSearchReturn();
    sessionStorage.removeItem('bookclub:open-book');
    sessionStorage.setItem(PROFILE_TARGET_KEY,JSON.stringify({shelf,favorite}));
    nav('/search');
  }

  async function setProfileImage(kind:'wallpaperUrl'|'avatarUrl',file?:File){
    if(!file)return;
    try{
      if(!file.type.startsWith('image/'))throw new Error('Choose an image file.');
      const source=URL.createObjectURL(file);
      try{
        const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('That image could not be opened.'));img.src=source});
        const limit=kind==='avatarUrl'?320:1280;
        const scale=Math.min(1,limit/Math.max(image.naturalWidth,image.naturalHeight));
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
        const context=canvas.getContext('2d');if(!context)throw new Error('That image could not be prepared.');
        context.drawImage(image,0,0,canvas.width,canvas.height);
        const maxBytes=kind==='avatarUrl'?90*1024:260*1024;
        let quality=.82,blob:Blob|undefined;
        while(quality>=.42){blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('That image could not be prepared.')),'image/webp',quality));if(blob.size<=maxBytes)break;quality-=.08}
        if(!blob||blob.size>maxBytes)throw new Error('Choose a simpler image; it could not be optimized enough to save.');
        const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(new Error('That image could not be prepared.'));reader.readAsDataURL(blob)});
        setStyle(s=>({...s,[kind]:dataUrl}));
      }finally{URL.revokeObjectURL(source)}
    }catch(error:any){setNotice(error?.message||'Could not prepare that image.')}
  }


  function openGoodreadsImport(){
    setImportOpen(true);setImportFile(null);setImportPreview(null);setImportResult(null);setImportProgress({done:0,total:0});setImportError('');setImportStage('choose');
  }
  async function chooseGoodreadsFile(file:File){
    setImportFile(file);setImportError('');setImporting(true);
    try{const preview=await previewGoodreadsImport(file);setImportPreview(preview);setImportStage('preview')}
    catch(err:any){setImportError(err?.message||'Could not read that Goodreads export.');setImportFile(null);setImportPreview(null);setImportStage('choose')}
    finally{setImporting(false)}
  }
  async function runGoodreadsImport(){
    if(!a.user||!importFile)return;setImportError('');setImporting(true);setImportStage('importing');
    try{
      const result=await importGoodreads(a.user.id,importFile,(done,total)=>setImportProgress({done,total}));
      setImportResult(result);await reload();setNotice(`${result.imported} books brought over from Goodreads.`);setImportStage('success');
    }catch(err:any){setImportError(err?.message||'Could not finish the Goodreads import.');setImportStage('preview')}
    finally{setImporting(false)}
  }

  async function saveStyle(){
    if(!a.user)return;
    const draft=structuredClone(style) as ProfileStyle;
    writeProfileStyleCache(a.user.id,draft,true);a.applyProfileStyle(draft);setCustomizeOpen(false);
    setSaving(true);setNotice('Saving profile design…');setSyncError('');
    try{const persisted=await updateProfileStyle(a.user.id,draft);setStyle(persisted);a.applyProfileStyle(persisted);writeProfileStyleCache(a.user.id,persisted,false);setNotice('Profile design saved.')}catch(err:any){setSyncError(err?.message||'Couldn’t finish saving.');setNotice('Design saved on this device.')}finally{setSaving(false)}
  }

  function openStickerEditor(){stickerEditBase.current=structuredClone(style);setStickering(true);setNotice('')}
  function cancelStickerEditor(){if(stickerEditBase.current)setStyle(stickerEditBase.current);stickerEditBase.current=null;setStickering(false);setNotice('Sticker changes cancelled.')}
  async function finishStickerEditor(){
    if(!a.user){setStickering(false);return}
    const userId=a.user.id,draft=structuredClone(style) as ProfileStyle;
    writeProfileStyleCache(userId,draft,true);a.applyProfileStyle(draft);stickerEditBase.current=null;setStickering(false);setSaving(true);setNotice('Profile saved. Finishing up…');setSyncError('');
    try{
      const persisted=await Promise.race([updateProfileStyle(userId,draft),new Promise<never>((_,reject)=>window.setTimeout(()=>reject(new Error('Saving is taking longer than expected.')),10000))]);
      setStyle(persisted);a.applyProfileStyle(persisted);writeProfileStyleCache(userId,persisted,false);setNotice('Profile saved.');
    }catch(err:any){setSyncError(err?.message||'Couldn’t save everywhere yet.');setNotice('Profile saved on this device.')}finally{setSaving(false)}
  }
  async function retryProfileStyleSync(){
    if(!a.user)return;const cached=readProfileStyleCache(a.user.id);const draft=cached?.style||style;setSaving(true);setSyncError('');setNotice('Saving profile…');
    try{const persisted=await updateProfileStyle(a.user.id,draft);setStyle(persisted);a.applyProfileStyle(persisted);writeProfileStyleCache(a.user.id,persisted,false);setNotice('Profile saved.')}catch(err:any){setSyncError(err?.message||'Couldn’t finish saving.');setNotice('Profile is still saved on this device.')}finally{setSaving(false)}
  }
  function addSticker(key:string){
    const id=crypto.randomUUID?.()||Math.random().toString(36).slice(2,12);
    setStyle(s=>{const existing=s.stickers||[],offset=(existing.length%5)-2;return {...s,stickers:[...existing,{id,key,x:50+(offset*4),y:34+((existing.length%3)*5),r:(Math.random()*8)-4,s:stickerDefaultScale(key),z:Math.max(0,...existing.map(x=>x.z||0))+1}]}})
  }
  async function patchBook(item:LibraryItem,patch:{shelf?:string;rating?:number|null;dateFinished?:string|null;isFavorite?:boolean;isPublic?:boolean},label='Change'){
    if(!a.user)return false;
    setEditorStatus('Saving…');
    try{await updatePersonalBook(a.user.id,item.id,patch);await reload();setEditorStatus(`${label} saved`);window.setTimeout(()=>setEditorStatus('Saved'),1200);return true}catch(err:any){setEditorStatus(err?.message||'Could not save');return false}
  }

  const palette=style.palette||'rose',layout=style.layout||'scrapbook';
  const profileWallpaper=style.wallpaperUrl||(palette==='paper'?'/wallpapers/choice-mythology.webp':`/wallpapers/club-${palette}.webp`);
  const profileAvatar=style.avatarUrl||a.profile?.avatarUrl;
  return <div className={`page profile-page profile-${palette} profile-layout-${layout}${stickering?' sticker-edit-mode':''}`}>
    <section className="profile-scrapbook-hero">
      <img className="profile-wallpaper" src={profileWallpaper} alt="" aria-hidden="true"/>
      <div className="profile-wallpaper-shade" aria-hidden="true"/>
      <div className="profile-identity">
        <p>Your profile</p>
        {profileAvatar&&<img className="profile-custom-avatar" src={profileAvatar} alt="" aria-hidden="true"/>}
        <h1>{a.profile?.displayName||'Reader'}</h1>
        {style.note&&<blockquote>{style.note}</blockquote>}
        <div className="profile-hero-actions"><button type="button" className="secondary" onClick={()=>setCustomizeOpen(true)}><Palette/> Customize</button><button type="button" className="secondary" onClick={openStickerEditor}><StickerIcon/> Stickers</button><button type="button" className="icon-button" onClick={()=>nav('/me/settings')} aria-label="Settings"><Settings/></button></div>
      </div>
      <div className={`profile-cover-collage${libraryLoading?' is-loading':''}`} aria-label="A few books from your shelves">{libraryLoading?Array.from({length:5},(_,i)=><span className="profile-cover-placeholder" key={i} style={{'--i':i} as any}/>):collage.map((x,i)=><button type="button" key={x.book.id} style={{'--i':i} as any} onClick={()=>openBook(x)} aria-label={`Open ${x.book.title}`}><BookCover title={x.book.title} author={x.book.author} src={x.book.coverUrl}/></button>)}</div>
      <StickerBoard stickers={style.stickers||[]} editing={stickering} onChange={stickers=>setStyle(s=>({...s,stickers}))}/>
    </section>

    {stickering&&<StickerTray onPick={addSticker} onClose={cancelStickerEditor} onDone={finishStickerEditor} onReset={()=>setStyle(s=>({...s,stickers:[]}))} saving={saving}/>} 

    <section className={`profile-overview${libraryLoading?' profile-library-loading':''}`} aria-busy={libraryLoading}>
      <div className="profile-number"><b>{libraryLoading?<span className="profile-stat-placeholder"/>:read.length}</b><span>Books read</span></div>
      <div className="profile-number"><b>{a.clubs.length}</b><span>Clubs</span></div>
      <button type="button" className="profile-number profile-number-action" disabled={libraryLoading} onClick={()=>setRatingOpen(true)}><b>{libraryLoading?<span className="profile-stat-placeholder"/>:avg}</b><span>Average rating</span>{!libraryLoading&&<small>Rate a book</small>}</button>
    </section>

    <section className={`reading-year-new${libraryLoading?' profile-library-loading':''}`} aria-busy={libraryLoading}>
      <header><div><p>{YEAR}</p><h2>Your reading year</h2></div><b>{libraryLoading?<span className="profile-line-placeholder short"/>:<>{year.length} {year.length===1?'book':'books'}</>}</b></header>
      {libraryLoading?<div className="year-strip profile-year-loading" aria-hidden="true">{Array.from({length:5},(_,i)=><span className="profile-book-placeholder" key={i}/>)}</div>:year.length?<div className="year-strip">{year.slice(0,14).map((x,i)=><button type="button" key={x.id} style={{'--i':i} as any} onClick={()=>openBook(x)}><BookCover title={x.book.title} author={x.book.author} src={x.book.coverUrl}/><span>{x.book.title}</span></button>)}</div>:<p className="year-empty">Finish a book this year and it’ll start building here.</p>}
      <div className="year-facts"><article><span>5★ books</span><b>{libraryLoading?<span className="profile-line-placeholder"/>:year.filter(x=>x.rating===5).length}</b></article><article><span>Pages tracked</span><b>{libraryLoading?<span className="profile-line-placeholder"/>:year.reduce((sum,x)=>sum+(x.book.pages||0),0).toLocaleString()}</b></article><article><span>Most recent</span><b>{libraryLoading?<span className="profile-line-placeholder wide"/>:year[0]?.book.title||'—'}</b></article></div>
    </section>

    {libraryLoading?<ProfileShelfLoading title="Favorites & 5-star reads"/>:<Shelf title="Favorites & 5-star reads" items={shelfPreview(favoriteReads,favoriteReads.length)} total={favoriteReads.length} empty="No favorites or 5-star reads yet." onAdd={()=>findForProfile('want_to_read',true)} onOpen={openBook} onEdit={setEditItem}/>}
    {libraryLoading?<ProfileShelfLoading title="Currently reading"/>:current.length>0&&<Shelf title="Currently reading" items={shelfPreview(current,current.length)} total={current.length} empty="" onAdd={()=>findForProfile('currently_reading')} onOpen={openBook} onEdit={setEditItem}/>}
    {libraryLoading?<ProfileShelfLoading title="Books read"/>:<Shelf title="Books read" items={shelfPreview(read,read.length)} total={read.length} empty="No finished books yet." onAdd={()=>findForProfile('read')} onOpen={openBook} onEdit={setEditItem}/>}
    {libraryLoading?<ProfileShelfLoading title="Want to read"/>:<Shelf title="Want to read" items={shelfPreview(want,want.length)} total={want.length} empty="Nothing saved yet." onAdd={()=>findForProfile('want_to_read')} onOpen={openBook} onEdit={setEditItem}/>}

    {libraryLoading?<ProfileLibraryActionsLoading/>:<section className="profile-library-actions"><div className="profile-library-copy"><h2>Add to your reading life</h2><p>Search one book, or bring over the Goodreads shelves you already built.</p><div className="profile-action-buttons"><button type="button" className="primary" onClick={()=>findForProfile('want_to_read')}><Search/> Search books <ArrowRight/></button><button type="button" className="secondary" onClick={openGoodreadsImport}><Upload/> {hasGoodreads?'Update from Goodreads':'Import from Goodreads'}</button></div></div><div className="profile-library-graphic goodreads-import-graphic"><img src="/profile/goodreads-reading-coffee.png" alt="Open books surrounding a cup of coffee"/><div className="goodreads-import-caption"><span className="goodreads-poster-mark" aria-hidden="true">G</span><div><b>Goodreads import</b><small>CSV shelves become your Book Club library</small></div></div></div></section>}

    {(notice||syncError)&&<div className={`import-notice${syncError?' sync-warning':''}`} role="status"><span>{notice}{syncError&&<> <b>{syncError}</b></>}</span>{syncError&&<button type="button" className="secondary" disabled={saving} onClick={()=>void retryProfileStyleSync()}>{saving?'Syncing…':'Retry cloud sync'}</button>}</div>}

    {!libraryLoading&&!items.length&&<section className="import-panel goodreads-helper">
      <div className="goodreads-copy"><span className="goodreads-mark">G</span><div><p className="goodreads-kicker">Start with your history</p><h2>Bring your books from Goodreads</h2><p>Your shelves and ratings can fill this profile in one go. Nothing is added to a club.</p></div></div>
      <div className="goodreads-empty-actions"><button type="button" className="primary" onClick={openGoodreadsImport}><Upload/> Import Goodreads library</button><button type="button" className="quiet-action" onClick={()=>findForProfile('want_to_read')}>I’ll add books myself</button></div>
    </section>}

    <Modal open={importOpen} onClose={()=>{if(importStage!=='importing')setImportOpen(false)}} title={importStage==='success'?'Your library is here':'Import from Goodreads'} className="goodreads-import-sheet">
      {importStage==='choose'&&<div className="goodreads-import-step">
        <p className="goodreads-import-lede">Upload the CSV exported from Goodreads.</p>
        <label className="goodreads-file-button primary">{importing?'Reading your Goodreads library…':'Choose Goodreads CSV'}<Upload aria-hidden="true"/><input type="file" accept=".csv,text/csv" hidden disabled={importing} onChange={e=>{const file=e.target.files?.[0];if(file)void chooseGoodreadsFile(file);e.currentTarget.value=''}}/></label>
        {importError&&<p className="goodreads-import-error" role="alert">{importError}</p>}
        <small>Reviews and private notes are not published into club discussions.</small>
      </div>}
      {importStage==='preview'&&importPreview&&<div className="goodreads-import-step">
        <div className="goodreads-preview-head"><p>Your Goodreads library is ready</p><b>{importPreview.total}</b><span>books found</span></div>
        <div className="goodreads-preview-stats"><span><b>{importPreview.read}</b>Read</span><span><b>{importPreview.currentlyReading}</b>Reading</span><span><b>{importPreview.wantToRead}</b>Want to read</span><span><b>{importPreview.rated}</b>Rated</span></div>
        <div className="goodreads-preview-books" aria-label="Sample books from import">{importPreview.samples.map((book,i)=><figure key={`${book.title}-${i}`}>{book.cover?<img src={book.cover} alt="" onError={e=>{e.currentTarget.style.display='none'}}/>:<span>{book.title.slice(0,1)}</span>}<figcaption>{book.title}</figcaption></figure>)}</div>
        {importError&&<p className="goodreads-import-error" role="alert">{importError}</p>}
        <div className="goodreads-import-actions"><button type="button" className="secondary" onClick={()=>{setImportStage('choose');setImportFile(null);setImportPreview(null)}}>Choose another file</button><button type="button" className="primary" onClick={()=>void runGoodreadsImport()}>Import library</button></div>
      </div>}
      {importStage==='importing'&&<div className="goodreads-import-progress" role="status" aria-live="polite"><p>{importProgress.done===0?'Preparing your import...':'Bringing over your books'}</p><b>{importProgress.done}<span> / {importProgress.total||importPreview?.total||0}</span></b><div><i style={{width:`${importProgress.total?Math.round(importProgress.done/importProgress.total*100):0}%`}}/></div><small>{importProgress.done===0?'Getting your Goodreads import ready.':'You can keep this open while the library is saved. Existing Book Club favorites and profile privacy choices stay intact.'}</small></div>}
      {importStage==='success'&&importResult&&<div className="goodreads-import-success"><p>Imported without changing your club shelves.</p><div className="goodreads-preview-stats"><span><b>{importResult.read}</b>Read</span><span><b>{importResult.currentlyReading}</b>Reading</span><span><b>{importResult.wantToRead}</b>Want to read</span><span><b>{importResult.rated}</b>Rated</span></div><button type="button" className="primary full" onClick={()=>{setImportOpen(false);window.scrollTo({top:0,behavior:'smooth'})}}>See my profile</button></div>}
    </Modal>

    <Modal open={Boolean(editItem)} onClose={()=>{setEditItem(null);setEditorStatus('')}} title={editItem?.book.title||'Edit book'}>
      {editItem&&<div className="book-editor">
        <div className="star-rating" aria-label="Rating">{[1,2,3,4,5].map(n=><button type="button" key={n} className={(editItem.rating||0)>=n?'selected':''} onClick={async()=>{if(await patchBook(editItem,{rating:n},'Rating'))setEditItem({...editItem,rating:n})}}><Star fill={(editItem.rating||0)>=n?'currentColor':'none'}/><span className="sr-only">{n} {n===1?'star':'stars'}</span></button>)}</div>
        <label className="editor-field"><span>Shelf</span><SelectMenu ariaLabel="Shelf" value={editItem.shelf} options={[{value:'want_to_read',label:'Want to read'},{value:'currently_reading',label:'Currently reading'},{value:'read',label:'Books read'}]} onChange={async shelf=>{if(await patchBook(editItem,{shelf},'Shelf'))setEditItem({...editItem,shelf})}}/></label>
        <button type="button" className={`favorite-toggle ${editItem.isFavorite?'selected':''}`} onClick={async()=>{const isFavorite=!editItem.isFavorite;if(await patchBook(editItem,{isFavorite},'Favorite'))setEditItem({...editItem,isFavorite})}}><Heart fill={editItem.isFavorite?'currentColor':'none'}/> {editItem.isFavorite?'Favorite':'Add to Favorites'}</button>
        <button type="button" className={`privacy-toggle ${editItem.isPublic!==false?'selected':''}`} onClick={async()=>{const isPublic=editItem.isPublic===false;if(await patchBook(editItem,{isPublic},'Visibility'))setEditItem({...editItem,isPublic})}}>{editItem.isPublic!==false?<Eye/>:<EyeOff/>}<span><b>{editItem.isPublic!==false?'Visible to club members':'Private on my profile'}</b><small>Your private notes and quotes are always private.</small></span></button>
        <div className={`autosave-status${editorStatus==='Saving…'?' saving':''}`} role="status"><i/>{editorStatus||'Changes save automatically'}</div>
      </div>}
    </Modal>

    <Modal open={ratingOpen} onClose={()=>setRatingOpen(false)} title="Rate your books" className="rating-sheet">
      <div className="rating-list">{read.length?read.map(item=><article key={item.id}><div><button type="button" className="rating-book-cover" onClick={()=>openBook(item)} aria-label={`Open ${item.book.title}`}><BookCover title={item.book.title} author={item.book.author} src={item.book.coverUrl}/></button><span><b>{item.book.title}</b><small>{item.book.author}</small></span></div><div className="star-rating">{[1,2,3,4,5].map(n=><button type="button" key={n} className={(item.rating||0)>=n?'selected':''} onClick={()=>patchBook(item,{rating:n})}><Star fill={(item.rating||0)>=n?'currentColor':'none'}/></button>)}</div></article>):<p>Add a finished book first, then rate it here.</p>}</div>
    </Modal>

    <Modal open={customizeOpen} onClose={()=>setCustomizeOpen(false)} title="Design your profile">
      <div className="profile-customizer">
        <h3>Images</h3><div className="profile-image-controls"><label><span>Heading picture</span><b>Choose image</b><input type="file" accept="image/*" onChange={e=>void setProfileImage('wallpaperUrl',e.target.files?.[0])}/></label><label><span>Profile picture</span><b>Choose image</b><input type="file" accept="image/*" onChange={e=>void setProfileImage('avatarUrl',e.target.files?.[0])}/></label></div>
        <h3>Wallpaper</h3><div className="palette-choices wallpaper-choices">{(['rose','olive','gold','plum','blue','paper'] as const).map(x=><button type="button" key={x} aria-label={`Use ${x} wallpaper`} className={`palette-choice ${x} ${style.palette===x?'selected':''}`} onClick={()=>setStyle({...style,palette:x,wallpaperUrl:undefined})}><i style={{backgroundImage:`url(${x==='paper'?'/wallpapers/choice-mythology.webp':`/wallpapers/club-${x}.webp`})`}}/><span>{x}</span></button>)}</div>
        <label>Profile note <span>optional</span><input maxLength={90} value={style.note||''} onChange={e=>setStyle({...style,note:e.target.value})}/></label>
        <div className="modal-actions"><button type="button" className="secondary" onClick={()=>setCustomizeOpen(false)}>Cancel</button><button type="button" className="primary" disabled={saving} onClick={saveStyle}>{saving?'Saving…':'Save design'}</button></div>
      </div>
    </Modal>
  </div>
}


function ProfileLibraryActionsLoading(){
  return <section className="profile-library-actions profile-library-actions-loading" aria-busy="true" aria-label="Loading library actions"><div className="profile-library-copy" aria-hidden="true"><span className="profile-line-placeholder wide"/><span className="profile-copy-placeholder"/><span className="profile-copy-placeholder short"/><div className="profile-action-placeholder-row"><span/><span/></div></div><div className="profile-library-graphic profile-library-graphic-placeholder" aria-hidden="true"/></section>
}

function ProfileShelfLoading({title}:{title:string}){
  return <section className="profile-shelf profile-shelf-loading" aria-busy="true" aria-label={`Loading ${title}`}><header><div><h2>{title}</h2><span className="profile-line-placeholder short"/></div></header><div className="profile-shelf-loading-books" aria-hidden="true">{Array.from({length:5},(_,i)=><span className="profile-book-placeholder" key={i}/>)}</div></section>
}

function Shelf({title,items,total,empty,onAdd,onOpen,onEdit}:{title:string;items:LibraryItem[];total:number;empty:string;onAdd:()=>void;onOpen:(item:LibraryItem)=>void;onEdit:(item:LibraryItem)=>void}){
  const[query,setQuery]=useState('');
  const filtered=query.trim()?items.filter(item=>`${item.book.title} ${item.book.author}`.toLowerCase().includes(query.trim().toLowerCase())):items;
  const shelfBooks=filtered.map(item=>({id:item.id,title:item.book.title,author:item.book.author,cover:item.book.coverUrl,width:124,height:190,tilt:0}));
  const tone=title.includes('Favorites')?'plum':'blue';
  return <section className={`profile-shelf acrylic-profile-shelf acrylic-${tone}`}><header><div><h2>{title}</h2><span>{total}</span></div><div className="shelf-header-tools">{(total>8||title==='Currently reading')&&<label className="shelf-search"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={`Search ${title.toLowerCase()}`}/></label>}<button type="button" className="shelf-add" onClick={onAdd}><Plus aria-hidden="true"/> Add</button></div></header>{items.length?(filtered.length?<AcrylicBookshelf books={shelfBooks} width="100%" frontHeight={78} className={`profile-acrylic-object acrylic-${tone}`} onOpen={(_,i)=>onOpen(filtered[i])} onEdit={(_,i)=>onEdit(filtered[i])}/>:<div className="shelf-empty shelf-filter-empty"><p>No books match that search.</p><button type="button" onClick={()=>setQuery('')}>Clear search</button></div>):<div className="shelf-empty"><p>{empty}</p><button type="button" onClick={onAdd}>Find a book</button></div>}</section>
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Heart, Palette, Search, Settings, Star, Sticker as StickerIcon, Upload } from 'lucide-react';
import { useRouter } from '../lib/router';
import { useApp } from '../lib/AppContext';
import { getPersonalLibrary, importGoodreads, updatePersonalBook, updateProfileStyle } from '../lib/data';
import { Modal } from '../components/Modal';
import { StickerBoard, StickerTray } from '../components/StickerBoard';
import { stickerDefaultScale } from '../lib/stickers';
import { readProfileStyleCache, writeProfileStyleCache } from '../lib/profileStyleCache';
import type { ProfileStyle } from '../lib/model';

const YEAR=new Date().getFullYear();
const defaultStyle:ProfileStyle={palette:'rose',layout:'scrapbook',note:'',stickers:[]};
const PROFILE_TARGET_KEY='bookclub:profile-save-target';
type LibraryItem = Awaited<ReturnType<typeof getPersonalLibrary>>[number];

export function ProfilePage(){
  const a=useApp(),{navigate:nav}=useRouter();
  const[items,setItems]=useState<LibraryItem[]>([]);
  const[importing,setImporting]=useState(false);
  const[notice,setNotice]=useState('');
  const[customizeOpen,setCustomizeOpen]=useState(false);
  const[editItem,setEditItem]=useState<LibraryItem|null>(null);
  const[ratingOpen,setRatingOpen]=useState(false);
  const[stickering,setStickering]=useState(false);
  const stickerEditBase=useRef<ProfileStyle|null>(null);
  const[style,setStyle]=useState<ProfileStyle>(a.profile?.style||defaultStyle);
  const[syncError,setSyncError]=useState('');
  const[saving,setSaving]=useState(false);

  async function reload(){if(a.user)setItems(await getPersonalLibrary(a.user.id))}
  useEffect(()=>{void reload()},[a.user?.id]);
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

  const read=items.filter(x=>['read','finished'].includes(x.shelf));
  const want=items.filter(x=>['want_to_read','to-read'].includes(x.shelf));
  const current=items.filter(x=>['currently_reading','currently-reading'].includes(x.shelf));
  const year=read.filter(x=>x.dateFinished?.startsWith(String(YEAR)));
  const rated=read.filter(x=>x.rating);
  const avg=rated.length?(rated.reduce((s,x)=>s+(x.rating||0),0)/rated.length).toFixed(1):'—';
  const favorites=items.filter(x=>x.isFavorite);
  const collage=useMemo(()=>[...favorites,...current,...read,...want].filter((x,i,list)=>list.findIndex(y=>y.book.id===x.book.id)===i).slice(0,5),[items]);

  function findForProfile(shelf='want_to_read',favorite=false){
    sessionStorage.setItem(PROFILE_TARGET_KEY,JSON.stringify({shelf,favorite}));
    nav('/search');
  }

  async function saveStyle(){
    if(!a.user)return;
    const draft=structuredClone(style) as ProfileStyle;
    writeProfileStyleCache(a.user.id,draft,true);a.applyProfileStyle(draft);setCustomizeOpen(false);
    setSaving(true);setNotice('Saving profile design…');setSyncError('');
    try{const persisted=await updateProfileStyle(a.user.id,draft);setStyle(persisted);a.applyProfileStyle(persisted);writeProfileStyleCache(a.user.id,persisted,false);setNotice('Profile design saved.')}catch(err:any){setSyncError(err?.message||'Cloud sync failed.');setNotice('Design saved on this device.')}finally{setSaving(false)}
  }

  function openStickerEditor(){stickerEditBase.current=structuredClone(style);setStickering(true);setNotice('')}
  function cancelStickerEditor(){if(stickerEditBase.current)setStyle(stickerEditBase.current);stickerEditBase.current=null;setStickering(false);setNotice('Sticker changes cancelled.')}
  async function finishStickerEditor(){
    if(!a.user){setStickering(false);return}
    const userId=a.user.id,draft=structuredClone(style) as ProfileStyle;
    writeProfileStyleCache(userId,draft,true);a.applyProfileStyle(draft);stickerEditBase.current=null;setStickering(false);setSaving(true);setNotice('Profile saved. Syncing…');setSyncError('');
    try{
      const persisted=await Promise.race([updateProfileStyle(userId,draft),new Promise<never>((_,reject)=>window.setTimeout(()=>reject(new Error('Cloud sync timed out.')),10000))]);
      setStyle(persisted);a.applyProfileStyle(persisted);writeProfileStyleCache(userId,persisted,false);setNotice('Profile saved.');
    }catch(err:any){setSyncError(err?.message||'Could not sync your sticker layout.');setNotice('Profile saved on this device.')}finally{setSaving(false)}
  }
  async function retryProfileStyleSync(){
    if(!a.user)return;const cached=readProfileStyleCache(a.user.id);const draft=cached?.style||style;setSaving(true);setSyncError('');setNotice('Syncing profile…');
    try{const persisted=await updateProfileStyle(a.user.id,draft);setStyle(persisted);a.applyProfileStyle(persisted);writeProfileStyleCache(a.user.id,persisted,false);setNotice('Profile synced.')}catch(err:any){setSyncError(err?.message||'Cloud sync failed.');setNotice('Profile is still saved on this device.')}finally{setSaving(false)}
  }
  function addSticker(key:string){
    const id=crypto.randomUUID?.()||Math.random().toString(36).slice(2,12);
    setStyle(s=>{const existing=s.stickers||[],offset=(existing.length%5)-2;return {...s,stickers:[...existing,{id,key,x:50+(offset*4),y:34+((existing.length%3)*5),r:(Math.random()*8)-4,s:stickerDefaultScale(key),z:Math.max(0,...existing.map(x=>x.z||0))+1}]}})
  }
  async function patchBook(item:LibraryItem,patch:{shelf?:string;rating?:number|null;dateFinished?:string|null;isFavorite?:boolean}){
    if(!a.user)return;
    try{await updatePersonalBook(a.user.id,item.id,patch);await reload();setNotice(`${item.book.title} updated.`)}catch(err:any){setNotice(err?.message||'Could not update book.')}
  }

  const palette=style.palette||'rose',layout=style.layout||'scrapbook';
  return <div className={`page profile-page profile-${palette} profile-layout-${layout}${stickering?' sticker-edit-mode':''}`}>
    <section className="profile-scrapbook-hero">
      <div className="profile-identity">
        <p>{a.profile?.username?`@${a.profile.username}`:'Your reading profile'}</p>
        <h1>{a.profile?.displayName||'Reader'}</h1>
        {style.note&&<blockquote>{style.note}</blockquote>}
        <div className="profile-hero-actions"><button type="button" className="secondary" onClick={()=>setCustomizeOpen(true)}><Palette/> Customize</button><button type="button" className="secondary" onClick={openStickerEditor}><StickerIcon/> Stickers</button><button type="button" className="icon-button" onClick={()=>nav('/me/settings')} aria-label="Settings"><Settings/></button></div>
      </div>
      <div className="profile-cover-collage" aria-label="A few books from your shelves">{collage.map((x,i)=><figure key={x.book.id} style={{'--i':i} as any}>{x.book.coverUrl?<img src={x.book.coverUrl} alt={`Cover of ${x.book.title}`}/>:<span>{x.book.title}</span>}</figure>)}</div>
      <StickerBoard stickers={style.stickers||[]} editing={stickering} onChange={stickers=>setStyle(s=>({...s,stickers}))}/>
    </section>

    {stickering&&<StickerTray onPick={addSticker} onClose={cancelStickerEditor} onDone={finishStickerEditor} onReset={()=>setStyle(s=>({...s,stickers:[]}))} saving={saving}/>} 

    <section className="profile-overview">
      <div className="profile-number"><b>{read.length}</b><span>Books read</span></div>
      <div className="profile-number"><b>{a.clubs.length}</b><span>Clubs</span></div>
      <button type="button" className="profile-number profile-number-action" onClick={()=>setRatingOpen(true)}><b>{avg}</b><span>Average rating</span><small>Rate a book</small></button>
    </section>

    <Shelf title="Favorites" items={favorites.slice(0,9)} empty="No favorites yet." onAdd={()=>findForProfile('want_to_read',true)} onEdit={setEditItem}/>
    {current.length>0&&<Shelf title="Currently reading" items={current.slice(0,9)} empty="" onAdd={()=>findForProfile('currently_reading')} onEdit={setEditItem}/>} 
    <Shelf title="Books read" items={read.slice(0,12)} empty="No finished books yet." onAdd={()=>findForProfile('read')} onEdit={setEditItem}/>
    <Shelf title="Want to read" items={want.slice(0,12)} empty="Nothing saved yet." onAdd={()=>findForProfile('want_to_read')} onEdit={setEditItem}/>

    <section className="profile-library-actions"><div><h2>Add a book</h2></div><button type="button" className="primary" onClick={()=>findForProfile('want_to_read')}><Search/> Search books <ArrowRight/></button></section>

    <section className="reading-year-new">
      <header><div><p>{YEAR}</p><h2>Your reading year</h2></div><b>{year.length} books</b></header>
      {year.length?<div className="year-strip">{year.slice(0,14).map((x,i)=><figure key={x.id} style={{'--i':i} as any}>{x.book.coverUrl&&<img src={x.book.coverUrl}/>}<figcaption>{x.book.title}</figcaption></figure>)}</div>:<p className="year-empty">Finish a book this year and it’ll start building here.</p>}
      <div className="year-facts"><article><span>5★ books</span><b>{year.filter(x=>x.rating===5).length}</b></article><article><span>Pages tracked</span><b>{year.reduce((s,x)=>s+(x.book.pages||0),0).toLocaleString()}</b></article><article><span>Most recent</span><b>{year[0]?.book.title||'—'}</b></article></div>
    </section>

    {(notice||syncError)&&<div className={`import-notice${syncError?' sync-warning':''}`} role="status"><span>{notice}{syncError&&<> <b>{syncError}</b></>}</span>{syncError&&<button type="button" className="secondary" disabled={saving} onClick={()=>void retryProfileStyleSync()}>{saving?'Syncing…':'Retry cloud sync'}</button>}</div>}

    <section className="import-panel goodreads-helper">
      <div className="goodreads-copy"><span className="goodreads-mark">G</span><div><h2>Bring over your Goodreads shelves</h2><ol><li>Export your Goodreads library as a CSV.</li><li>Choose that file here.</li><li>Your shelves, ratings, and finished dates fill in automatically.</li></ol></div></div>
      <label className="primary import-button"><Upload/>{importing?'Importing…':items.length?'Re-import CSV':'Import Goodreads CSV'}<input type="file" accept=".csv,text/csv" hidden onChange={async e=>{const f=e.target.files?.[0];if(!f||!a.user)return;setImporting(true);try{const n=await importGoodreads(a.user.id,f);setNotice(`${n} Goodreads rows imported`);await reload()}catch(err:any){setNotice(err.message)}finally{setImporting(false);e.currentTarget.value=''}}}/></label>
    </section>

    <Modal open={Boolean(editItem)} onClose={()=>setEditItem(null)} title={editItem?.book.title||'Edit book'}>
      {editItem&&<div className="book-editor">
        <div className="star-rating" aria-label="Rating">{[1,2,3,4,5].map(n=><button type="button" key={n} className={(editItem.rating||0)>=n?'selected':''} onClick={async()=>{await patchBook(editItem,{rating:n});setEditItem({...editItem,rating:n})}}><Star fill={(editItem.rating||0)>=n?'currentColor':'none'}/><span className="sr-only">{n} stars</span></button>)}</div>
        <label>Shelf<select value={editItem.shelf} onChange={async e=>{const shelf=e.target.value;await patchBook(editItem,{shelf});setEditItem({...editItem,shelf})}}><option value="want_to_read">Want to read</option><option value="currently_reading">Currently reading</option><option value="read">Books read</option></select></label>
        <button type="button" className={`favorite-toggle ${editItem.isFavorite?'selected':''}`} onClick={async()=>{const isFavorite=!editItem.isFavorite;await patchBook(editItem,{isFavorite});setEditItem({...editItem,isFavorite})}}><Heart fill={editItem.isFavorite?'currentColor':'none'}/> {editItem.isFavorite?'Favorite':'Add to Favorites'}</button>
      </div>}
    </Modal>

    <Modal open={ratingOpen} onClose={()=>setRatingOpen(false)} title="Rate your books">
      <div className="rating-list">{read.length?read.map(item=><article key={item.id}><div>{item.book.coverUrl&&<img src={item.book.coverUrl}/>}<span><b>{item.book.title}</b><small>{item.book.author}</small></span></div><div className="star-rating">{[1,2,3,4,5].map(n=><button type="button" key={n} className={(item.rating||0)>=n?'selected':''} onClick={()=>patchBook(item,{rating:n})}><Star fill={(item.rating||0)>=n?'currentColor':'none'}/></button>)}</div></article>):<p>Add a finished book first, then rate it here.</p>}</div>
    </Modal>

    <Modal open={customizeOpen} onClose={()=>setCustomizeOpen(false)} title="Design your profile">
      <div className="profile-customizer">
        <h3>Paper + color</h3><div className="palette-choices">{(['rose','olive','gold','plum','blue','paper'] as const).map(x=><button type="button" key={x} aria-label={`Use ${x} palette`} className={`palette-choice ${x} ${style.palette===x?'selected':''}`} onClick={()=>setStyle({...style,palette:x})}><i/><span>{x}</span></button>)}</div>
        <h3>Layout</h3><div className="layout-choices">{(['scrapbook','editorial','clean'] as const).map(x=><button type="button" key={x} className={style.layout===x?'selected':''} onClick={()=>setStyle({...style,layout:x})}><b>{x[0].toUpperCase()+x.slice(1)}</b></button>)}</div>
        <label>Profile note <span>optional</span><input maxLength={90} value={style.note||''} onChange={e=>setStyle({...style,note:e.target.value})}/></label>
        <div className="modal-actions"><button type="button" className="secondary" onClick={()=>setCustomizeOpen(false)}>Cancel</button><button type="button" className="primary" disabled={saving} onClick={saveStyle}>{saving?'Saving…':'Save design'}</button></div>
      </div>
    </Modal>
  </div>
}

function Shelf({title,items,empty,onAdd,onEdit}:{title:string;items:LibraryItem[];empty:string;onAdd:()=>void;onEdit:(item:LibraryItem)=>void}){
  return <section className="profile-shelf"><header><div><h2>{title}</h2><span>{items.length}</span></div><button type="button" className="shelf-add" onClick={onAdd}><span aria-hidden="true">＋</span> Add</button></header>{items.length?<div className="shelf-track"><div className="shelf-books-new">{items.map((item,i)=><button type="button" className="shelf-book-button" key={item.id} style={{'--book-i':i} as any} onClick={()=>onEdit(item)}>{item.book.coverUrl?<img src={item.book.coverUrl} alt={`Cover of ${item.book.title}`}/>:<div className="missing-cover">{item.book.title}</div>}<span>{item.book.title}</span></button>)}</div><div className="shelf-object" aria-hidden="true"><i/><i/></div></div>:<div className="shelf-empty"><p>{empty}</p><button type="button" onClick={onAdd}>Find a book</button></div>}</section>
}

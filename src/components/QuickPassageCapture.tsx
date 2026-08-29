import { useRef, useState } from 'react';
import { Camera, Check, ImagePlus, LoaderCircle, LockKeyhole, MessageCircle, Plus, RotateCcw, X } from 'lucide-react';
import { useApp } from '../lib/AppContext';
import { createThought, savePrivateNote, saveQuote } from '@book-club/data';
import { transcribePassage, type PassageTranscription } from '../lib/api';

const MAX_EDGE=1800;
const JPEG_QUALITY=.9;

type EntryType='thought'|'note'|'question'|'prediction'|'quote';
type Visibility='private'|'club';

async function photoDataUrl(file:File):Promise<string>{
  if(!file.type.startsWith('image/'))throw new Error('Choose a photo of the passage.');
  if(file.size>18*1024*1024)throw new Error('That photo is too large. Try taking it again.');
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise<HTMLImageElement>((resolve,reject)=>{const el=new Image();el.onload=()=>resolve(el);el.onerror=()=>reject(new Error('Could not read that photo.'));el.src=url});
    const scale=Math.min(1,MAX_EDGE/Math.max(img.naturalWidth,img.naturalHeight));
    const width=Math.max(1,Math.round(img.naturalWidth*scale)),height=Math.max(1,Math.round(img.naturalHeight*scale));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Could not prepare that photo.');
    ctx.drawImage(img,0,0,width,height);
    return canvas.toDataURL('image/jpeg',JPEG_QUALITY);
  }finally{URL.revokeObjectURL(url)}
}

function sharedPostType(type:EntryType){
  if(type==='question')return'question';
  if(type==='prediction')return'prediction';
  if(type==='quote')return'quote';
  return'thought';
}

function withPage(body:string,page?:number){return page?`${body}\n\nPage ${page}`:body}

export function QuickPassageCapture(){
  const a=useApp(),w=a.workspace,cb=w?.currentBook;
  const cameraRef=useRef<HTMLInputElement>(null),libraryRef=useRef<HTMLInputElement>(null),composerRef=useRef<HTMLTextAreaElement>(null);
  const[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false);
  const[result,setResult]=useState<PassageTranscription|null>(null),[error,setError]=useState(''),[saved,setSaved]=useState('');
  const[draft,setDraft]=useState(''),[entryType,setEntryType]=useState<EntryType>('thought'),[visibility,setVisibility]=useState<Visibility>('private'),[editingPassage,setEditingPassage]=useState(false);
  if(!a.user||!w||!cb)return null;
  const b=cb.book,currentChapter=w.myProgress?.chapter||undefined,currentPage=w.myProgress?.page||undefined;
  const place=result?.pageNumber?`Page ${result.pageNumber}`:currentPage?`Page ${currentPage}`:result?.chapterNumber?`Chapter ${result.chapterNumber}`:currentChapter?`Chapter ${currentChapter}`:'';

  function reset(){setResult(null);setError('');setBusy(false);setSaving(false);setSaved('');setDraft('');setEntryType('thought');setVisibility('private');setEditingPassage(false)}
  function openComposer(){reset();setOpen(true);requestAnimationFrame(()=>composerRef.current?.focus())}
  function close(){setOpen(false);setTimeout(reset,180)}

  async function pick(file?:File){
    if(!file)return;setBusy(true);setError('');setSaved('');
    try{
      const imageDataUrl=await photoDataUrl(file);
      const next=await transcribePassage({imageDataUrl,title:b.title,author:b.author,currentChapter});
      if(!next.text.trim())throw new Error('I couldn’t find a readable passage in that photo.');
      setResult(next);setEntryType('quote');setEditingPassage(Boolean(next.needsReview));
      requestAnimationFrame(()=>composerRef.current?.focus());
    }catch(err:any){setError(err?.message||'Could not read that passage. Try another photo.')}
    finally{setBusy(false);if(cameraRef.current)cameraRef.current.value='';if(libraryRef.current)libraryRef.current.value=''}
  }

  async function save(){
    if(saving||saved||!a.user||!cb)return;
    const passage=result?.text.trim()||'';
    const thought=draft.trim();
    if(!passage&&!thought){setError('Write a thought or add a passage first.');composerRef.current?.focus();return}
    setSaving(true);setError('');
    const chapter=result?.chapterNumber||currentChapter;
    const page=result?.pageNumber||currentPage;
    try{
      if(passage){
        await saveQuote(cb.id,passage,thought||undefined,chapter,page);
        if(visibility==='club'){
          const body=withPage(thought?`“${passage}”\n\n${thought}`:`“${passage}”`,page);
          await createThought(cb.id,a.user.id,body,chapter,'quote');
        }
      }else{
        await savePrivateNote(cb.id,thought,chapter,page);
        if(visibility==='club')await createThought(cb.id,a.user.id,withPage(thought,page),chapter,sharedPostType(entryType));
      }
      await a.refresh();
      setSaved(visibility==='club'?`Shared with ${w.club.name}`:'Saved privately');
      setTimeout(close,1050);
    }catch(err:any){setError(err?.message||'Could not save this.')}
    finally{setSaving(false)}
  }

  const types:EntryType[]=result?['quote','thought','note','question','prediction']:['thought','note','question','prediction'];

  return <>
    <button className="quick-passage-fab" type="button" onClick={openComposer} aria-label="Quick add a thought, note, question, prediction, or passage"><Plus/><span>Quick add</span></button>
    {open&&<div className="quick-passage-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}>
      <section className="quick-passage-sheet" role="dialog" aria-modal="true" aria-labelledby="quick-passage-title">
        <header><div><span className="quick-passage-kicker">Quick add · {b.title}{place?` · ${place}`:''}</span><h2 id="quick-passage-title">What do you want to remember?</h2></div><button type="button" className="quick-passage-close" onClick={close} aria-label="Close"><X/></button></header>

        <div className="quick-passage-composer">
          {result&&<section className="quick-passage-extract" aria-label="Captured passage">
            <div className="quick-passage-section-label"><span>Passage</span><button type="button" onClick={()=>setEditingPassage(v=>!v)}>{editingPassage?'Done editing':'Edit transcription'}</button></div>
            {editingPassage?<textarea aria-label="Extracted passage" value={result.text} onChange={e=>setResult({...result,text:e.target.value})}/>:<blockquote>{result.text}</blockquote>}
            <small>{[result.chapterNumber?`Chapter ${result.chapterNumber}`:currentChapter?`Chapter ${currentChapter}`:null,result.pageNumber?`Page ${result.pageNumber}`:currentPage?`Page ${currentPage}`:null].filter(Boolean).join(' · ')||'Captured from page'}{result.needsReview?' · Check transcription':''}</small>
          </section>}

          <label className="quick-passage-draft">
            <span>{result?'Your thought':'Quick thought'}</span>
            <textarea ref={composerRef} value={draft} onChange={e=>setDraft(e.target.value)} placeholder={result?'Why did this part matter? Add context if you want.':'Type the thought before you lose it…'} autoFocus/>
          </label>

          <fieldset className="quick-passage-types"><legend>Save as</legend><div>{types.map(type=><button key={type} type="button" className={entryType===type?'selected':''} aria-pressed={entryType===type} onClick={()=>setEntryType(type)}>{type[0].toUpperCase()+type.slice(1)}</button>)}</div></fieldset>

          <fieldset className="quick-passage-visibility"><legend>Visibility</legend><div>
            <button type="button" className={visibility==='private'?'selected':''} aria-pressed={visibility==='private'} onClick={()=>setVisibility('private')}><LockKeyhole/><span><b>Private</b><small>Only you can see this in Your margins.</small></span>{visibility==='private'&&<Check/>}</button>
            <button type="button" className={visibility==='club'?'selected':''} aria-pressed={visibility==='club'} onClick={()=>setVisibility('club')}><MessageCircle/><span><b>Share with club</b><small>Visible to {w.club.name} and available for discussion and Meeting Room.</small></span>{visibility==='club'&&<Check/>}</button>
          </div></fieldset>

          <section className="quick-passage-add-page"><div><span>Add from the page</span><small>Optional · the photo is only used to read the text.</small></div><div><button type="button" onClick={()=>cameraRef.current?.click()} disabled={busy}><Camera/> Take photo</button><button type="button" onClick={()=>libraryRef.current?.click()} disabled={busy}><ImagePlus/> Choose photo</button></div></section>

          {busy&&<div className="quick-passage-processing" role="status"><LoaderCircle/><div><b>Reading the page…</b><small>Pulling out the passage and any visible page or chapter number.</small></div></div>}
          {error&&<p className="quick-passage-error" role="alert">{error}</p>}
          {saved&&<p className="quick-passage-saved" role="status"><Check/> {saved}</p>}
        </div>

        <footer className="quick-passage-footer">{result?<button type="button" className="quick-passage-reset" onClick={()=>{setResult(null);setEntryType('thought');setEditingPassage(false);cameraRef.current?.click()}} disabled={busy||saving}><RotateCcw/> Scan another page</button>:<span/>}<button type="button" className="quick-passage-save" onClick={save} disabled={busy||saving||Boolean(saved)||(!draft.trim()&&!result?.text.trim())}>{saved?<><Check/> {saved}</>:saving?<><LoaderCircle/> Saving…</>:visibility==='club'?'Save & share':'Save privately'}</button></footer>

        <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={e=>void pick(e.target.files?.[0])}/>
        <input ref={libraryRef} hidden type="file" accept="image/*" onChange={e=>void pick(e.target.files?.[0])}/>
      </section>
    </div>}
  </>;
}

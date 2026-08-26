import { useRef, useState } from 'react';
import { Camera, Check, ImagePlus, LoaderCircle, MessageCircle, RotateCcw, ScanText, X } from 'lucide-react';
import { useApp } from '../lib/AppContext';
import { createThought } from '../lib/data';
import { transcribePassage, type PassageTranscription } from '../lib/api';

const MAX_EDGE=1800;
const JPEG_QUALITY=.9;

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

export function QuickPassageCapture(){
  const a=useApp(),w=a.workspace,cb=w?.currentBook;
  const cameraRef=useRef<HTMLInputElement>(null),libraryRef=useRef<HTMLInputElement>(null);
  const[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false);
  const[result,setResult]=useState<PassageTranscription|null>(null),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  const[note,setNote]=useState('');
  if(!a.user||!w||!cb)return null;
  const b=cb.book,currentChapter=w.myProgress?.chapter||undefined;

  function reset(){setResult(null);setError('');setBusy(false);setSaving(false);setSaved(false);setNote('')}
  function close(){setOpen(false);setTimeout(reset,180)}
  async function saveExtracted(next:PassageTranscription){
    if(!next.text.trim()||!a.user||!cb)return;setSaving(true);setError('');
    try{
      const chapter=next.chapterNumber||currentChapter;
      const body=note.trim()?`"${next.text.trim()}"\n\nWhy I saved it: ${note.trim()}`:next.text.trim();
      await createThought(cb.id,a.user.id,body,chapter,'thought');
      await a.refresh();setSaved(true);setTimeout(close,900);
    }catch(err:any){setError(err?.message||'Could not save this passage.')}
    finally{setSaving(false)}
  }
  async function pick(file?:File){
    if(!file)return;setBusy(true);setError('');setResult(null);setSaved(false);
    try{
      const imageDataUrl=await photoDataUrl(file);
      const next=await transcribePassage({imageDataUrl,title:b.title,author:b.author,currentChapter});
      if(!next.text.trim())throw new Error('I couldn’t find a readable passage in that photo.');
      setResult(next);setBusy(false);
      if(!next.needsReview)await saveExtracted(next);
    }catch(err:any){setError(err?.message||'Could not read that passage. Try another photo.')}
    finally{setBusy(false);if(cameraRef.current)cameraRef.current.value='';if(libraryRef.current)libraryRef.current.value=''}
  }
  async function save(){if(result)await saveExtracted(result)}

  return <>
    <button className="quick-passage-fab" type="button" onClick={()=>{reset();setOpen(true)}} aria-label="Quick add a passage"><Camera/><span>Quick add</span></button>
    {open&&<div className="quick-passage-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}>
      <section className="quick-passage-sheet" role="dialog" aria-modal="true" aria-labelledby="quick-passage-title">
        <header><div><span className="quick-passage-kicker">{b.title}</span><h2 id="quick-passage-title">Save this part.</h2></div><button type="button" className="quick-passage-close" onClick={close} aria-label="Close"><X/></button></header>
        {!result&&!busy&&<div className="quick-passage-start">
          <div className="quick-passage-icon"><ScanText/></div>
          <p>Take a photo of the passage. We’ll pull out the text and save it to your club discussion.</p>
          <button className="quick-passage-camera" type="button" onClick={()=>cameraRef.current?.click()}><Camera/> Take photo</button>
          <button className="quick-passage-library" type="button" onClick={()=>libraryRef.current?.click()}><ImagePlus/> Choose photo</button>
          <small>The photo is used to read the passage and isn’t saved to your club.</small>
        </div>}
        {busy&&<div className="quick-passage-processing"><LoaderCircle/><h3>Reading the page…</h3><p>Finding the passage, page number, and chapter if they’re visible.</p></div>}
        {result&&!busy&&<div className="quick-passage-result">
          <div className="quick-passage-result-head"><div><span>{saved?'Saved to discussion':'Ready to discuss'}</span><b>{[result.chapterNumber?`Chapter ${result.chapterNumber}`:currentChapter?`Chapter ${currentChapter}`:null,result.pageNumber?`p. ${result.pageNumber}`:null].filter(Boolean).join(' · ')||'Passage'}</b></div>{result.needsReview&&<em>Photo was hard to read</em>}</div>
          {result.needsReview?<textarea aria-label="Extracted passage" value={result.text} onChange={e=>setResult({...result,text:e.target.value})}/>:<blockquote>{result.text}</blockquote>}
          <label className="quick-passage-note">
            <span>Why save this? <i>optional</i></span>
            <textarea aria-label="Why save this passage" value={note} onChange={e=>setNote(e.target.value)} placeholder="Add a quick note so you remember why this part mattered."/>
          </label>
          <div className="quick-passage-actions"><button type="button" className="quick-passage-retake" onClick={()=>{setResult(null);setError('');cameraRef.current?.click()}}><RotateCcw/> Retake</button><button type="button" className="quick-passage-save" onClick={save} disabled={saving||saved}>{saved?<><Check/> Saved</>:saving?<><LoaderCircle/> Saving…</>:<><MessageCircle/> Save for discussion</>}</button></div>
          {!result.needsReview&&!saved&&<small className="quick-passage-confidence">Text looks clear, so it saves automatically. You can still edit before it finishes saving.</small>}
          {!result.needsReview&&<button type="button" className="quick-passage-edit" onClick={()=>setResult({...result,needsReview:true})}>Edit transcription</button>}
        </div>}
        {error&&<p className="quick-passage-error">{error}</p>}
        <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={e=>void pick(e.target.files?.[0])}/>
        <input ref={libraryRef} hidden type="file" accept="image/*" onChange={e=>void pick(e.target.files?.[0])}/>
      </section>
    </div>}
  </>;
}

import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import { Camera, FileText, Minus, Plus, Search, Upload } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { DateTimePicker } from '../../components/DateTimePicker';
import type { ReadingProgressMode } from './types';

export function ReadingProgressModal({
  open,onClose,progressMode,setProgressMode,effectiveTotalChapters,totalPages,editChapter,setEditChapter,editPage,setEditPage,progressBusy,onSave,
}:{
  open:boolean;onClose:()=>void;progressMode:ReadingProgressMode;setProgressMode:Dispatch<SetStateAction<ReadingProgressMode>>;effectiveTotalChapters:number;totalPages:number;editChapter:number;setEditChapter:Dispatch<SetStateAction<number>>;editPage:number;setEditPage:Dispatch<SetStateAction<number>>;progressBusy:boolean;onSave:()=>void;
}){
  return <Modal open={open} onClose={onClose} title="Update reading progress" className="reading-progress-sheet">
    <div className="reading-progress-editor">
      <div className="progress-mode-switch">{(['chapter','page'] as ReadingProgressMode[]).map(x=><button type="button" key={x} aria-pressed={progressMode===x} className={progressMode===x?'selected':''} onClick={()=>setProgressMode(x)}>{x[0].toUpperCase()+x.slice(1)}</button>)}</div>
      {progressMode==='chapter'?<div className="progress-number-control"><div className="progress-control-heading"><span>Chapter</span>{effectiveTotalChapters?<small>of {effectiveTotalChapters} · {Math.round((Math.min(editChapter,effectiveTotalChapters)/effectiveTotalChapters)*100)}%</small>:<small>Enter the chapter you’re on</small>}</div><div className="progress-stepper"><button type="button" aria-label="Previous chapter" onClick={()=>setEditChapter(v=>Math.max(0,v-1))}><Minus/></button><input aria-label="Chapter progress" type="number" min="0" max={effectiveTotalChapters||undefined} value={editChapter} onChange={e=>setEditChapter(Math.max(0,Math.min(effectiveTotalChapters||9999,Number(e.target.value)||0)))}/><button type="button" aria-label="Next chapter" onClick={()=>setEditChapter(v=>Math.min(effectiveTotalChapters||9999,v+1))}><Plus/></button></div>{effectiveTotalChapters?<input aria-label="Chapter progress slider" className="progress-slider" type="range" min="0" max={effectiveTotalChapters} value={Math.min(editChapter,effectiveTotalChapters)} style={{'--progress-preview':`${Math.round((Math.min(editChapter,effectiveTotalChapters)/effectiveTotalChapters)*100)}%`} as CSSProperties} onChange={e=>setEditChapter(Number(e.target.value))}/>:null}</div>:<div className="progress-number-control"><div className="progress-control-heading"><span>Page</span>{totalPages?<small>of {totalPages} · {Math.round((Math.min(editPage,totalPages)/totalPages)*100)}%</small>:<small>Enter your page</small>}</div><div className="progress-stepper"><button type="button" aria-label="Previous page" onClick={()=>setEditPage(v=>Math.max(0,v-5))}><Minus/></button><input aria-label="Page progress" type="number" min="0" max={totalPages||undefined} value={editPage} onChange={e=>setEditPage(Math.max(0,Math.min(totalPages||99999,Number(e.target.value)||0)))}/><button type="button" aria-label="Next page" onClick={()=>setEditPage(v=>Math.min(totalPages||99999,v+5))}><Plus/></button></div>{totalPages?<input aria-label="Page progress slider" className="progress-slider" type="range" min="0" max={totalPages} value={Math.min(editPage,totalPages)} style={{'--progress-preview':`${Math.round((Math.min(editPage,totalPages)/totalPages)*100)}%`} as CSSProperties} onChange={e=>setEditPage(Number(e.target.value))}/>:null}</div>}
      <button type="button" className="primary full reading-progress-save" disabled={progressBusy} onClick={onSave}>{progressBusy?'Saving…':'Save progress'}</button>
    </div>
  </Modal>;
}

export function MarginEditorModal({
  marginType,onClose,ocrBusy,onCaptureFile,onScreenshot,marginBody,setMarginBody,marginNote,setMarginNote,marginPage,setMarginPage,marginBusy,onSave,
}:{
  marginType:'note'|'quote'|null;onClose:()=>void;ocrBusy:boolean;onCaptureFile:(file?:File)=>void;onScreenshot:()=>void;marginBody:string;setMarginBody:Dispatch<SetStateAction<string>>;marginNote:string;setMarginNote:Dispatch<SetStateAction<string>>;marginPage:number|undefined;setMarginPage:Dispatch<SetStateAction<number|undefined>>;marginBusy:boolean;onSave:()=>void;
}){
  return <Modal open={Boolean(marginType)} onClose={onClose} title={marginType==='quote'?'Save a quote':'Add a private note'}>
    <div className="margin-editor"><div className="margin-capture-actions"><label><Upload/> {ocrBusy?'Reading…':'Upload'}<input type="file" accept="image/*,.txt,text/plain" hidden onChange={e=>onCaptureFile(e.target.files?.[0])}/></label><label><Camera/> {ocrBusy?'Reading…':'Photo'}<input type="file" accept="image/*" capture="environment" hidden onChange={e=>onCaptureFile(e.target.files?.[0])}/></label><button type="button" onClick={onScreenshot}><FileText/> Screenshot</button></div><label>{marginType==='quote'?'Quote':'Note'}<textarea value={marginBody} onChange={e=>setMarginBody(e.target.value)} autoFocus placeholder={ocrBusy?'Reading the page…':'Add your text here, or pull it in from a photo.'}/></label>{marginType==='quote'&&<label>Why save it? <span>optional</span><input value={marginNote} onChange={e=>setMarginNote(e.target.value)}/></label>}<div className="margin-editor-row"><label>Page <span>optional</span><input type="number" min="1" value={marginPage||''} onChange={e=>setMarginPage(Number(e.target.value)||undefined)}/></label><button type="button" className="primary" disabled={marginBusy||ocrBusy||!marginBody.trim()} onClick={onSave}>{marginBusy?'Saving…':'Save'}</button></div></div>
  </Modal>;
}

export function QuickReferenceModal({open,onClose,referenceQuery,setReferenceQuery,referenceMatches}:{open:boolean;onClose:()=>void;referenceQuery:string;setReferenceQuery:Dispatch<SetStateAction<string>>;referenceMatches:any[]}){
  return <Modal open={open} onClose={onClose} title="Quick reference">
    <div className="quick-reference"><div className="search-field"><Search/><input autoFocus value={referenceQuery} onChange={e=>setReferenceQuery(e.target.value)} placeholder="Character, place, term…"/></div>{referenceQuery.trim()&&!referenceMatches.length?<div className="context-empty compact"><h3>Not available yet.</h3></div>:<div className="reference-results">{referenceMatches.map((x:any)=><article key={`${x.kind}-${x.title}`}><small>{x.kind}</small><h3>{x.title}</h3><p>{x.summary_short||x.summary_medium}</p></article>)}</div>}</div>
  </Modal>;
}

export function MeetingVoteModal({open,onClose,checkpointVoteLabel,pollOptions,setPollOptions,voteBusy,onSave}:{open:boolean;onClose:()=>void;checkpointVoteLabel:string;pollOptions:string[];setPollOptions:Dispatch<SetStateAction<string[]>>;voteBusy:boolean;onSave:()=>void}){
  return <Modal open={open} onClose={onClose} title="Vote on a time" className="checkpoint-vote-dialog">
    <div className="meeting-poll-editor">
      <p className="checkpoint-vote-label">{checkpointVoteLabel||'Pick two or three realistic times for this checkpoint discussion.'}</p>
      {pollOptions.map((value,i)=><label className="picker-field" key={i}><span>Option {i+1}</span><DateTimePicker includeTime ariaLabel={`Meeting option ${i+1}`} value={value} onChange={next=>setPollOptions(v=>v.map((x,j)=>j===i?next:x))}/></label>)}
      <div className="poll-editor-actions">
        <button type="button" className="quiet-action" disabled={pollOptions.length>=5} onClick={()=>setPollOptions(v=>[...v,''])}>Add another time</button>
        {pollOptions.length>2&&<button type="button" className="quiet-action" onClick={()=>setPollOptions(v=>v.slice(0,-1))}>Remove last</button>}
      </div>
      <button type="button" className="primary full" disabled={voteBusy||pollOptions.filter(Boolean).length<2} onClick={onSave}>{voteBusy?'Saving…':'Ask the group'}</button>
    </div>
  </Modal>;
}

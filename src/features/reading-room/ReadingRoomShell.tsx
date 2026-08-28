import { ArrowLeft, Share2 } from 'lucide-react';
import { BookCover } from '../../components/BookCover';
import type { Book } from '../../lib/model';
import type { ReadingRoomTab } from './types';

export function ReadingRoomHero({
  clubName,book,readingPlace,readingPct,sharePending,onBack,onShare,onOpenProgress,
}:{
  clubName:string;book:Book;readingPlace:string;readingPct:number;sharePending:boolean;onBack:()=>void;onShare:()=>void;onOpenProgress:()=>void;
}){
  return <>
    <header className="reading-top"><button className="back-link" onClick={onBack}><ArrowLeft/> {clubName}</button><button className="icon-button" onClick={onShare} disabled={sharePending} aria-busy={sharePending} aria-label="Share reading room"><Share2/></button></header>
    <section className="reading-cover-story"><div className="reading-copy"><p className="reading-club-label">{clubName} · current book</p><h1>{book.title}</h1><h2>{book.author}</h2><button type="button" className="position reading-position-control" onClick={onOpenProgress} aria-haspopup="dialog"><span className="position-copy"><span>Your place</span><b>{readingPlace} <span aria-hidden="true">⌄</span></b></span><i role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(readingPct)}><em style={{width:`${readingPct}%`}}/><u style={{left:`${readingPct}%`}}/></i></button></div><div className="reading-art"><BookCover className="main-cover" title={book.title} author={book.author} src={book.coverUrl}/></div></section>
  </>;
}

export function ReadingRoomTabs({tab,onChange}:{tab:ReadingRoomTab;onChange:(tab:ReadingRoomTab)=>void}){
  return <nav className="reading-tabs" aria-label="Reading room">{(['calendar','discussion','context','notes'] as const).map(x=><button className={tab===x?'active':''} onClick={()=>onChange(x)} key={x}>{x==='context'?'Context':x==='calendar'?'Reading plan':x==='notes'?'My notes':'Discussion'}</button>)}</nav>;
}

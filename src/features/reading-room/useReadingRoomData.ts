import { useCallback, useEffect, useState } from 'react';
import { getBookContext, getMargins } from '@book-club/data';
import { getReaderContext } from '../../lib/api';
import { getKnownChapterCount } from '../../lib/books';
import type { Book, MarginItem } from '../../lib/model';
import { coverAccent } from './readingRoomUtils';

export function useDetectedChapterCount(currentBookId:string,totalChapters:number,book:Book){
  const[detectedChapters,setDetectedChapters]=useState(0);
  useEffect(()=>{
    let cancelled=false;
    setDetectedChapters(0);
    if(totalChapters)return()=>{cancelled=true};
    void getKnownChapterCount({title:book.title,author:book.author,isbn:book.isbn}).then(count=>{if(!cancelled&&count)setDetectedChapters(count)});
    return()=>{cancelled=true};
  },[currentBookId,totalChapters,book.title,book.author,book.isbn]);
  return detectedChapters;
}

export function useRoomAccent(book:Book){
  const[roomAccent,setRoomAccent]=useState({accent:'#6f6652',soft:'#f1eadc',rgb:'111,102,82'});
  useEffect(()=>{
    let cancelled=false;
    void coverAccent(book.coverUrl||'',`${book.title} ${book.author}`).then(next=>{if(!cancelled)setRoomAccent(next)});
    return()=>{cancelled=true};
  },[book.coverUrl,book.title,book.author]);
  return roomAccent;
}

export function useReaderContextData(book:Book,chapter:number){
  const[context,setContext]=useState<any[]>([]);
  const[contextLoading,setContextLoading]=useState(false);
  const[contextError,setContextError]=useState('');
  useEffect(()=>{
    let cancelled=false;
    setContextLoading(true);setContextError('');
    (async()=>{
      try{
        const cached=await getBookContext(book.id,chapter);
        if(cancelled)return;
        if(cached.length){setContext(cached);return}
        const generated=await getReaderContext({bookId:book.id,title:book.title,author:book.author,year:book.year,chapter});
        if(!cancelled)setContext(generated);
      }catch(err:any){if(!cancelled)setContextError(err?.message||'Could not load context.')}
      finally{if(!cancelled)setContextLoading(false)}
    })();
    return()=>{cancelled=true};
  },[book.id,book.title,book.author,book.year,chapter]);
  return {context,contextLoading,contextError};
}

export function useMarginsData(currentBookId:string,userId:string|undefined,onError:(message:string)=>void){
  const[margins,setMargins]=useState<MarginItem[]>([]);
  const reloadMargins=useCallback(async()=>{
    if(!userId)return;
    try{setMargins(await getMargins(currentBookId,userId))}
    catch(err:any){onError(err?.message||'Could not load your margins.')}
  },[currentBookId,userId,onError]);
  useEffect(()=>{void reloadMargins()},[reloadMargins]);
  return {margins,reloadMargins};
}

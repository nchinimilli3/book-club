import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { resolveBookCover } from '../lib/api';

type Props={
  title:string;
  author?:string;
  src?:string;
  alt?:string;
  className?:string;
  loading?:'eager'|'lazy';
};

function initials(title:string){
  return title.split(/\s+/).filter(Boolean).slice(0,3).map(x=>x[0]?.toUpperCase()).join('');
}

export function BookCover({title,author,src,alt,className='',loading='lazy'}:Props){
  const [currentSrc,setCurrentSrc]=useState(src);
  const [failed,setFailed]=useState(false);
  const [retried,setRetried]=useState(false);
  if(currentSrc&&!failed)return <img className={className} loading={loading} src={currentSrc} alt={alt||`Cover of ${title}`} onError={async()=>{
    if(!retried){setRetried(true);const resolved=await resolveBookCover({title,author:author||'' ,currentCover:currentSrc});if(resolved?.url){setCurrentSrc(resolved.url);setFailed(false);return;}}
    setFailed(true);
  }}/>;
  return <div className={`typographic-cover ${className}`.trim()} role="img" aria-label={alt||`Cover placeholder for ${title}`}>
    <span>{initials(title)||<BookOpen/>}</span>
    <b>{title}</b>
    {author&&<small>{author}</small>}
  </div>;
}

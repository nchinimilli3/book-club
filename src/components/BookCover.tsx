import { BookOpen } from 'lucide-react';

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
  if(src)return <img className={className} loading={loading} src={src} alt={alt||`Cover of ${title}`}/>;
  return <div className={`typographic-cover ${className}`.trim()} role="img" aria-label={alt||`Cover placeholder for ${title}`}>
    <span>{initials(title)||<BookOpen/>}</span>
    <b>{title}</b>
    {author&&<small>{author}</small>}
  </div>;
}

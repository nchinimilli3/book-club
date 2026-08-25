import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import type { CatalogBook } from '../lib/catalog';
import { BookCover } from './BookCover';
import { BookSkeleton } from './Skeleton';
import { PageState } from './PageState';

export function BookRail({title,books,loading=false,meta,onOpen,onAdd,renderOverlay,emptyMessage='Nothing to show yet.'}:{title:string;books:CatalogBook[];loading?:boolean;meta?:(book:CatalogBook)=>string|undefined;onOpen:(book:CatalogBook)=>void;onAdd?:(book:CatalogBook)=>void;renderOverlay?:(book:CatalogBook)=>ReactNode;emptyMessage?:string}){
  return <section className="discovery-section production-book-rail" aria-labelledby={`rail-${slug(title)}`} aria-busy={loading}>
    <header><h2 id={`rail-${slug(title)}`}>{title}</h2></header>
    {loading?<BookSkeleton count={6}/>:books.length===0?<PageState title={emptyMessage} compact/>:<div className="discovery-rail" role="list">
      {books.map(book=><article className="discovery-book" key={book.key} role="listitem">
        <button type="button" className="discovery-book-open" onClick={()=>onOpen(book)} aria-label={`Open ${book.title} by ${book.author}`}>
          <BookCover title={book.title} author={book.author} src={book.cover}/>
          <strong>{book.title}</strong><span>{book.author}</span>{meta?.(book)&&<small>{meta(book)}</small>}
        </button>
        {onAdd&&<button type="button" className="discovery-add" onClick={()=>onAdd(book)} aria-label={`Add ${book.title}`}><Plus/> Add</button>}
        {renderOverlay?.(book)}
      </article>)}
    </div>}
  </section>;
}
function slug(value:string){return value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}

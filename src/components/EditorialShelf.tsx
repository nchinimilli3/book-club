import type { Book } from '../data/demo';
import { BookCover } from './BookCover';
export function EditorialShelf({title, books, tone='pink', onBook, onSeeAll}:{title:string;books:Book[];tone?:'pink'|'blue'|'olive'|'butter';onBook?:(b:Book)=>void;onSeeAll?:()=>void}){
 return <section className="editorial-shelf"><div className="section-row"><h3>{title}</h3><button className="text-btn shelf-see-all" onClick={onSeeAll}>See all</button></div><div className="shelf-stage">
  <div className="shelf-books">{books.map(b=><BookCover key={b.id} book={b} onClick={()=>onBook?.(b)}/>)}</div>
  <div className={`shelf-plank ${tone}`} aria-hidden="true"><span/><span/></div>
 </div></section>
}

import type { Book } from '../data/demo';

export function BookCover({book, onClick, active=false}:{book:Book; onClick?:()=>void; active?:boolean}) {
  return <button className={`book-cover ${active?'is-active':''}`} onClick={onClick} aria-label={`${book.title} by ${book.author}`}>
    <img src={book.cover} alt={`${book.title} cover`} loading="lazy" />
  </button>
}

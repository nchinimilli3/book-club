import type { CSSProperties, KeyboardEvent } from 'react';
import './acrylic-bookshelf.css';

type AcrylicBook={
  id?:string;
  title?:string;
  author?:string;
  cover?:string;
  width?:number;
  height?:number;
  tilt?:number;
  color?:string;
};

type ShelfStyle=CSSProperties & Record<'--shelf-width'|'--front-height',string>;
type BookStyle=CSSProperties & Record<'--book-width'|'--book-height'|'--book-tilt'|'--book-color',string>;

export default function AcrylicBookshelf({
  books = [],
  width = 'min(860px, 86vw)',
  frontHeight = 86,
  className = '',
  onOpen,
  onEdit,
}: {
  books?:AcrylicBook[];
  width?:string;
  frontHeight?:number;
  className?:string;
  onOpen?:(book:AcrylicBook,index:number)=>void;
  onEdit?:(book:AcrylicBook,index:number)=>void;
}) {
  function keyboardOpen(e:KeyboardEvent<HTMLDivElement>,book:AcrylicBook,index:number){
    if(!onOpen)return;
    if(e.key==='Enter'||e.key===' '){e.preventDefault();onOpen(book,index)}
  }
  return (
    <div
      className={`acrylicShelfWrap ${className}`}
      style={{ '--shelf-width': width, '--front-height': `${frontHeight}px` } as ShelfStyle}
    >
      <div className="acrylicWallShadow" />

      <div
        className="acrylicShelf"
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 100;
          e.currentTarget.style.setProperty('--shine-x', `${x}%`);
        }}
        onPointerLeave={(e) => {
          e.currentTarget.style.setProperty('--shine-x', '72%');
        }}
      >
        <div className="acrylicBack" />

        <div className="acrylicBooks">
          {books.map((book, index) => (
            <div
              className={`acrylicBook${onOpen?' acrylicBookInteractive':''}`}
              key={book.id ?? `${book.title}-${index}`}
              style={{
                '--book-width': `${book.width ?? 104}px`,
                '--book-height': `${book.height ?? 145}px`,
                '--book-tilt': `${book.tilt ?? 0}deg`,
                '--book-color': book.color ?? '#d8d6d0',
              } as BookStyle}
              role={onOpen?'button':undefined}
              tabIndex={onOpen?0:undefined}
              aria-label={onOpen?`Open ${book.title||'book'}`:undefined}
              onClick={()=>onOpen?.(book,index)}
              onKeyDown={e=>keyboardOpen(e,book,index)}
            >
              {book.cover && <img src={book.cover} alt={book.title ?? ''} onError={e=>{e.currentTarget.style.display='none';e.currentTarget.nextElementSibling?.removeAttribute('hidden')}} />}
              <div className="acrylicBookFallback" hidden={Boolean(book.cover)}>
                <strong>{book.title}</strong>
                {book.author && <span>{book.author}</span>}
              </div>
              {onEdit&&<button type="button" className="acrylicBookEdit" aria-label={`Edit ${book.title||'book'}`} onClick={e=>{e.stopPropagation();onEdit(book,index)}}>•••</button>}
            </div>
          ))}
        </div>

        <div className="acrylicFront" />
        <div className="acrylicBase" />
        <div className="acrylicBottomEdge" />
        <div className="acrylicSide acrylicSideLeft" />
        <div className="acrylicSide acrylicSideRight" />
        <div className="acrylicMount acrylicMountLeft" />
        <div className="acrylicMount acrylicMountRight" />
      </div>
    </div>
  );
}

export function BookSkeleton({count=4}:{count?:number}){
  return <div className="skeleton-books" aria-label="Loading books">{Array.from({length:count},(_,i)=><div className="skeleton-book" key={i}><i/><span/><small/></div>)}</div>;
}

export function DiscussionSkeleton(){
  return <div className="skeleton-discussion" aria-label="Loading discussion">{Array.from({length:3},(_,i)=><div key={i}><i/><span/><span/></div>)}</div>;
}

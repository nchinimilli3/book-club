export function BootScreen({message,fullViewport=false}:{message:string;fullViewport?:boolean}){
  return <div className={`boot boot-loading${fullViewport?' boot-full':''}`} role="status" aria-live="polite">
    <div className="boot-bookshelf" aria-hidden="true"><i/><i/><i/><span/></div>
    <b>BOOK CLUB</b><p>Finding your next chapter</p><span>{message}</span>
    <div className="boot-progress" aria-hidden="true"><i/><i/><i/></div>
  </div>;
}

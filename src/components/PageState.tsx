import { useEffect, useState, type ReactNode } from 'react';

export function PageState({title,body,action,kind='empty',compact=false}:{title:string;body?:ReactNode;action?:ReactNode;kind?:'empty'|'error'|'loading';compact?:boolean}){
  return <div className={`empty-state${compact?' compact-empty':''} production-state production-state-${kind}`} role={kind==='error'?'alert':kind==='loading'?'status':undefined} aria-live={kind==='loading'?'polite':undefined}>
    <h2>{title}</h2>
    {body&&<div className="production-state-body">{body}</div>}
    {action&&<div className="production-state-action">{action}</div>}
  </div>;
}

export function FeedbackMessage({children,kind='success',className=''}:{children:ReactNode;kind?:'success'|'error'|'info';className?:string}){
  // A few legacy callers still pass a plain string instead of a typed notice.
  // Keep those failure messages actionable until dismissed while new callers can
  // opt into the explicit `kind` contract.
  const text=typeof children==='string'?children:'';
  const resolvedKind=kind==='success'&&/^(could not|something went wrong|only |add at least|choose |that image|unable |sign-in |calendar connection)/i.test(text)?'error':kind;
  const [visible,setVisible]=useState(true);
  useEffect(()=>{
    setVisible(true);
    if(resolvedKind==='error') return;
    const timer=window.setTimeout(()=>setVisible(false),3000);
    return()=>window.clearTimeout(timer);
  },[children,resolvedKind]);
  if(!visible)return null;
  return <div className={`save-notice production-feedback production-feedback-${resolvedKind} ${className}`.trim()} role={resolvedKind==='error'?'alert':'status'} aria-live={resolvedKind==='error'?'assertive':'polite'}>{children}{resolvedKind==='error'&&<button type="button" className="dismiss-notice" aria-label="Dismiss message" onClick={()=>setVisible(false)}>×</button>}</div>;
}

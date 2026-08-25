import type { ReactNode } from 'react';

export function PageState({title,body,action,kind='empty',compact=false}:{title:string;body?:ReactNode;action?:ReactNode;kind?:'empty'|'error'|'loading';compact?:boolean}){
  return <div className={`empty-state${compact?' compact-empty':''} production-state production-state-${kind}`} role={kind==='error'?'alert':kind==='loading'?'status':undefined} aria-live={kind==='loading'?'polite':undefined}>
    <h2>{title}</h2>
    {body&&<div className="production-state-body">{body}</div>}
    {action&&<div className="production-state-action">{action}</div>}
  </div>;
}

export function FeedbackMessage({children,kind='success',className=''}:{children:ReactNode;kind?:'success'|'error'|'info';className?:string}){
  return <div className={`save-notice production-feedback production-feedback-${kind} ${className}`.trim()} role={kind==='error'?'alert':'status'} aria-live={kind==='error'?'assertive':'polite'}>{children}</div>;
}

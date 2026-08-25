import React from 'react';
import { PageState } from './PageState';

export class AppErrorBoundary extends React.Component<{children:React.ReactNode},{error:Error|null}>{
  state:{error:Error|null}={error:null};
  static getDerivedStateFromError(error:Error){return {error}}
  componentDidCatch(error:Error,info:React.ErrorInfo){console.error('App render error',error,info)}
  render(){
    if(this.state.error)return <main className="page"><PageState kind="error" title="This page hit a snag." body="Your data is safe. Reload the page and try again." action={<button className="primary" onClick={()=>location.reload()}>Reload</button>}/></main>;
    return this.props.children;
  }
}

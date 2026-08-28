import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthGate } from './components/AuthGate';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { installGlobalErrorReporting } from './lib/telemetry';
import './styles/index.css';

installGlobalErrorReporting();
if(import.meta.env.PROD && 'serviceWorker' in navigator){
  window.addEventListener('load',()=>{void navigator.serviceWorker.register('/sw.js').catch(()=>{})});
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><AppErrorBoundary><AuthGate><App/></AuthGate></AppErrorBoundary></React.StrictMode>
);

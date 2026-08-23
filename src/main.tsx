import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthGate } from './components/AuthGate';
import { installGlobalErrorReporting } from './lib/telemetry';
import './styles/global.css';

installGlobalErrorReporting();
if(import.meta.env.PROD && 'serviceWorker' in navigator){
  window.addEventListener('load',()=>{void navigator.serviceWorker.register('/sw.js').catch(()=>{})});
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><AuthGate><App/></AuthGate></React.StrictMode>
);

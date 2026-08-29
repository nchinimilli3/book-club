import { supabase } from '@book-club/supabase';

type Props = Record<string, unknown>;

function safeProps(props: Props = {}) {
  const out: Props = {};
  for (const [k,v] of Object.entries(props)) {
    if (v == null || ['string','number','boolean'].includes(typeof v)) out[k] = typeof v === 'string' ? v.slice(0,300) : v;
  }
  return out;
}

export async function trackEvent(name: string, props: Props = {}) {
  // Product-event writes are deliberately disabled in the browser. They add a
  // database write for routine interactions and can trigger realtime fan-out.
  void name; void props;
}

export async function captureClientError(error: unknown, context: Props = {}) {
  if (!supabase) return;
  const e = error instanceof Error ? error : new Error(String(error));
  const message=e.message.slice(0,1000);
  // Quota/network failures are expected during an outage and must not create a
  // second stream of writes. One unique error per session is enough for triage.
  if(/quota|egress|network|failed to fetch|request failed \(5\d\d\)/i.test(message))return;
  const key=`bookclub:reported-error:${message}:${String(context.area||context.source||'')}`;
  try{if(sessionStorage.getItem(key))return;sessionStorage.setItem(key,'1')}catch{}
  try {
    await supabase.rpc('log_client_error', {
      target_message: message,
      target_stack: e.stack?.slice(0,6000) || null,
      target_context: {
        ...safeProps(context),
        path: window.location.pathname,
        userAgent: navigator.userAgent.slice(0,500),
      },
    });
  } catch {
    // Error reporting must be fail-open.
  }
}

export function installGlobalErrorReporting() {
  const onError = (event: ErrorEvent) => { void captureClientError(event.error || event.message, { source:'window.error' }); };
  const onReject = (event: PromiseRejectionEvent) => { void captureClientError(event.reason, { source:'unhandledrejection' }); };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onReject);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onReject);
  };
}

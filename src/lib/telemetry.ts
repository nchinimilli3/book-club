import { supabase } from './supabase';

type Props = Record<string, unknown>;

function safeProps(props: Props = {}) {
  const out: Props = {};
  for (const [k,v] of Object.entries(props)) {
    if (v == null || ['string','number','boolean'].includes(typeof v)) out[k] = typeof v === 'string' ? v.slice(0,300) : v;
  }
  return out;
}

export async function trackEvent(name: string, props: Props = {}) {
  if (!supabase) return;
  try {
    await supabase.rpc('track_product_event', {
      target_event_name: name,
      target_club_id: typeof props.clubId === 'string' ? props.clubId : null,
      target_properties: {
        ...safeProps(props),
        path: window.location.pathname,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      },
    });
  } catch {
    // Telemetry must never break the product flow.
  }
}

export async function captureClientError(error: unknown, context: Props = {}) {
  if (!supabase) return;
  const e = error instanceof Error ? error : new Error(String(error));
  try {
    await supabase.rpc('log_client_error', {
      target_message: e.message.slice(0,1000),
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

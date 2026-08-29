import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, Eye, EyeOff, MailCheck } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@book-club/supabase';
import { BootScreen } from './BootScreen';
import { cloudApi } from '../lib/cloudApi';

const cloudBackend = import.meta.env.VITE_BACKEND === 'd1';
const turnstileSiteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '');

type TurnstileApi = {
  render: (container: HTMLElement, options: { sitekey: string; theme?: 'light' | 'dark' | 'auto'; callback: (token: string) => void; 'expired-callback'?: () => void; 'error-callback'?: () => void }) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window { turnstile?: TurnstileApi; }
}

let turnstileScript: Promise<void> | undefined;
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (turnstileScript) return turnstileScript;
  turnstileScript = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Security check could not load.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset.turnstile = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Security check could not load.'));
    document.head.appendChild(script);
  });
  return turnstileScript;
}

function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!turnstileSiteKey || !element) return;
    let widgetId: string | undefined;
    let active = true;
    void loadTurnstile().then(() => {
      if (!active || !window.turnstile) return;
      widgetId = window.turnstile.render(element, {
        sitekey: turnstileSiteKey,
        theme: 'light',
        callback: onToken,
        'expired-callback': () => onToken(''),
        'error-callback': () => onToken(''),
      });
    }).catch(() => onToken(''));
    return () => {
      active = false;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [element, onToken]);
  if (!turnstileSiteKey) return null;
  return <div className="auth-captcha" ref={setElement} aria-label="Security check" />;
}

type Session = { user: { id: string; email: string; name: string } };
type Mode = 'welcome' | 'signup' | 'signin' | 'forgot' | 'reset-password' | 'check-email';
const authBase = () => String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
async function authPost(path: string, payload: Record<string, unknown>, captchaToken = '') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (captchaToken) headers['x-captcha-response'] = captchaToken;
  const response = await fetch(`${authBase()}${path}`, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || 'Authentication request failed.');
  return body;
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#EA4335" d="M9 7.36v3.48h4.84c-.21 1.12-.86 2.06-1.83 2.69l2.95 2.29c1.72-1.59 2.71-3.92 2.71-6.68 0-.63-.06-1.24-.16-1.82H9Z" />
      <path fill="#4285F4" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.95-2.29c-.82.55-1.87.88-3.01.88-2.32 0-4.29-1.57-4.99-3.67H.96v2.36A8.99 8.99 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M4.01 10.74A5.41 5.41 0 0 1 3.73 9c0-.61.1-1.2.28-1.74V4.9H.96A8.99 8.99 0 0 0 0 9c0 1.45.35 2.82.96 4.1l3.05-2.36Z" />
      <path fill="#34A853" d="M9 3.58c1.32 0 2.5.45 3.44 1.33l2.58-2.58C13.46.89 11.42 0 9 0A8.99 8.99 0 0 0 .96 4.9l3.05 2.36C4.71 5.15 6.68 3.58 9 3.58Z" />
    </svg>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | { user: { id: string; email: string; name: string } } | null>(null);
  const [checking, setChecking] = useState(cloudBackend || isSupabaseConfigured);
  const [mode, setMode] = useState<Mode>('welcome');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaNonce, setCaptchaNonce] = useState(0);

  useEffect(() => {
    if (cloudBackend) {
      const params = new URLSearchParams(window.location.search);
      if (params.get('token')) setMode('reset-password');
      if (params.get('error')) setError('That password-reset link is invalid or has expired. Request a new one.');
      cloudApi.session().then(({ user }) => setSession(user ? { user } : null)).catch(() => setSession(null)).finally(() => setChecking(false));
      return;
    }
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session as Session | null);
      setChecking(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: string, nextSession: unknown) => {
      setSession(nextSession as Session | null);
      if (event === 'PASSWORD_RECOVERY') { setMode('reset-password'); setError(''); setMessage(''); }
    });
    return () => subscription.unsubscribe();
  }, []);

  if (!cloudBackend && !isSupabaseConfigured) return children;
  if (checking) {
    return <BootScreen message="Opening your shelf…" fullViewport />;
  }
  if (session && mode !== 'reset-password') return children;

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!displayName.trim()) return setError('Add your name so your friends know who you are.');
    if (!email.trim()) return setError('Enter your email.');
    if (password.length < 12) return setError('Use at least 12 characters for your password.');

    setLoading(true);
    if (cloudBackend) {
      try {
        if (turnstileSiteKey && !captchaToken) throw new Error('Complete the security check, then try again.');
        await authPost('/api/auth/sign-up/email', { name: displayName.trim(), email: email.trim(), password, callbackURL: window.location.origin }, captchaToken);
        const next = await cloudApi.session();
        setLoading(false);
        if (next.user) setSession({ user: next.user }); else { setCaptchaToken(''); setCaptchaNonce(value => value + 1); setMode('check-email'); }
      } catch (e) { setLoading(false); setError(e instanceof Error ? e.message : 'Could not create your account.'); }
      return;
    }
    if (!supabase) { setLoading(false); return; }
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}${window.location.pathname}`,
        data: { display_name: displayName.trim() },
      },
    });
    setLoading(false);

    if (signUpError) return setError(signUpError.message);
    if (data.session) return;
    setMode('check-email');
  }

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setLoading(true);
    if (cloudBackend) {
      try {
        if (turnstileSiteKey && !captchaToken) throw new Error('Complete the security check, then try again.');
        const payload = await authPost('/api/auth/sign-in/email', { email: email.trim(), password }, captchaToken);
        setSession({ user: payload.user || (await cloudApi.session()).user! });
      } catch (e) { setError(e instanceof Error ? e.message : 'Could not sign in.'); }
      setLoading(false);
      return;
    }
    if (!supabase) { setLoading(false); return; }
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (signInError) setError(signInError.message);
  }

  async function resendVerification() {
    setError('');
    setMessage('');
    if (!email.trim()) return setError('Enter your email first.');
    if (turnstileSiteKey && !captchaToken) return setError('Complete the security check, then try again.');
    setLoading(true);
    try {
      await authPost('/api/auth/send-verification-email', { email: email.trim(), callbackURL: window.location.origin }, captchaToken);
      setMessage('A fresh verification link is on its way.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resend the verification email.');
    } finally {
      setLoading(false);
      setCaptchaToken('');
      setCaptchaNonce(value => value + 1);
    }
  }

  async function continueWithGoogle() {
    setError('');
    setLoading(true);
    if (cloudBackend) {
      // This must be a top-level navigation, rather than a cross-origin fetch.
      // Safari can reject the short-lived OAuth state cookie set by a background
      // request to the Worker, which makes Google's callback fail state checks.
      window.location.assign(`${authBase()}/api/auth/google/start`);
      return;
    }
    if (!supabase) { setLoading(false); return; }
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}${window.location.pathname}` },
    });
    if (oauthError) {
      setLoading(false);
      setError(oauthError.message);
    }
  }

  async function sendResetLink(event: FormEvent) {
    event.preventDefault();
    setError(''); setMessage('');
    if (!email.trim()) return setError('Enter your email.');
    setLoading(true);
    if (cloudBackend) {
      try {
        if (turnstileSiteKey && !captchaToken) throw new Error('Complete the security check, then try again.');
        await authPost('/api/auth/request-password-reset', { email: email.trim(), redirectTo: `${window.location.origin}${window.location.pathname}` }, captchaToken);
        setMessage('Check your inbox for the password reset link.');
      }
      catch (e) { setError(e instanceof Error ? e.message : 'Could not send a reset link.'); }
      finally { setLoading(false); }
      return;
    }
    if (!supabase) { setLoading(false); return; }
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    setLoading(false);
    if (resetError) return setError(resetError.message);
    setMessage('Check your inbox for the password reset link.');
  }

  async function updateRecoveredPassword(event: FormEvent) {
    event.preventDefault();
    setError(''); setMessage('');
    if (password.length < 12) return setError('Use at least 12 characters for your password.');
    setLoading(true);
    if (cloudBackend) {
      const token = new URLSearchParams(window.location.search).get('token');
      if (!token) { setLoading(false); return setError('That password-reset link is invalid or has expired.'); }
      try { await authPost('/api/auth/reset-password', { token, newPassword: password }); setPassword(''); setMessage('Password updated. Sign in with your new password.'); setMode('signin'); window.history.replaceState({}, '', window.location.pathname); }
      catch (e) { setError(e instanceof Error ? e.message : 'Could not update your password.'); }
      finally { setLoading(false); }
      return;
    }
    if (!supabase) { setLoading(false); return; }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) return setError(updateError.message);
    setPassword(''); setMessage('Password updated.'); setMode('welcome');
  }

  const resetToWelcome = () => {
    setMode('welcome');
    setError('');
    setMessage('');
    setPassword('');
  };

  return (


    
    <div className="auth-page">
      <div className="auth-art" aria-hidden="true">
        <img
          src = "/login-photo.jpg"
          alt = " "
          className = "auth-photo"
          />
      </div>

      <section className="auth-panel">
        {mode === 'welcome' && (
          <div className="auth-welcome">
            <h1>Your book club,<br /><em>all in one place.</em></h1>
            <p className="auth-intro">Choose what to read next, keep notes as you go, and plan the next meeting.</p>
            <div className="auth-actions">
              <button className="primary auth-primary" onClick={() => setMode('signup')}>Create an account</button>
              <button className="auth-secondary oauth-button" onClick={() => void continueWithGoogle()} disabled={loading}>
                <GoogleMark />
                <span>Continue with Google</span>
              </button>
              <button className="auth-secondary" onClick={() => setMode('signin')}>I already have an account</button>
            </div>
          </div>
        )}

        {mode === 'signup' && (
          <form className="auth-form" onSubmit={createAccount}>
            <button type="button" className="auth-back" onClick={resetToWelcome}><ArrowLeft size={18} /> Back</button>
            <p className="auth-kicker">Start with you</p>
            <h1>Create your account.</h1>
            <p className="auth-form-intro">Build your bookshelf + join or start a club next.</p>

            <label htmlFor="display-name">Your name</label>
            <input id="display-name" autoComplete="name" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Alex Morgan" />

            <label htmlFor="signup-email">Email</label>
            <input id="signup-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />

            <label htmlFor="signup-password">Password</label>
            <div className="password-field">
              <input id="signup-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="6+ characters" />
              <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button>
            </div>

            <TurnstileWidget onToken={setCaptchaToken} />
            {error && <p className="auth-error">{error}</p>}
            <button className="primary auth-primary" type="submit" disabled={loading}>{loading ? 'Creating account…' : 'Create account'}</button>
            <button type="button" className="auth-secondary oauth-button" onClick={() => void continueWithGoogle()} disabled={loading}>
              <GoogleMark />
              <span>Continue with Google</span>
            </button>
            <button type="button" className="auth-inline-link" onClick={() => { setMode('signin'); setError(''); }}>Already have an account? Sign in</button>
          </form>
        )}

        {mode === 'signin' && (
          <form className="auth-form" onSubmit={signIn}>
            <button type="button" className="auth-back" onClick={resetToWelcome}><ArrowLeft size={18} /> Back</button>
            <p className="auth-kicker">Welcome back</p>
            <h1>Open your shelf.</h1>

            <label htmlFor="signin-email">Email</label>
            <input id="signin-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />

            <label htmlFor="signin-password">Password</label>
            <div className="password-field">
              <input id="signin-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" />
              <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button>
            </div>

            <TurnstileWidget onToken={setCaptchaToken} />
            {error && <p className="auth-error">{error}</p>}
            <button className="primary auth-primary" type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
            <button type="button" className="auth-inline-link" onClick={() => { setMode('forgot'); setError(''); setMessage(''); }}>Forgot password?</button>
            <button type="button" className="auth-inline-link" onClick={() => { setMode('signup'); setError(''); setMessage(''); }}>New here? Create an account</button>
          </form>
        )}

        {mode === 'forgot' && (
          <form className="auth-form" onSubmit={sendResetLink}>
            <button type="button" className="auth-back" onClick={() => { setMode('signin'); setError(''); setMessage(''); }}><ArrowLeft size={18} /> Sign in</button>
            <p className="auth-kicker">Password reset</p>
            <h1>Check your inbox next.</h1>
            <label htmlFor="reset-email">Email</label>
            <input id="reset-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
            <TurnstileWidget onToken={setCaptchaToken} />
            {error && <p className="auth-error">{error}</p>}
            {message && <p className="auth-success">{message}</p>}
            <button className="primary auth-primary" type="submit" disabled={loading}>{loading ? 'Sending…' : 'Send reset link'}</button>
          </form>
        )}

        {mode === 'reset-password' && (
          <form className="auth-form" onSubmit={updateRecoveredPassword}>
            <p className="auth-kicker">New password</p>
            <h1>Choose a new password.</h1>
            <label htmlFor="new-password">Password</label>
            <div className="password-field">
              <input id="new-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="6+ characters" />
              <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button>
            </div>
            {error && <p className="auth-error">{error}</p>}
            {message && <p className="auth-success">{message}</p>}
            <button className="primary auth-primary" type="submit" disabled={loading}>{loading ? 'Saving…' : 'Save new password'}</button>
          </form>
        )}

        {mode === 'check-email' && (
          <div className="auth-check-email">
            <div className="auth-confirmation-icon" aria-hidden="true"><MailCheck size={25} strokeWidth={1.8} /></div>
            <p className="auth-kicker">Verification email sent</p>
            <h1>Check your inbox.</h1>
            <p className="auth-confirmation-copy">We sent a confirmation link to <strong className="auth-email-address">{email}</strong>.</p>
            <p className="auth-confirmation-detail">Open the link to activate your account, then come back to sign in.</p>
            <TurnstileWidget key={captchaNonce} onToken={setCaptchaToken} />
            {error && <p className="auth-error">{error}</p>}
            {message && <p className="auth-success">{message}</p>}
            <div className="auth-confirmation-actions">
              <button className="primary auth-primary auth-confirmation-action" onClick={() => setMode('signin')}>Back to sign in</button>
              <button className="auth-confirmation-resend" type="button" onClick={resendVerification} disabled={loading}>{loading ? 'Sending…' : 'Resend verification email'}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

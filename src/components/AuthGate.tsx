import { FormEvent, useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, MailCheck } from 'lucide-react';
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

function AuthError({ children }: { children: React.ReactNode }) {
  return <p className="auth-error" role="alert"><AlertCircle size={16} aria-hidden="true" /><span>{children}</span></p>;
}

function AuthSuccess({ children }: { children: React.ReactNode }) {
  return <p className="auth-success" role="status"><CheckCircle2 size={16} aria-hidden="true" /><span>{children}</span></p>;
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`auth-brand${compact ? ' auth-brand-compact' : ''}`}>
      <span className="auth-brand-mark" aria-hidden="true">BC</span>
      <span className="auth-brand-name">Book Club</span>
    </span>
  );
}

const emailInputProps = { type: 'email', inputMode: 'email', autoComplete: 'email', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } as const;

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
    supabase.auth.getSession().then(({ data }: { data: { session?: unknown } }) => {
      setSession(data.session as unknown as Session | null);
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
    return <BootScreen message="Opening your clubs…" fullViewport />;
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
      try {
        // Production calls the same-origin Pages /api proxy, so Better Auth can
        // safely store and validate its OAuth state cookie on the app's host.
        const payload = await authPost('/api/auth/sign-in/social', { provider: 'google', callbackURL: window.location.origin });
        if (typeof payload.url !== 'string' || !payload.url) throw new Error('Could not start Google sign in.');
        window.location.assign(payload.url);
      } catch (e) {
        setLoading(false);
        setError(e instanceof Error ? e.message : 'Could not start Google sign in.');
      }
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

  const goTo = (next: Mode) => {
    setMode(next);
    setError('');
    setMessage('');
    setShowPassword(false);
  };

  const resetToWelcome = () => {
    goTo('welcome');
    setPassword('');
  };

  const editEmail = (value: string) => { setEmail(value); if (error) setError(''); };
  const editPassword = (value: string) => { setPassword(value); if (error) setError(''); };
  const invalid = error ? true : undefined;

  const passwordToggle = (
    <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  );

  const backButton = (target: Mode, label: string) => (
    <button type="button" className="auth-back" onClick={() => (target === 'welcome' ? resetToWelcome() : goTo(target))} aria-label={label}>
      <ArrowLeft size={20} strokeWidth={2} />
    </button>
  );

  const formHead = (target: Mode | null, label = 'Back') => (
    <header className="auth-form-head">
      {target ? backButton(target, label) : <span className="auth-head-spacer" />}
      <BrandMark compact />
      <span className="auth-head-spacer" />
    </header>
  );

  const googleButton = (
    <button type="button" className="auth-button auth-google" onClick={() => void continueWithGoogle()} disabled={loading}>
      <GoogleMark />
      <span>Continue with Google</span>
    </button>
  );

  return (
    <div className={`auth-page auth-mode-${mode}`}>
      <div className="auth-art">
        <img src="/login-photo.jpg" alt="" className="auth-photo" decoding="async" fetchPriority="high" />
        <div className="auth-art-brand"><BrandMark /></div>
        <p className="auth-art-caption" aria-hidden="true">Read together.<br /><em>Talk it through.</em></p>
      </div>

      <main className="auth-panel">
        {mode === 'welcome' && (
          <div className="auth-sheet auth-welcome">
            <h1>Your book club, <em>all in one place.</em></h1>
            <p className="auth-lede">Pick what to read next, keep notes as you go, and plan the next meeting.</p>
            {message && <AuthSuccess>{message}</AuthSuccess>}
            {error && <AuthError>{error}</AuthError>}
            <div className="auth-actions">
              <button className="auth-button auth-primary" onClick={() => goTo('signup')}>Create an account</button>
              {googleButton}
            </div>
            <p className="auth-switch">Already a member? <button type="button" className="auth-link" onClick={() => goTo('signin')}>Sign in</button></p>
          </div>
        )}

        {mode === 'signup' && (
          <form className="auth-sheet auth-form" onSubmit={createAccount} noValidate aria-busy={loading}>
            {formHead('welcome')}
            <h1>Create your account</h1>
            <p className="auth-lede">Start your bookshelf, then start a club or join one.</p>

            <div className="auth-field">
              <label htmlFor="display-name">Name</label>
              <input id="display-name" autoComplete="name" autoCapitalize="words" value={displayName} onChange={e => { setDisplayName(e.target.value); if (error) setError(''); }} placeholder="Alex Morgan" />
            </div>
            <div className="auth-field">
              <label htmlFor="signup-email">Email</label>
              <input id="signup-email" {...emailInputProps} value={email} onChange={e => editEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div className="auth-field">
              <label htmlFor="signup-password">Password</label>
              <div className="password-field">
                <input id="signup-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} aria-describedby="signup-password-hint" value={password} onChange={e => editPassword(e.target.value)} placeholder="At least 12 characters" />
                {passwordToggle}
              </div>
              <p className="auth-hint" id="signup-password-hint">Use 12 or more characters.</p>
            </div>

            <TurnstileWidget onToken={setCaptchaToken} />
            {error && <AuthError>{error}</AuthError>}
            <button className="auth-button auth-primary auth-submit" type="submit" disabled={loading}>{loading ? 'Creating account…' : 'Create account'}</button>
            <div className="auth-divider" aria-hidden="true">or</div>
            {googleButton}
            <p className="auth-switch">Already a member? <button type="button" className="auth-link" onClick={() => goTo('signin')}>Sign in</button></p>
          </form>
        )}

        {mode === 'signin' && (
          <form className="auth-sheet auth-form" onSubmit={signIn} noValidate aria-busy={loading}>
            {formHead('welcome')}
            <h1>Welcome back</h1>
            <p className="auth-lede">Sign in to pick up where your club left off.</p>

            <div className="auth-field">
              <label htmlFor="signin-email">Email</label>
              <input id="signin-email" {...emailInputProps} aria-invalid={invalid} value={email} onChange={e => editEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div className="auth-field">
              <div className="auth-label-row">
                <label htmlFor="signin-password">Password</label>
                <button type="button" className="auth-link auth-link-quiet" onClick={() => goTo('forgot')}>Forgot password?</button>
              </div>
              <div className="password-field">
                <input id="signin-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" aria-invalid={invalid} value={password} onChange={e => editPassword(e.target.value)} placeholder="Your password" />
                {passwordToggle}
              </div>
            </div>

            <TurnstileWidget onToken={setCaptchaToken} />
            {error && <AuthError>{error}</AuthError>}
            {message && <AuthSuccess>{message}</AuthSuccess>}
            <button className="auth-button auth-primary auth-submit" type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
            <div className="auth-divider" aria-hidden="true">or</div>
            {googleButton}
            <p className="auth-switch">New here? <button type="button" className="auth-link" onClick={() => goTo('signup')}>Create an account</button></p>
          </form>
        )}

        {mode === 'forgot' && (
          <form className="auth-sheet auth-form" onSubmit={sendResetLink} noValidate aria-busy={loading}>
            {formHead('signin', 'Back to sign in')}
            <h1>Reset your password</h1>
            <p className="auth-lede">Enter the email you signed up with and we’ll send you a reset link.</p>
            <div className="auth-field">
              <label htmlFor="reset-email">Email</label>
              <input id="reset-email" {...emailInputProps} aria-invalid={invalid} value={email} onChange={e => editEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <TurnstileWidget onToken={setCaptchaToken} />
            {error && <AuthError>{error}</AuthError>}
            {message && <AuthSuccess>{message}</AuthSuccess>}
            <button className="auth-button auth-primary auth-submit" type="submit" disabled={loading}>{loading ? 'Sending…' : 'Send reset link'}</button>
          </form>
        )}

        {mode === 'reset-password' && (
          <form className="auth-sheet auth-form" onSubmit={updateRecoveredPassword} noValidate aria-busy={loading}>
            {formHead(null)}
            <h1>Choose a new password</h1>
            <p className="auth-lede">Make it something you haven’t used here before.</p>
            <div className="auth-field">
              <label htmlFor="new-password">New password</label>
              <div className="password-field">
                <input id="new-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} aria-describedby="new-password-hint" aria-invalid={invalid} value={password} onChange={e => editPassword(e.target.value)} placeholder="At least 12 characters" />
                {passwordToggle}
              </div>
              <p className="auth-hint" id="new-password-hint">Use 12 or more characters.</p>
            </div>
            {error && <AuthError>{error}</AuthError>}
            {message && <AuthSuccess>{message}</AuthSuccess>}
            <button className="auth-button auth-primary auth-submit" type="submit" disabled={loading}>{loading ? 'Saving…' : 'Save new password'}</button>
          </form>
        )}

        {mode === 'check-email' && (
          <div className="auth-sheet auth-form auth-check-email">
            {formHead(null)}
            <div className="auth-confirmation-icon" aria-hidden="true"><MailCheck size={24} strokeWidth={1.8} /></div>
            <h1>Check your inbox</h1>
            <p className="auth-lede">We sent a confirmation link to</p>
            <p className="auth-email-address">{email}</p>
            <p className="auth-hint auth-confirmation-detail">Open the link to activate your account, then come back to sign in. It can take a minute to arrive.</p>
            <TurnstileWidget key={captchaNonce} onToken={setCaptchaToken} />
            {error && <AuthError>{error}</AuthError>}
            {message && <AuthSuccess>{message}</AuthSuccess>}
            <button className="auth-button auth-primary auth-submit" onClick={() => goTo('signin')}>Back to sign in</button>
            <p className="auth-switch">Didn’t get it? <button className="auth-link" type="button" onClick={resendVerification} disabled={loading}>{loading ? 'Sending…' : 'Resend email'}</button></p>
          </div>
        )}
      </main>
    </div>
  );
}

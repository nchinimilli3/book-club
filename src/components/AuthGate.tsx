import { FormEvent, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

type Mode = 'welcome' | 'signup' | 'signin' | 'check-email';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(isSupabaseConfigured);
  const [mode, setMode] = useState<Mode>('welcome');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (!isSupabaseConfigured) return children;
  if (checking) {
    return (
      <div className="auth-page auth-loading">
        <div className="auth-wordmark">BOOK CLUB</div>
        <p>Opening your shelf…</p>
      </div>
    );
  }
  if (session) return children;

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setError('');
    if (!displayName.trim()) return setError('Add your name so your friends know who you are.');
    if (!email.trim()) return setError('Enter your email.');
    if (password.length < 6) return setError('Use at least 6 characters for your password.');

    setLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: window.location.origin,
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
    if (!supabase) return;
    setError('');
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (signInError) setError(signInError.message);
  }

  const resetToWelcome = () => {
    setMode('welcome');
    setError('');
    setPassword('');
  };

  return (
    <div className="auth-page">
      <div className="auth-art" aria-hidden="true">
        <span className="auth-star star-one">✦</span>
        <span className="auth-star star-two">✷</span>
        <div className="auth-book-stack">
          <div className="auth-book auth-book-one">READ</div>
          <div className="auth-book auth-book-two">TOGETHER</div>
          <div className="auth-book auth-book-three">REMEMBER</div>
        </div>
      </div>

      <section className="auth-panel">
        <div className="auth-brand"><span>✦</span> BOOK CLUB</div>

        {mode === 'welcome' && (
          <div className="auth-welcome">
            <p className="auth-kicker">A private place for the books you read together.</p>
            <h1>Your book club,<br /><em>all in one place.</em></h1>
            <p className="auth-intro">Pick the next read, save the thoughts you have along the way, and actually make the FaceTime happen.</p>
            <div className="auth-actions">
              <button className="primary auth-primary" onClick={() => setMode('signup')}>Create an account</button>
              <button className="auth-secondary" onClick={() => setMode('signin')}>I already have an account</button>
            </div>
            <p className="auth-privacy">Invite-only clubs. Nothing is publicly discoverable.</p>
          </div>
        )}

        {mode === 'signup' && (
          <form className="auth-form" onSubmit={createAccount}>
            <button type="button" className="auth-back" onClick={resetToWelcome}><ArrowLeft size={18} /> Back</button>
            <p className="auth-kicker">Start with you</p>
            <h1>Create your account.</h1>
            <p className="auth-form-intro">You’ll build your bookshelf and join or start a club next.</p>

            <label htmlFor="display-name">Your name</label>
            <input id="display-name" autoComplete="name" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Neha" />

            <label htmlFor="signup-email">Email</label>
            <input id="signup-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />

            <label htmlFor="signup-password">Password</label>
            <div className="password-field">
              <input id="signup-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="6+ characters" />
              <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button>
            </div>

            {error && <p className="auth-error">{error}</p>}
            <button className="primary auth-primary" type="submit" disabled={loading}>{loading ? 'Creating account…' : 'Create account'}</button>
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

            {error && <p className="auth-error">{error}</p>}
            <button className="primary auth-primary" type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
            <button type="button" className="auth-inline-link" onClick={() => { setMode('signup'); setError(''); }}>New here? Create an account</button>
          </form>
        )}

        {mode === 'check-email' && (
          <div className="auth-check-email">
            <p className="auth-kicker">One quick thing</p>
            <h1>Check your inbox.</h1>
            <p>We sent a confirmation link to <strong>{email}</strong>. Open it, then BOOK CLUB will bring you back here signed in.</p>
            <button className="auth-secondary" onClick={() => setMode('signin')}>Back to sign in</button>
          </div>
        )}
      </section>
    </div>
  );
}

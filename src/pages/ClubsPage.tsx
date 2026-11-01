import { FormEvent, useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronRight, Plus, Ticket, X } from 'lucide-react';
import { useRouter } from '../lib/router';
import { createClub, joinClub } from '@book-club/data';
import { useApp } from '../lib/AppContext';
import type { Tone } from '../lib/model';
import { clubInitials as initials, phaseLabel } from '../lib/clubDisplay';
import { cloudApi } from '../lib/cloudApi';

const cloudBackend = import.meta.env.VITE_BACKEND === 'd1';
const tones: Tone[] = ['rose', 'olive', 'gold', 'plum', 'blue', 'clay'];

/** Accepts a bare code or a full invite link and returns just the code. */
function inviteCodeFrom(value: string) {
  const trimmed = value.trim();
  const fromLink = trimmed.match(/\/join\/([^/?#\s]+)/);
  return fromLink ? decodeURIComponent(fromLink[1]) : trimmed;
}

type SheetMode = 'create' | 'join';

export function ClubsPage() {
  const a = useApp(), { navigate: nav } = useRouter();
  const [mode, setMode] = useState<SheetMode | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [tone, setTone] = useState<Tone>('rose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const firstName = (a.profile?.displayName || '').trim().split(/\s+/)[0];
  const hasClubs = a.clubs.length > 0;

  const open = (next: SheetMode) => { setError(''); setMode(next); };
  const close = () => { if (!busy) setMode(null); };

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError('Give your club a name.');
    setBusy(true); setError('');
    try {
      const c: any = cloudBackend ? await cloudApi.createClub(name.trim()) : await createClub(name.trim(), tone);
      const id = c.club?.id || c.id;
      await a.refresh(); await a.selectClub(id); nav(`/clubs/${id}`);
    } catch (e: any) { setError(e?.message || 'Could not create the club.'); }
    finally { setBusy(false); }
  }

  async function join(event: FormEvent) {
    event.preventDefault();
    const invite = inviteCodeFrom(code);
    if (!invite) return setError('Paste the invite code or link.');
    setBusy(true); setError('');
    try {
      const c: any = cloudBackend ? await cloudApi.joinInvite(invite) : await joinClub(invite);
      const id = c.clubId || c.id;
      await a.refresh(); await a.selectClub(id); nav(`/clubs/${id}`);
    } catch (e: any) { setError(e?.message || 'That invite didn’t work. Check it and try again.'); }
    finally { setBusy(false); }
  }

  const choices = (
    <div className="clubs-choices">
      <button type="button" className="clubs-choice" onClick={() => open('create')}>
        <span className="clubs-choice-icon clubs-choice-icon-primary" aria-hidden="true"><Plus size={20} strokeWidth={2.2} /></span>
        <span className="clubs-choice-copy"><b>Start a club</b><small>Name it, invite friends, pick your first book.</small></span>
        <ChevronRight className="clubs-chevron" size={18} aria-hidden="true" />
      </button>
      <button type="button" className="clubs-choice" onClick={() => open('join')}>
        <span className="clubs-choice-icon" aria-hidden="true"><Ticket size={19} strokeWidth={2} /></span>
        <span className="clubs-choice-copy"><b>Join with an invite</b><small>Paste the code or link a friend sent you.</small></span>
        <ChevronRight className="clubs-chevron" size={18} aria-hidden="true" />
      </button>
    </div>
  );

  return (
    <div className="page clubs-page">
      <header className="clubs-head">
        {hasClubs ? (
          <>
            <h1>Your clubs</h1>
            <p className="clubs-lede">{a.clubs.length === 1 ? '1 club' : `${a.clubs.length} clubs`}</p>
          </>
        ) : (
          <>
            <h1>{firstName ? `Welcome, ${firstName}` : 'Welcome'}</h1>
            <p className="clubs-lede">Clubs are private to the people you invite. Start your own, or join one a friend set up.</p>
          </>
        )}
      </header>

      {hasClubs && (
        <section className="clubs-list" aria-label="Your clubs">
          {a.clubs.map(c => (
            <button type="button" className="clubs-row" key={c.id} onClick={() => nav(`/clubs/${c.id}`)}>
              <span className="clubs-avatar" style={{ background: `var(--${c.tone})` }} aria-hidden="true">{initials(c.name)}</span>
              <span className="clubs-row-copy">
                <b>{c.name}</b>
                <small>{phaseLabel[c.phase] || 'Getting started'}{c.id === a.activeClubId ? ' · Current' : ''}</small>
              </span>
              <ChevronRight className="clubs-chevron" size={18} aria-hidden="true" />
            </button>
          ))}
        </section>
      )}

      <section className={`clubs-actions${hasClubs ? ' clubs-actions-secondary' : ''}`} aria-label="Add a club">
        {hasClubs && <h2>Add another club</h2>}
        {choices}
      </section>

      {mode && (
        <ClubSheet title={mode === 'create' ? 'Start a club' : 'Join a club'} onClose={close}>
          {mode === 'create' ? (
            <form onSubmit={create} noValidate>
              <p className="clubs-sheet-lede">You can change the name later in club settings.</p>
              <div className="clubs-field">
                <label htmlFor="club-name">Club name</label>
                <input id="club-name" autoFocus autoComplete="off" autoCapitalize="words" maxLength={60} value={name} onChange={e => { setName(e.target.value); if (error) setError(''); }} placeholder="e.g. Sunday Classics" />
              </div>
              {!cloudBackend && (
                <div className="clubs-field">
                  <span className="clubs-field-label" id="club-tone-label">Colour</span>
                  <div className="clubs-tones" role="radiogroup" aria-labelledby="club-tone-label">
                    {tones.map(t => (
                      <button type="button" role="radio" aria-checked={tone === t} aria-label={t} key={t} className="clubs-tone" style={{ background: `var(--${t})` }} onClick={() => setTone(t)} />
                    ))}
                  </div>
                </div>
              )}
              {error && <p className="clubs-error" role="alert"><AlertCircle size={16} aria-hidden="true" />{error}</p>}
              <button className="clubs-submit" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create club'}</button>
            </form>
          ) : (
            <form onSubmit={join} noValidate>
              <p className="clubs-sheet-lede">Paste the invite code, or the whole invite link.</p>
              <div className="clubs-field">
                <label htmlFor="club-invite">Invite code or link</label>
                <input id="club-invite" autoFocus autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={code} onChange={e => { setCode(e.target.value); if (error) setError(''); }} placeholder="ABC123" />
              </div>
              {error && <p className="clubs-error" role="alert"><AlertCircle size={16} aria-hidden="true" />{error}</p>}
              <button className="clubs-submit" type="submit" disabled={busy}>{busy ? 'Joining…' : 'Join club'}</button>
            </form>
          )}
        </ClubSheet>
      )}
    </div>
  );
}

/** Bottom sheet on phones, centred dialog on larger screens. */
function ClubSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeRef.current(); };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; previous?.focus?.(); };
  }, []);
  return (
    <div className="clubs-sheet-backdrop" onMouseDown={onClose}>
      <section className="clubs-sheet" role="dialog" aria-modal="true" aria-labelledby="clubs-sheet-title" onMouseDown={e => e.stopPropagation()}>
        <header className="clubs-sheet-head">
          <h2 id="clubs-sheet-title">{title}</h2>
          <button type="button" className="clubs-sheet-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

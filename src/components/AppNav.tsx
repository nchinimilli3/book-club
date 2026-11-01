import { useEffect, useRef, useState } from 'react';
import { Bell, BookOpen, Check, ChevronDown, Search, Settings2, WifiOff } from 'lucide-react';
import { useApp } from '../lib/AppContext';
import { useRouter } from '../lib/router';
import { Avatar } from './SafeImage';
import { clubInitials } from '../lib/clubDisplay';

type Tab = 'club' | 'find' | 'me' | null;

function currentTab(path: string): Tab {
  if (path === '/search') return 'find';
  if (path === '/me' || path.startsWith('/me/')) return 'me';
  if (path === '/' || path.startsWith('/clubs')) return 'club';
  return null;
}

function ClubTile({ name, tone, size = 28 }: { name: string; tone?: string; size?: number }) {
  return <span className="shell-club-tile" style={{ width: size, height: size, background: `var(--${tone || 'rose'})`, fontSize: Math.round(size * .4) }} aria-hidden="true">{clubInitials(name)}</span>;
}

/** Closes a popover on outside pointer-down or Escape. */
function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) closeRef.current(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeRef.current(); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open, ref]);
}

export function AppHeader({ onMarkAllRead }: { onMarkAllRead: () => Promise<void> }) {
  const a = useApp(), { path, navigate } = useRouter();
  const [clubOpen, setClubOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const clubRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  useDismiss(clubOpen, () => setClubOpen(false), clubRef);
  useDismiss(bellOpen, () => setBellOpen(false), bellRef);

  const tab = currentTab(path);
  const activeClub = a.clubs.find(c => c.id === a.activeClubId);
  const clubHome = a.activeClubId ? `/clubs/${a.activeClubId}` : '/clubs';
  const unread = a.unreadNotifications;
  const go = (to: string) => { setClubOpen(false); setBellOpen(false); navigate(to); };

  async function markAll() {
    setMarking(true);
    try { await onMarkAllRead(); setBellOpen(false); } finally { setMarking(false); }
  }

  return (
    <>
      <header className="shell-header">
        <button type="button" className="shell-brand" onClick={() => go(clubHome)} aria-label="Book Club home">
          <span className="shell-brand-mark" aria-hidden="true">BC</span>
          <span className="shell-brand-name">Book Club</span>
        </button>

        <div className="shell-switcher" ref={clubRef}>
          <button type="button" className="shell-switcher-button" onClick={() => { setClubOpen(v => !v); setBellOpen(false); }} aria-expanded={clubOpen} aria-haspopup="menu">
            {activeClub ? <ClubTile name={activeClub.name} tone={activeClub.tone} size={26} /> : <span className="shell-club-tile shell-club-tile-empty" aria-hidden="true"><BookOpen size={14} /></span>}
            <span className="shell-switcher-name">{activeClub?.name || 'Your clubs'}</span>
            <ChevronDown className="shell-switcher-chevron" size={16} aria-hidden="true" />
          </button>
          {clubOpen && (
            <div className="shell-popover shell-switcher-menu" role="menu">
              <p className="shell-popover-label">Your clubs</p>
              {a.clubs.length === 0 && <p className="shell-popover-empty">You haven’t joined a club yet.</p>}
              {a.clubs.map(c => (
                <button type="button" role="menuitem" key={c.id} className={`shell-menu-row${c.id === a.activeClubId ? ' is-current' : ''}`} onClick={() => go(`/clubs/${c.id}`)}>
                  <ClubTile name={c.name} tone={c.tone} size={32} />
                  <span className="shell-menu-text">{c.name}</span>
                  {c.id === a.activeClubId && <Check size={17} className="shell-menu-check" aria-label="Current club" />}
                </button>
              ))}
              <button type="button" role="menuitem" className="shell-menu-row shell-menu-footer" onClick={() => go('/clubs')}>
                <span className="shell-menu-icon" aria-hidden="true"><Settings2 size={16} /></span>
                <span className="shell-menu-text">All clubs</span>
              </button>
            </div>
          )}
        </div>

        <nav className="shell-desktop-tabs" aria-label="Primary">
          <button type="button" className={tab === 'club' ? 'is-active' : ''} aria-current={tab === 'club' ? 'page' : undefined} onClick={() => go(clubHome)}>Club</button>
          <button type="button" className={tab === 'find' ? 'is-active' : ''} aria-current={tab === 'find' ? 'page' : undefined} onClick={() => go('/search')}>Find books</button>
        </nav>

        <div className="shell-actions">
          <div className="shell-bell" ref={bellRef}>
            <button type="button" className="shell-icon-button" onClick={() => { setBellOpen(v => !v); setClubOpen(false); }} aria-expanded={bellOpen} aria-haspopup="menu" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
              <Bell size={20} strokeWidth={1.9} />
              {unread > 0 && <span className="shell-badge" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
            </button>
            {bellOpen && (
              <div className="shell-popover shell-bell-menu" role="menu">
                <div className="shell-bell-head">
                  <b>{unread ? `${unread} unread` : 'You’re all caught up'}</b>
                  <span>{unread ? 'New activity from your clubs.' : 'Nothing new right now.'}</span>
                </div>
                <button type="button" role="menuitem" className="shell-menu-row" onClick={() => go('/notifications')}>
                  <span className="shell-menu-icon" aria-hidden="true"><Bell size={16} /></span>
                  <span className="shell-menu-text">View notifications</span>
                </button>
                {unread > 0 && (
                  <button type="button" role="menuitem" className="shell-menu-row" disabled={marking} onClick={() => void markAll()}>
                    <span className="shell-menu-icon" aria-hidden="true"><Check size={16} /></span>
                    <span className="shell-menu-text">{marking ? 'Marking…' : 'Mark all as read'}</span>
                  </button>
                )}
              </div>
            )}
          </div>
          <button type="button" className={`shell-profile${tab === 'me' ? ' is-active' : ''}`} onClick={() => go('/me')} aria-label="Your profile">
            <Avatar className="shell-avatar" src={a.profile?.avatarUrl} name={a.profile?.displayName} />
          </button>
        </div>
      </header>
      {a.offline && <div className="shell-offline" role="status"><WifiOff size={14} aria-hidden="true" /> You’re offline. Showing your last saved club.</div>}
    </>
  );
}

export function TabBar() {
  const a = useApp(), { path, navigate } = useRouter();
  const tab = currentTab(path);
  const clubHome = a.activeClubId ? `/clubs/${a.activeClubId}` : '/clubs';
  const item = (key: Exclude<Tab, null>, label: string, to: string, icon: React.ReactNode) => (
    <button type="button" className={`shell-tab${tab === key ? ' is-active' : ''}`} aria-current={tab === key ? 'page' : undefined} onClick={() => navigate(to)}>
      <span className="shell-tab-icon">{icon}</span>
      <span className="shell-tab-label">{label}</span>
    </button>
  );
  return (
    <nav className="shell-tabbar" aria-label="Primary">
      {item('club', 'Club', clubHome, <BookOpen size={22} strokeWidth={tab === 'club' ? 2.2 : 1.8} />)}
      {item('find', 'Find', '/search', <Search size={22} strokeWidth={tab === 'find' ? 2.2 : 1.8} />)}
      {item('me', 'Me', '/me', <Avatar className="shell-tab-avatar" src={a.profile?.avatarUrl} name={a.profile?.displayName} />)}
    </nav>
  );
}

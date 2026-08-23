import type { ProfileStyle } from './model';

type CachedProfileStyle = {
  style: ProfileStyle;
  savedAt: number;
  pending: boolean;
};

function key(userId: string) {
  return `book-club:profile-style:${userId}`;
}

export function readProfileStyleCache(userId: string): CachedProfileStyle | null {
  try {
    const raw = window.localStorage.getItem(key(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedProfileStyle;
    if (!parsed || typeof parsed !== 'object' || !parsed.style) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeProfileStyleCache(userId: string, style: ProfileStyle, pending: boolean) {
  try {
    window.localStorage.setItem(key(userId), JSON.stringify({ style, savedAt: Date.now(), pending } satisfies CachedProfileStyle));
  } catch {
    // The cloud save still works if storage is unavailable (private mode/storage policy).
  }
}

export function clearProfileStyleCache(userId: string) {
  try { window.localStorage.removeItem(key(userId)); } catch { /* noop */ }
}

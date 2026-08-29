import type { AuthSession } from './auth';
import { requireMember, requireSession } from './authorization';
import type { Env } from './env';
import { HttpError, json } from './http';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR = 'https://www.googleapis.com/calendar/v3';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function configured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.CALENDAR_STATE_SECRET && env.TOKEN_ENCRYPTION_KEY);
}

function b64(data: Uint8Array): string { return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function fromB64(value: string): Uint8Array { const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, char => char.charCodeAt(0)); }
function asBuffer(value: Uint8Array): ArrayBuffer { return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer; }

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

function secureEqual(left: string, right: string): boolean {
  const size = Math.max(left.length, right.length); let mismatch = left.length ^ right.length;
  for (let index = 0; index < size; index++) mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return mismatch === 0;
}

async function stateFor(env: Env, userId: string): Promise<string> {
  const payload = b64(encoder.encode(JSON.stringify({ userId, expiresAt: Date.now() + 10 * 60 * 1000 })));
  return `${payload}.${await hmac(env.CALENDAR_STATE_SECRET!, payload)}`;
}

async function readState(env: Env, value: string | null): Promise<string> {
  if (!value) throw new HttpError(400, 'Missing Calendar sign-in state.', 'invalid_state');
  const [payload, signature] = value.split('.');
  if (!payload || !signature || !secureEqual(signature, await hmac(env.CALENDAR_STATE_SECRET!, payload))) throw new HttpError(400, 'Invalid Calendar sign-in state.', 'invalid_state');
  const parsed = JSON.parse(decoder.decode(fromB64(payload))) as { userId?: string; expiresAt?: number };
  if (!parsed.userId || !parsed.expiresAt || parsed.expiresAt < Date.now()) throw new HttpError(400, 'Calendar sign-in state expired. Try again.', 'invalid_state');
  return parsed.userId;
}

async function cryptoKey(env: Env): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(env.TOKEN_ENCRYPTION_KEY!));
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encrypt(env: Env, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12)); const key = await cryptoKey(env);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(text)));
  return `${b64(iv)}.${b64(encrypted)}`;
}

async function decrypt(env: Env, value: string): Promise<string> {
  const [iv, payload] = value.split('.');
  if (!iv || !payload) throw new HttpError(500, 'Stored Calendar token is invalid.', 'calendar_unavailable');
  const result = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: asBuffer(fromB64(iv)) }, await cryptoKey(env), asBuffer(fromB64(payload)));
  return decoder.decode(result);
}

function callbackUrl(env: Env): string { return new URL('/api/calendar/callback', env.AUTH_BASE_URL).toString(); }

async function exchangeCode(env: Env, code: string) {
  const form = new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, redirect_uri: callbackUrl(env), grant_type: 'authorization_code' });
  const response = await fetch(GOOGLE_TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== 'string') throw new HttpError(502, 'Google Calendar did not accept the authorization code.', 'calendar_unavailable');
  return payload as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string };
}

async function googleProfile(accessToken: string): Promise<{ id: string; email?: string }> {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { authorization: `Bearer ${accessToken}` } });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof payload.id !== 'string') throw new HttpError(502, 'Google Calendar account lookup failed.', 'calendar_unavailable');
  return { id: payload.id, email: typeof payload.email === 'string' ? payload.email : undefined };
}

async function accessToken(env: Env, userId: string): Promise<string> {
  const connection = await env.DB.prepare('SELECT access_token_ciphertext, refresh_token_ciphertext, access_expires_at FROM calendar_connections WHERE user_id=?').bind(userId).first<{ access_token_ciphertext: string; refresh_token_ciphertext: string | null; access_expires_at: number | null }>();
  if (!connection) throw new HttpError(409, 'Connect Google Calendar first.', 'calendar_not_connected');
  if (!connection.access_expires_at || connection.access_expires_at > Date.now() + 60_000) return decrypt(env, connection.access_token_ciphertext);
  if (!connection.refresh_token_ciphertext) throw new HttpError(409, 'Reconnect Google Calendar to continue.', 'calendar_reconnect_required');
  const refreshToken = await decrypt(env, connection.refresh_token_ciphertext);
  const form = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, refresh_token: refreshToken, grant_type: 'refresh_token' });
  const response = await fetch(GOOGLE_TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== 'string') throw new HttpError(409, 'Reconnect Google Calendar to continue.', 'calendar_reconnect_required');
  const encrypted = await encrypt(env, payload.access_token); const expiresAt = Date.now() + Number(payload.expires_in || 3600) * 1000;
  await env.DB.prepare('UPDATE calendar_connections SET access_token_ciphertext=?, access_expires_at=?, updated_at=? WHERE user_id=?').bind(encrypted, expiresAt, Date.now(), userId).run();
  return payload.access_token;
}

export async function calendarStatus(env: Env, session: AuthSession | null): Promise<Response> {
  requireSession(session);
  if (!configured(env)) return json({ configured: false, connected: false });
  const connection = await env.DB.prepare('SELECT email, updated_at FROM calendar_connections WHERE user_id=?').bind(session.user.id).first<{ email: string | null; updated_at: number }>();
  return json({ configured: true, connected: Boolean(connection), email: connection?.email ?? null, lastSyncedAt: connection?.updated_at ?? null });
}

export async function startCalendar(env: Env, session: AuthSession | null): Promise<Response> {
  requireSession(session);
  if (!configured(env)) throw new HttpError(503, 'Google Calendar is not configured yet.', 'calendar_not_configured');
  const url = new URL(GOOGLE_AUTH);
  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID!); url.searchParams.set('redirect_uri', callbackUrl(env));
  url.searchParams.set('response_type', 'code'); url.searchParams.set('access_type', 'offline'); url.searchParams.set('prompt', 'consent');
  url.searchParams.set('scope', 'openid email https://www.googleapis.com/auth/calendar.events'); url.searchParams.set('state', await stateFor(env, session.user.id));
  return json({ url: url.toString() });
}

export async function calendarCallback(request: Request, env: Env): Promise<Response> {
  if (!configured(env)) throw new HttpError(503, 'Google Calendar is not configured yet.', 'calendar_not_configured');
  const url = new URL(request.url); const userId = await readState(env, url.searchParams.get('state')); const code = url.searchParams.get('code');
  if (!code) throw new HttpError(400, 'Google Calendar did not return an authorization code.', 'calendar_unavailable');
  const token = await exchangeCode(env, code); const profile = await googleProfile(token.access_token); const now = Date.now();
  const existing = await env.DB.prepare('SELECT refresh_token_ciphertext FROM calendar_connections WHERE user_id=?').bind(userId).first<{ refresh_token_ciphertext: string | null }>();
  await env.DB.prepare(`INSERT INTO calendar_connections (user_id, provider, provider_account_id, email, access_token_ciphertext, refresh_token_ciphertext, access_expires_at, scopes, created_at, updated_at)
    VALUES (?, 'google', ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET provider_account_id=excluded.provider_account_id, email=excluded.email,
    access_token_ciphertext=excluded.access_token_ciphertext, refresh_token_ciphertext=COALESCE(excluded.refresh_token_ciphertext, calendar_connections.refresh_token_ciphertext), access_expires_at=excluded.access_expires_at, scopes=excluded.scopes, updated_at=excluded.updated_at`)
    .bind(userId, profile.id, profile.email ?? null, await encrypt(env, token.access_token), token.refresh_token ? await encrypt(env, token.refresh_token) : existing?.refresh_token_ciphertext ?? null, now + Number(token.expires_in || 3600) * 1000, token.scope ?? '', now, now).run();
  return Response.redirect(new URL('/me/settings?calendar=connected', env.APP_ORIGIN).toString(), 302);
}

export async function disconnectCalendar(env: Env, session: AuthSession | null): Promise<Response> {
  requireSession(session); await env.DB.batch([
    env.DB.prepare('DELETE FROM calendar_events WHERE user_id=?').bind(session.user.id),
    env.DB.prepare('DELETE FROM calendar_connections WHERE user_id=?').bind(session.user.id),
  ]);
  return json({ disconnected: true });
}

async function putGoogleEvent(token: string, existingId: string | null, event: Record<string, unknown>): Promise<string> {
  const endpoint = existingId ? `${GOOGLE_CALENDAR}/calendars/primary/events/${encodeURIComponent(existingId)}` : `${GOOGLE_CALENDAR}/calendars/primary/events`;
  const response = await fetch(endpoint, { method: existingId ? 'PATCH' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(event) });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof payload.id !== 'string') throw new HttpError(502, 'Google Calendar could not save this event.', 'calendar_unavailable');
  return payload.id;
}

export async function syncMeeting(env: Env, session: AuthSession | null, clubId: string, meetingId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId);
  const meeting = await env.DB.prepare(`SELECT m.id, m.book_id, m.starts_at, m.location, m.notes, b.title FROM meetings m LEFT JOIN books b ON b.id=m.book_id WHERE m.id=? AND m.club_id=?`).bind(meetingId, clubId).first<{ id: string; book_id: string | null; starts_at: number; location: string; notes: string; title: string | null }>();
  if (!meeting) throw new HttpError(404, 'Meeting not found.', 'not_found');
  const event = await env.DB.prepare("SELECT provider_event_id FROM calendar_events WHERE user_id=? AND kind='meeting' AND meeting_id=?").bind(session.user.id, meetingId).first<{ provider_event_id: string }>();
  const start = new Date(meeting.starts_at); const end = new Date(meeting.starts_at + 90 * 60 * 1000);
  const providerEventId = await putGoogleEvent(await accessToken(env, session.user.id), event?.provider_event_id ?? null, { summary: `${meeting.title ?? 'BOOK CLUB'} discussion`, description: meeting.notes || undefined, location: meeting.location || undefined, start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } });
  await env.DB.prepare(`INSERT INTO calendar_events (id, user_id, club_id, book_id, meeting_id, provider_event_id, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'meeting', ?, ?)
    ON CONFLICT(user_id, kind, meeting_id) DO UPDATE SET provider_event_id=excluded.provider_event_id, updated_at=excluded.updated_at`).bind(crypto.randomUUID(), session.user.id, clubId, meeting.book_id, meetingId, providerEventId, Date.now(), Date.now()).run();
  return json({ synced: true });
}

export async function syncReadingPlan(env: Env, session: AuthSession | null, clubId: string, bookId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId);
  const [book, checkpoints] = await env.DB.batch([
    env.DB.prepare('SELECT id, title, author, target_finish_date FROM books WHERE id=? AND club_id=?').bind(bookId, clubId),
    env.DB.prepare('SELECT label, due_at, target_chapter, target_page FROM reading_checkpoints WHERE book_id=? AND club_id=? ORDER BY due_at ASC LIMIT 20').bind(bookId, clubId),
  ]);
  const current = book.results[0] as { id: string; title: string; author: string; target_finish_date: string | null } | undefined;
  if (!current) throw new HttpError(404, 'Book not found.', 'not_found');
  const first = checkpoints.results[0] as { due_at?: string } | undefined;
  const start = new Date(`${first?.due_at || new Date().toISOString().slice(0, 10)}T12:00:00Z`);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const lines = checkpoints.results.map(row => { const checkpoint = row as Record<string, unknown>; const target = checkpoint.target_chapter ? `chapter ${checkpoint.target_chapter}` : checkpoint.target_page ? `page ${checkpoint.target_page}` : 'your reading target'; return `${checkpoint.due_at}: ${checkpoint.label || 'Checkpoint'} · ${target}`; });
  const existing = await env.DB.prepare("SELECT provider_event_id FROM calendar_events WHERE user_id=? AND kind='reading_plan' AND book_id=?").bind(session.user.id, bookId).first<{ provider_event_id: string }>();
  const providerEventId = await putGoogleEvent(await accessToken(env, session.user.id), existing?.provider_event_id ?? null, {
    summary: `BOOK CLUB reading plan · ${current.title}`,
    description: [`${current.title} by ${current.author}`, current.target_finish_date ? `Target finish: ${current.target_finish_date}` : '', ...lines].filter(Boolean).join('\n'),
    start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() },
  });
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO calendar_events (id, user_id, club_id, book_id, meeting_id, provider_event_id, kind, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, 'reading_plan', ?, ?)
    ON CONFLICT(user_id, kind, book_id) DO UPDATE SET provider_event_id=excluded.provider_event_id, updated_at=excluded.updated_at`).bind(crypto.randomUUID(), session.user.id, clubId, bookId, providerEventId, now, now).run();
  return json({ synced: true });
}

export async function removeReadingPlan(env: Env, session: AuthSession | null, clubId: string, bookId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId);
  const event = await env.DB.prepare("SELECT id, provider_event_id FROM calendar_events WHERE user_id=? AND club_id=? AND book_id=? AND kind='reading_plan'").bind(session.user.id, clubId, bookId).first<{ id: string; provider_event_id: string }>();
  if (!event) return json({ removed: true });
  const response = await fetch(`${GOOGLE_CALENDAR}/calendars/primary/events/${encodeURIComponent(event.provider_event_id)}`, { method: 'DELETE', headers: { authorization: `Bearer ${await accessToken(env, session.user.id)}` } });
  if (!response.ok && response.status !== 404) throw new HttpError(502, 'Google Calendar could not remove this event.', 'calendar_unavailable');
  await env.DB.prepare('DELETE FROM calendar_events WHERE id=? AND user_id=?').bind(event.id, session.user.id).run();
  return json({ removed: true });
}

export async function removeCalendarEvent(env: Env, session: AuthSession | null, eventId: string): Promise<Response> {
  requireSession(session);
  const event = await env.DB.prepare('SELECT id, provider_event_id FROM calendar_events WHERE id=? AND user_id=?').bind(eventId, session.user.id).first<{ id: string; provider_event_id: string }>();
  if (!event) return json({ removed: true });
  const response = await fetch(`${GOOGLE_CALENDAR}/calendars/primary/events/${encodeURIComponent(event.provider_event_id)}`, { method: 'DELETE', headers: { authorization: `Bearer ${await accessToken(env, session.user.id)}` } });
  if (!response.ok && response.status !== 404) throw new HttpError(502, 'Google Calendar could not remove this event.', 'calendar_unavailable');
  await env.DB.prepare('DELETE FROM calendar_events WHERE id=? AND user_id=?').bind(event.id, session.user.id).run();
  return json({ removed: true });
}

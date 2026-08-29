import type { AuthSession } from './auth';
import { requireSession } from './authorization';
import type { Env } from './env';
import { body, HttpError, json, string } from './http';

export async function getProfile(env: Env, session: AuthSession | null): Promise<Response> {
  requireSession(session);
  const user = await env.DB.prepare('SELECT id, name, email, image, emailVerified, createdAt FROM user WHERE id = ?').bind(session.user.id).first();
  return json({ user });
}

export async function updateProfile(request: Request, env: Env, session: AuthSession | null): Promise<Response> {
  requireSession(session);
  const input = await body<{ name?: unknown; image?: unknown }>(request);
  const name = string(input.name, 'Name', { min: 1, max: 120 });
  const image = input.image == null || input.image === '' ? null : string(input.image, 'Profile image', { max: 2000 });
  if (image && !/^https:\/\//i.test(image)) throw new HttpError(400, 'Profile image must use HTTPS.', 'invalid_input');
  await env.DB.prepare('UPDATE user SET name = ?, image = ?, updatedAt = ? WHERE id = ?').bind(name, image, Date.now(), session.user.id).run();
  return getProfile(env, session);
}

export async function listNotifications(env: Env, session: AuthSession | null): Promise<Response> {
  requireSession(session);
  const rows = await env.DB.prepare('SELECT id, club_id, kind, payload_json, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').bind(session.user.id).all();
  return json({ notifications: rows.results.map((row) => ({ ...row, payload: JSON.parse(String((row as { payload_json: string }).payload_json || '{}')) })) });
}

export async function markNotificationRead(env: Env, session: AuthSession | null, notificationId: string): Promise<Response> {
  requireSession(session);
  await env.DB.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?').bind(Date.now(), notificationId, session.user.id).run();
  return json({ read: true });
}

export async function markAllNotificationsRead(env: Env, session: AuthSession | null): Promise<Response> {
  requireSession(session);
  await env.DB.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').bind(Date.now(), session.user.id).run();
  return json({ read: true });
}

export async function exportMyData(env: Env, session: AuthSession | null): Promise<Response> {
  requireSession(session);
  const userId = session.user.id;
  const [profile, settings, memberships, library, posts, replies, margins, ratings, rsvps] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, email, image, emailVerified, createdAt, updatedAt FROM user WHERE id=?').bind(userId),
    env.DB.prepare('SELECT username, profile_style_json, notification_mode, reading_avoidances_json, reading_moods_json, timezone, updated_at FROM user_settings WHERE user_id=?').bind(userId),
    env.DB.prepare('SELECT club_id, role, joined_at FROM club_memberships WHERE user_id=?').bind(userId),
    env.DB.prepare('SELECT id, title, author, cover_url, isbn, pages, published_year, shelf, rating, date_finished, is_favorite, is_public, source, created_at, updated_at FROM personal_library WHERE user_id=?').bind(userId),
    env.DB.prepare('SELECT id, club_id, book_id, body, post_type, chapter, locked, created_at, updated_at FROM discussion_posts WHERE author_id=?').bind(userId),
    env.DB.prepare('SELECT id, club_id, post_id, body, created_at, updated_at FROM discussion_replies WHERE author_id=?').bind(userId),
    env.DB.prepare('SELECT id, club_id, book_id, kind, body, note, chapter, page, created_at, updated_at FROM reader_margins WHERE user_id=?').bind(userId),
    env.DB.prepare('SELECT club_id, book_id, rating, review, recommend, created_at, updated_at FROM book_ratings WHERE user_id=?').bind(userId),
    env.DB.prepare('SELECT meeting_id, club_id, status, updated_at FROM meeting_rsvps WHERE user_id=?').bind(userId),
  ]);
  return json({ exportedAt: new Date().toISOString(), profile: profile.results[0] ?? null, settings: settings.results[0] ?? null,
    memberships: memberships.results, personalBooks: library.results, posts: posts.results, replies: replies.results, margins: margins.results,
    clubRatings: ratings.results, meetingRsvps: rsvps.results });
}

export async function deleteMyAccount(env: Env, session: AuthSession | null): Promise<Response> {
  requireSession(session);
  const owned = await env.DB.prepare("SELECT club_id FROM club_memberships WHERE user_id=? AND role='owner' LIMIT 1").bind(session.user.id).first<{ club_id: string }>();
  if (owned) throw new HttpError(409, 'Transfer ownership of your club before deleting your account.', 'owner_required');
  await env.DB.prepare('DELETE FROM user WHERE id=?').bind(session.user.id).run();
  return json({ deleted: true });
}

export async function cacheContext(request: Request, env: Env, session: AuthSession | null, clubId: string): Promise<Response> {
  requireSession(session);
  const input = await body<{ key?: unknown; value?: unknown; expiresAt?: unknown }>(request);
  const key = string(input.key, 'Cache key', { min: 1, max: 200 });
  const value = JSON.stringify(input.value ?? {});
  if (value.length > 100_000) throw new HttpError(413, 'Context is too large to cache.', 'payload_too_large');
  const expiresAt = typeof input.expiresAt === 'number' && input.expiresAt > Date.now() ? input.expiresAt : Date.now() + 24 * 60 * 60 * 1000;
  const member = await env.DB.prepare('SELECT 1 FROM club_memberships WHERE club_id = ? AND user_id = ?').bind(clubId, session.user.id).first();
  if (!member) throw new HttpError(403, 'You do not have permission to cache context for this club.', 'forbidden');
  await env.DB.prepare('INSERT INTO ai_context_cache (cache_key, club_id, value_json, expires_at, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET value_json=excluded.value_json, expires_at=excluded.expires_at').bind(`${clubId}:${key}`, clubId, value, expiresAt, Date.now()).run();
  return json({ cached: true, expiresAt });
}

export async function getContext(env: Env, session: AuthSession | null, clubId: string, keyInput: string): Promise<Response> {
  requireSession(session);
  const member = await env.DB.prepare('SELECT 1 FROM club_memberships WHERE club_id = ? AND user_id = ?').bind(clubId, session.user.id).first();
  if (!member) throw new HttpError(403, 'You do not have permission to read this club context.', 'forbidden');
  const row = await env.DB.prepare('SELECT value_json, expires_at FROM ai_context_cache WHERE cache_key = ? AND club_id = ? AND expires_at > ?').bind(`${clubId}:${keyInput}`, clubId, Date.now()).first<{ value_json: string; expires_at: number }>();
  return json({ value: row ? JSON.parse(row.value_json) : null, expiresAt: row?.expires_at ?? null });
}

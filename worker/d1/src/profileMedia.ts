import type { AuthSession } from './auth';
import { requireSession } from './authorization';
import type { Env } from './env';
import { body, HttpError, json } from './http';

type ProfileMediaKind = 'avatar' | 'wallpaper';
type ProfileStyle = Record<string, unknown>;
type StoredProfileObject = { object_key: string; user_id: string; kind: ProfileMediaKind; byte_size: number; state: 'pending' | 'active' | 'deleting' };

const MAX_AVATAR_BYTES = 90 * 1024;
const MAX_WALLPAPER_BYTES = 260 * 1024;
const PROFILE_RESERVATION_TTL = 15 * 60 * 1000;
const PROFILE_KEY = /^profile-media\/([0-9a-f-]{36})\/(avatar|wallpaper)\/([0-9a-f-]{36})\.webp$/i;
const PROFILE_URL = /^\/api\/profile-media\/([0-9a-f-]{36})\/(avatar|wallpaper)\/([0-9a-f-]{36})$/i;
const decoder = new TextDecoder();

function storageCap(env: Env): number {
  const configured = Number(env.R2_MAX_STORAGE_BYTES ?? 500 * 1024 * 1024);
  return Number.isSafeInteger(configured) && configured > 0 ? Math.min(configured, 500 * 1024 * 1024) : 500 * 1024 * 1024;
}

function kindOf(value: string): ProfileMediaKind {
  if (value === 'avatar' || value === 'wallpaper') return value;
  throw new HttpError(400, 'That profile image type is not supported.', 'invalid_media_kind');
}

function maxBytes(kind: ProfileMediaKind): number { return kind === 'avatar' ? MAX_AVATAR_BYTES : MAX_WALLPAPER_BYTES; }

function validWebp(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12 && decoder.decode(bytes.slice(0, 4)) === 'RIFF' && decoder.decode(bytes.slice(8, 12)) === 'WEBP';
}

function dataUrlBytes(value: string, kind: ProfileMediaKind): Uint8Array {
  const match = /^data:(image\/webp);base64,([A-Za-z0-9+/=_-]+)$/i.exec(value);
  if (!match) throw new HttpError(415, 'Profile images must be optimized WebP files.', 'unsupported_media');
  const encoded = match[2].replace(/-/g, '+').replace(/_/g, '/');
  let decoded: string;
  try { decoded = atob(encoded); } catch { throw new HttpError(415, 'The profile image could not be decoded.', 'invalid_media'); }
  if (decoded.length > maxBytes(kind)) throw new HttpError(413, 'That profile image is larger than the allowed limit.', 'media_too_large');
  const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0));
  if (!validWebp(bytes)) throw new HttpError(415, 'The uploaded file is not a valid WebP image.', 'invalid_media');
  return bytes;
}

function keyFor(userId: string, kind: ProfileMediaKind, version: string): string {
  return `profile-media/${userId}/${kind}/${version}.webp`;
}

function urlFor(userId: string, kind: ProfileMediaKind, version: string): string {
  return `/api/profile-media/${userId}/${kind}/${version}`;
}

function keyFromUrl(value: string, userId: string, kind: ProfileMediaKind): string | null {
  const match = PROFILE_URL.exec(value);
  if (!match || match[1].toLowerCase() !== userId.toLowerCase() || match[2] !== kind) return null;
  return keyFor(userId, kind, match[3]);
}

async function reserve(env: Env, userId: string, kind: ProfileMediaKind, objectKey: string, byteSize: number, now: number): Promise<void> {
  const result = await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO media_storage_usage (bucket, used_bytes, updated_at) VALUES ('profile_media', 0, ?)").bind(now),
    env.DB.prepare("UPDATE media_storage_usage SET used_bytes = used_bytes + ?, updated_at = ? WHERE bucket = 'profile_media' AND used_bytes <= ? - ?").bind(byteSize, now, storageCap(env), byteSize),
    env.DB.prepare("INSERT INTO profile_media_objects (object_key, user_id, kind, byte_size, state, reserved_at, updated_at) SELECT ?, ?, ?, ?, 'pending', ?, ? WHERE changes() = 1").bind(objectKey, userId, kind, byteSize, now, now),
  ]);
  if (Number(result[1].meta.changes ?? 0) !== 1 || Number(result[2].meta.changes ?? 0) !== 1) {
    await env.DB.batch([
      env.DB.prepare("UPDATE media_storage_usage SET used_bytes = MAX(used_bytes - ?, 0), updated_at = ? WHERE bucket = 'profile_media' AND changes() = 1").bind(byteSize, now),
      env.DB.prepare('DELETE FROM profile_media_objects WHERE object_key = ? AND state = \'pending\'').bind(objectKey),
    ]);
    throw new HttpError(413, 'Image storage limit reached. This app safely stops new media uploads at 500 MB.', 'media_storage_limit_reached');
  }
}

async function object(env: Env, objectKey: string): Promise<StoredProfileObject | null> {
  return env.DB.prepare('SELECT object_key, user_id, kind, byte_size, state FROM profile_media_objects WHERE object_key = ?').bind(objectKey).first<StoredProfileObject>();
}

async function removeObject(env: Env, objectKey: string): Promise<void> {
  const found = await object(env, objectKey);
  if (!found) return;
  await env.DB.prepare("UPDATE profile_media_objects SET state = 'deleting', updated_at = ? WHERE object_key = ? AND state != 'deleting'").bind(Date.now(), objectKey).run();
  try { await env.MEDIA.delete(objectKey); } catch { return; }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM profile_media_objects WHERE object_key = ? AND state = 'deleting'").bind(objectKey),
    env.DB.prepare("UPDATE media_storage_usage SET used_bytes = MAX(used_bytes - ?, 0), updated_at = ? WHERE bucket = 'profile_media' AND changes() = 1").bind(found.byte_size, Date.now()),
  ]);
}

async function canRead(env: Env, session: AuthSession, userId: string): Promise<boolean> {
  if (session.user.id === userId) return true;
  const member = await env.DB.prepare(`SELECT 1 FROM club_memberships mine JOIN club_memberships theirs ON theirs.club_id = mine.club_id
    WHERE mine.user_id = ? AND theirs.user_id = ? LIMIT 1`).bind(session.user.id, userId).first();
  return Boolean(member);
}

function cleanStyle(input: unknown): ProfileStyle {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'A valid profile style is required.', 'invalid_input');
  const style = { ...(input as ProfileStyle) };
  for (const kind of ['avatarUrl', 'wallpaperUrl'] as const) {
    const value = style[kind];
    if (value !== undefined && value !== null && typeof value !== 'string') throw new HttpError(400, 'Profile image references must be strings.', 'invalid_input');
  }
  return style;
}

export async function updateProfileStyle(request: Request, env: Env, session: AuthSession | null): Promise<Response> {
  requireSession(session);
  const input = await body<{ style?: unknown }>(request);
  const style = cleanStyle(input.style);
  const userId = session.user.id;
  const now = Date.now();
  const current = await env.DB.prepare('SELECT kind, object_key FROM profile_media WHERE user_id = ?').bind(userId).all<{ kind: ProfileMediaKind; object_key: string }>();
  const currentByKind = new Map(current.results.map(row => [row.kind, row.object_key]));
  const pending: Array<{ kind: ProfileMediaKind; key: string; bytes: number }> = [];
  const normalized: ProfileStyle = { ...style };
  const replaced: string[] = [];

  try {
    for (const kind of ['avatar', 'wallpaper'] as const) {
      const field = `${kind}Url` as const;
      const value = normalized[field];
      if (typeof value === 'string' && value.startsWith('data:')) {
        const bytes = dataUrlBytes(value, kind);
        const version = crypto.randomUUID();
        const key = keyFor(userId, kind, version);
        await reserve(env, userId, kind, key, bytes.byteLength, now);
        try {
          await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: 'image/webp', cacheControl: 'private, max-age=31536000, immutable' }, customMetadata: { userId, kind } });
        } catch (error) {
          await removeObject(env, key);
          throw error;
        }
        pending.push({ kind, key, bytes: bytes.byteLength });
        normalized[field] = urlFor(userId, kind, version);
      }
      const nextKey = typeof normalized[field] === 'string' ? keyFromUrl(normalized[field] as string, userId, kind) : null;
      const oldKey = currentByKind.get(kind);
      if (nextKey && nextKey !== oldKey) {
        const next = await object(env, nextKey);
        if (!next || next.state !== 'active' && !pending.some(item => item.key === nextKey)) throw new HttpError(400, 'That profile image is no longer available.', 'invalid_media_reference');
      }
      if (oldKey && oldKey !== nextKey && (Object.prototype.hasOwnProperty.call(normalized, field) || pending.some(item => item.kind === kind))) replaced.push(oldKey);
    }

    const styleJson = JSON.stringify(normalized);
    if (styleJson.length > 50_000) throw new HttpError(413, 'Profile design is too large to save.', 'payload_too_large');
    const settings = await env.DB.prepare('SELECT username, notification_mode, reading_avoidances_json, reading_moods_json, timezone FROM user_settings WHERE user_id = ?').bind(userId).first<Record<string, string | null>>();
    const statements = [env.DB.prepare(`INSERT INTO user_settings (user_id, username, profile_style_json, notification_mode, reading_avoidances_json, reading_moods_json, timezone, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET profile_style_json=excluded.profile_style_json, updated_at=excluded.updated_at`).bind(
      userId, settings?.username ?? null, styleJson, settings?.notification_mode ?? 'essential', settings?.reading_avoidances_json ?? '[]', settings?.reading_moods_json ?? '[]', settings?.timezone ?? null, now)];
    for (const item of pending) {
      statements.push(env.DB.prepare(`INSERT INTO profile_media (user_id, kind, object_key, byte_size, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, kind) DO UPDATE SET object_key=excluded.object_key, byte_size=excluded.byte_size, updated_at=excluded.updated_at`).bind(userId, item.kind, item.key, item.bytes, now));
      statements.push(env.DB.prepare("UPDATE profile_media_objects SET state = 'active', updated_at = ? WHERE object_key = ? AND state = 'pending'").bind(now, item.key));
    }
    await env.DB.batch(statements);
  } catch (error) {
    for (const item of pending) await removeObject(env, item.key);
    throw error;
  }
  // Clear any old pointer before deleting the object. This matters when a
  // user removes an image or switches back to a built-in style: the foreign
  // key must not keep the old object alive (or block its deletion).
  for (const oldKey of replaced) {
    await env.DB.prepare('DELETE FROM profile_media WHERE user_id = ? AND object_key = ?').bind(userId, oldKey).run();
    await removeObject(env, oldKey);
  }
  return json({ style: normalized });
}

export async function serveProfileMedia(env: Env, session: AuthSession | null, userId: string, kindInput: string, version: string): Promise<Response> {
  requireSession(session);
  const kind = kindOf(kindInput);
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^[0-9a-f-]{36}$/i.test(version)) throw new HttpError(404, 'Media not found.', 'not_found');
  if (!await canRead(env, session, userId)) throw new HttpError(403, 'You do not have permission to view this profile image.', 'forbidden');
  const key = keyFor(userId, kind, version);
  const stored = await object(env, key);
  if (!stored || stored.state !== 'active') throw new HttpError(404, 'Media not found.', 'not_found');
  const image = await env.MEDIA.get(key);
  if (!image) throw new HttpError(404, 'Media not found.', 'not_found');
  const headers = new Headers();
  image.writeHttpMetadata(headers);
  headers.set('etag', image.httpEtag);
  headers.set('cache-control', 'private, max-age=31536000, immutable');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(image.body, { headers });
}

export async function cleanupProfileMedia(env: Env): Promise<void> {
  const cutoff = Date.now() - PROFILE_RESERVATION_TTL;
  const stale = await env.DB.prepare("SELECT object_key FROM profile_media_objects WHERE state IN ('pending', 'deleting') AND updated_at < ? ORDER BY updated_at ASC LIMIT 50").bind(cutoff).all<{ object_key: string }>();
  for (const row of stale.results) await removeObject(env, row.object_key);
}

export function profileMediaPath(pathname: string): { userId: string; kind: string; version: string } | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length !== 5 || parts[0] !== 'api' || parts[1] !== 'profile-media') return null;
  const key = `profile-media/${parts[2]}/${parts[3]}/${parts[4]}.webp`;
  const match = PROFILE_KEY.exec(key);
  return match ? { userId: match[1], kind: match[2], version: match[3] } : null;
}

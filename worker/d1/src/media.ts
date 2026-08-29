import type { AuthSession } from './auth';
import { requireMember, requireSession } from './authorization';
import type { Env } from './env';
import { HttpError, json } from './http';

const MAX_HEADER_BYTES = 350 * 1024;
const HARD_STORAGE_CAP_BYTES = 500 * 1024 * 1024;
const MAX_UPLOADS_PER_CLUB_PER_HOUR = 5;
const MEDIA_URL_TTL = 15 * 60 * 1000;
const RESERVATION_TTL = 15 * 60 * 1000;
const HEADER_PATH = /^clubs\/([0-9a-f-]{36})\/headers\/([0-9a-f-]{36})\.webp$/i;
const decoder = new TextDecoder();

type MediaObject = {
  object_key: string;
  club_id: string;
  byte_size: number;
  state: 'pending' | 'active' | 'deleting';
  rate_window_started_at: number;
  rate_slot_held: number;
};

function changes(result: D1Result<unknown>): number { return Number(result.meta.changes ?? 0); }
function rateWindow(now: number): number { return Math.floor(now / 3_600_000) * 3_600_000; }

// A malformed or accidentally raised environment value cannot weaken the
// financial safety guarantee. 500 MB is always the absolute upper bound.
export function storageCap(env: Env): number {
  const configured = Number(env.R2_MAX_STORAGE_BYTES ?? HARD_STORAGE_CAP_BYTES);
  if (!Number.isSafeInteger(configured) || configured < MAX_HEADER_BYTES) return HARD_STORAGE_CAP_BYTES;
  return Math.min(configured, HARD_STORAGE_CAP_BYTES);
}

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function boundedBody(request: Request): Promise<Uint8Array> {
  const declaredSize = Number(request.headers.get('content-length') ?? 0);
  if (declaredSize && (!Number.isSafeInteger(declaredSize) || declaredSize > MAX_HEADER_BYTES)) throw new HttpError(413, 'Club header images must be 350 KB or smaller.', 'media_too_large');
  if (!request.body) throw new HttpError(400, 'Choose an image to upload.', 'missing_media');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_HEADER_BYTES) {
        await reader.cancel();
        throw new HttpError(413, 'Club header images must be 350 KB or smaller.', 'media_too_large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new HttpError(400, 'Choose an image to upload.', 'missing_media');
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

function validWebp(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12 && decoder.decode(bytes.slice(0, 4)) === 'RIFF' && decoder.decode(bytes.slice(8, 12)) === 'WEBP';
}

async function reserveUpload(env: Env, clubId: string, objectKey: string, byteSize: number, now: number): Promise<void> {
  const window = rateWindow(now);
  await env.DB.prepare("INSERT OR IGNORE INTO media_storage_usage (bucket, used_bytes, updated_at) VALUES ('club_headers', 0, ?)").bind(now).run();
  const result = await env.DB.batch([
    env.DB.prepare(`INSERT INTO media_upload_rate_limits (club_id, window_started_at, upload_count) VALUES (?, ?, 1)
      ON CONFLICT(club_id, window_started_at) DO UPDATE SET upload_count = upload_count + 1 WHERE upload_count < ?`).bind(clubId, window, MAX_UPLOADS_PER_CLUB_PER_HOUR),
    env.DB.prepare(`UPDATE media_storage_usage SET used_bytes = used_bytes + ?, updated_at = ?
      WHERE bucket = 'club_headers' AND used_bytes <= ? - ? AND changes() = 1`).bind(byteSize, now, storageCap(env), byteSize),
    env.DB.prepare(`INSERT INTO media_objects (object_key, club_id, byte_size, state, rate_window_started_at, rate_slot_held, reserved_at, updated_at)
      SELECT ?, ?, ?, 'pending', ?, 1, ?, ? WHERE changes() = 1`).bind(objectKey, clubId, byteSize, window, now, now),
  ]);
  if (changes(result[0]) !== 1) throw new HttpError(429, 'This club can change its header up to five times per hour. Please try again later.', 'media_rate_limited');
  if (changes(result[1]) !== 1) {
    await env.DB.prepare('UPDATE media_upload_rate_limits SET upload_count = MAX(upload_count - 1, 0) WHERE club_id = ? AND window_started_at = ?').bind(clubId, window).run();
    throw new HttpError(413, 'Image storage limit reached. This app safely stops new header uploads at 500 MB.', 'media_storage_limit_reached');
  }
  if (changes(result[2]) !== 1) {
    await env.DB.batch([
      env.DB.prepare("UPDATE media_storage_usage SET used_bytes = MAX(used_bytes - ?, 0), updated_at = ? WHERE bucket = 'club_headers'").bind(byteSize, now),
      env.DB.prepare('UPDATE media_upload_rate_limits SET upload_count = MAX(upload_count - 1, 0) WHERE club_id = ? AND window_started_at = ?').bind(clubId, window),
    ]);
    throw new HttpError(409, 'The image upload could not reserve storage. Please try again.', 'media_reservation_failed');
  }
}

async function mediaObject(env: Env, objectKey: string): Promise<MediaObject | null> {
  return env.DB.prepare('SELECT object_key, club_id, byte_size, state, rate_window_started_at, rate_slot_held FROM media_objects WHERE object_key = ?').bind(objectKey).first<MediaObject>();
}

async function releaseObject(env: Env, object: MediaObject): Promise<void> {
  // DELETE comes first. `changes() = 1` makes the decrement happen exactly
  // once if a retry and the scheduled cleanup race each other.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM media_objects WHERE object_key = ? AND state = 'deleting'").bind(object.object_key),
    env.DB.prepare("UPDATE media_storage_usage SET used_bytes = MAX(used_bytes - ?, 0), updated_at = ? WHERE bucket = 'club_headers' AND changes() = 1").bind(object.byte_size, Date.now()),
    env.DB.prepare('UPDATE media_upload_rate_limits SET upload_count = MAX(upload_count - 1, 0) WHERE club_id = ? AND window_started_at = ? AND ? = 1 AND changes() = 1').bind(object.club_id, object.rate_window_started_at, object.rate_slot_held),
  ]);
}

async function markDeleting(env: Env, objectKey: string): Promise<MediaObject | null> {
  const object = await mediaObject(env, objectKey);
  if (!object) return null;
  if (object.state !== 'deleting') await env.DB.prepare("UPDATE media_objects SET state = 'deleting', updated_at = ? WHERE object_key = ? AND state != 'deleting'").bind(Date.now(), objectKey).run();
  return object;
}

async function deleteAndRelease(env: Env, objectKey: string): Promise<void> {
  const object = await markDeleting(env, objectKey);
  if (!object) return;
  try { await env.MEDIA.delete(objectKey); }
  catch (error) {
    console.error(JSON.stringify({ event: 'media_delete_failed', objectKey, message: error instanceof Error ? error.message : 'Unknown error' }));
    return;
  }
  await releaseObject(env, object);
}

export async function uploadHeader(request: Request, env: Env, session: AuthSession | null, clubId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId, 'admin');
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'image/webp') throw new HttpError(415, 'Club headers must be optimized WebP images.', 'unsupported_media');
  const bytes = await boundedBody(request);
  if (!validWebp(bytes)) throw new HttpError(415, 'The uploaded file is not a valid WebP image.', 'invalid_media');

  const previous = await env.DB.prepare('SELECT cover_key FROM clubs WHERE id = ?').bind(clubId).first<{ cover_key: string | null }>();
  const key = `clubs/${clubId}/headers/${crypto.randomUUID()}.webp`;
  const now = Date.now();
  await reserveUpload(env, clubId, key, bytes.byteLength, now);
  try {
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: 'image/webp', cacheControl: 'private, max-age=31536000, immutable' }, customMetadata: { clubId, uploadedBy: session.user.id } });
    const committed = await env.DB.batch([
      env.DB.prepare('UPDATE clubs SET cover_key = ?, updated_at = ? WHERE id = ? AND cover_key IS ?').bind(key, now, clubId, previous?.cover_key ?? null),
      env.DB.prepare("UPDATE media_objects SET state = 'active', rate_slot_held = 0, updated_at = ? WHERE object_key = ? AND state = 'pending' AND changes() = 1").bind(now, key),
    ]);
    if (changes(committed[0]) !== 1 || changes(committed[1]) !== 1) {
      await env.DB.prepare('UPDATE clubs SET cover_key = ? WHERE id = ? AND cover_key = ?').bind(previous?.cover_key ?? null, clubId, key).run();
      await deleteAndRelease(env, key);
      throw new HttpError(409, 'Another header update finished first. Please try again.', 'media_update_conflict');
    }
  } catch (error) {
    if (await mediaObject(env, key)) await deleteAndRelease(env, key);
    throw error;
  }
  if (previous?.cover_key && HEADER_PATH.test(previous.cover_key)) await deleteAndRelease(env, previous.cover_key);
  return json({ key, url: await issueHeaderUrl(env, session, clubId) }, 201);
}

export async function resetHeader(env: Env, session: AuthSession | null, clubId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId, 'admin');
  const club = await env.DB.prepare('SELECT cover_key FROM clubs WHERE id=?').bind(clubId).first<{ cover_key: string | null }>();
  if (!club) throw new HttpError(404, 'Club not found.', 'not_found');
  await env.DB.prepare('UPDATE clubs SET cover_key=NULL, updated_at=? WHERE id=?').bind(Date.now(), clubId).run();
  if (club.cover_key && HEADER_PATH.test(club.cover_key)) await deleteAndRelease(env, club.cover_key);
  return json({ reset: true });
}

export async function issueHeaderUrl(env: Env, session: AuthSession | null, clubId: string): Promise<string> {
  requireSession(session); await requireMember(env, session, clubId);
  const club = await env.DB.prepare('SELECT cover_key FROM clubs WHERE id = ?').bind(clubId).first<{ cover_key: string | null }>();
  if (!club?.cover_key || !HEADER_PATH.test(club.cover_key)) throw new HttpError(404, 'This club has no header image.', 'not_found');
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const now = Date.now();
  await env.DB.prepare('INSERT INTO media_tokens (token_hash, club_id, object_key, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind(await digest(token), clubId, club.cover_key, now + MEDIA_URL_TTL, now).run();
  return `/api/media/${encodeURIComponent(club.cover_key)}?token=${encodeURIComponent(token)}`;
}

export async function serveMedia(request: Request, env: Env, session: AuthSession | null, key: string): Promise<Response> {
  const match = HEADER_PATH.exec(key);
  if (!match) throw new HttpError(404, 'Media not found.', 'not_found');
  const token = new URL(request.url).searchParams.get('token');
  if (token) {
    const grant = await env.DB.prepare('SELECT token_hash FROM media_tokens WHERE token_hash = ? AND club_id = ? AND object_key = ? AND expires_at > ?').bind(await digest(token), match[1], key, Date.now()).first();
    if (!grant) throw new HttpError(403, 'This media link has expired.', 'media_link_expired');
  } else await requireMember(env, session, match[1]);
  const object = await env.MEDIA.get(key);
  if (!object) throw new HttpError(404, 'Media not found.', 'not_found');
  const headers = new Headers(); object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag); headers.set('cache-control', 'private, max-age=31536000, immutable'); headers.set('x-content-type-options', 'nosniff');
  return new Response(object.body, { headers });
}

export async function cleanupMedia(env: Env): Promise<void> {
  const cutoff = Date.now() - RESERVATION_TTL;
  const stale = await env.DB.prepare("SELECT object_key FROM media_objects WHERE state IN ('pending', 'deleting') AND updated_at < ? ORDER BY updated_at ASC LIMIT 50").bind(cutoff).all<{ object_key: string }>();
  for (const object of stale.results) await deleteAndRelease(env, object.object_key);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM media_tokens WHERE expires_at < ?').bind(Date.now()),
    env.DB.prepare('DELETE FROM media_upload_rate_limits WHERE window_started_at < ?').bind(Date.now() - 2 * 3_600_000),
  ]);
}

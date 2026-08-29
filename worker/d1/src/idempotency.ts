import type { Env } from './env';
import { HttpError } from './http';
const ONE_DAY = 24 * 60 * 60 * 1000;

export async function withIdempotency<T>(env: Env, userId: string, key: string | null, operation: string, work: () => Promise<T>): Promise<T> {
  if (!key) return work();
  if (!/^[A-Za-z0-9._:-]{12,200}$/.test(key)) throw new Error('Invalid Idempotency-Key.');
  const now = Date.now();
  const claimed = await env.DB.prepare("INSERT OR IGNORE INTO idempotency_keys (key, user_id, operation, state, response_json, created_at, expires_at) VALUES (?, ?, ?, 'pending', NULL, ?, ?)").bind(key, userId, operation, now, now + ONE_DAY).run();
  if (!claimed.meta.changes) {
    const existing = await env.DB.prepare('SELECT state, response_json, expires_at FROM idempotency_keys WHERE key = ? AND user_id = ? AND operation = ?').bind(key, userId, operation).first<{ state: 'pending' | 'completed'; response_json: string | null; expires_at: number }>();
    if (existing?.state === 'completed' && existing.response_json && existing.expires_at > now) return JSON.parse(existing.response_json) as T;
    throw new HttpError(409, 'This request is already being processed. Please retry in a moment.', 'request_in_progress');
  }
  try {
    const result = await work();
    await env.DB.prepare("UPDATE idempotency_keys SET state = 'completed', response_json = ? WHERE key = ? AND user_id = ? AND operation = ?").bind(JSON.stringify(result), key, userId, operation).run();
    return result;
  } catch (error) {
    // A rejected operation must be retriable with the same key. The claim is
    // removed only for the exact user and operation that created it.
    await env.DB.prepare("DELETE FROM idempotency_keys WHERE key = ? AND user_id = ? AND operation = ? AND state = 'pending'").bind(key, userId, operation).run();
    throw error;
  }
}

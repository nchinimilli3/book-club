import type { AuthSession } from './auth';
import { requireMember, requireSession } from './authorization';
import type { Env } from './env';
import { body, HttpError, json, string } from './http';
import { withIdempotency } from './idempotency';

export async function readingRoom(env: Env, session: AuthSession | null, clubId: string, bookId: string): Promise<Response> {
  await requireMember(env, session, clubId);
  const book = await env.DB.prepare('SELECT id, club_id, title, author, cover_url, status FROM books WHERE id = ? AND club_id = ?').bind(bookId, clubId).first();
  if (!book) throw new HttpError(404, 'Book not found.', 'not_found');
  const [progress, checkpoints] = await env.DB.batch([
    env.DB.prepare('SELECT status, chapter, page, percent, format, updated_at FROM reading_progress WHERE book_id = ? AND user_id = ?').bind(bookId, session?.user.id),
    env.DB.prepare('SELECT id, label, due_at, target_chapter, target_page FROM reading_checkpoints WHERE club_id = ? AND book_id = ? ORDER BY due_at ASC LIMIT 50').bind(clubId, bookId),
  ]);
  const checkpointIds = checkpoints.results.map((row) => (row as { id: string }).id);
  const options = checkpointIds.length
    ? await env.DB.prepare(`SELECT o.id, o.checkpoint_id, o.starts_at, COUNT(v.user_id) AS available_count,
      MAX(CASE WHEN v.user_id = ? THEN 1 ELSE 0 END) AS my_available
      FROM checkpoint_options o LEFT JOIN checkpoint_votes v ON v.option_id = o.id
      WHERE o.club_id = ? GROUP BY o.id ORDER BY o.starts_at ASC LIMIT 100`).bind(session?.user.id, clubId).all()
    : { results: [] };
  return json({ book, progress: progress.results[0] ?? null, checkpoints: checkpoints.results, meetingOptions: options.results });
}

export async function saveProgress(request: Request, env: Env, session: AuthSession | null, clubId: string, bookId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId);
  const input = await body<{ status?: unknown; chapter?: unknown; page?: unknown; percent?: unknown; format?: unknown }>(request);
  const status = typeof input.status === 'string' && ['not_started', 'reading', 'finished'].includes(input.status) ? input.status : 'reading';
  const format = typeof input.format === 'string' && ['chapter', 'page', 'percent'].includes(input.format) ? input.format : null;
  const chapter = Number.isSafeInteger(input.chapter) && Number(input.chapter) >= 0 ? Number(input.chapter) : null;
  const page = Number.isSafeInteger(input.page) && Number(input.page) >= 0 ? Number(input.page) : null;
  const percent = typeof input.percent === 'number' && Number.isFinite(input.percent) ? Math.max(0, Math.min(100, input.percent)) : null;
  const book = await env.DB.prepare('SELECT id FROM books WHERE id = ? AND club_id = ?').bind(bookId, clubId).first();
  if (!book) throw new HttpError(404, 'Book not found.', 'not_found');
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO reading_progress (club_id, book_id, user_id, status, chapter, page, percent, format, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(book_id, user_id) DO UPDATE SET status=excluded.status, chapter=excluded.chapter, page=excluded.page,
    percent=excluded.percent, format=excluded.format, updated_at=excluded.updated_at`)
    .bind(clubId, bookId, session.user.id, status, chapter, page, percent, format, now).run();
  return json({ progress: { status, chapter, page, percent, format, updated_at: now } });
}

export async function createCheckpoint(request: Request, env: Env, session: AuthSession | null, clubId: string, bookId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId, 'admin');
  const input = await body<{ label?: unknown; dueAt?: unknown; targetChapter?: unknown; targetPage?: unknown }>(request);
  const dueAt = string(input.dueAt, 'Due date', { min: 8, max: 32 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) throw new HttpError(400, 'Due date must use YYYY-MM-DD.', 'invalid_input');
  const label = typeof input.label === 'string' ? input.label.trim().slice(0, 120) : '';
  const targetChapter = Number.isSafeInteger(input.targetChapter) ? Number(input.targetChapter) : null;
  const targetPage = Number.isSafeInteger(input.targetPage) ? Number(input.targetPage) : null;
  const book = await env.DB.prepare('SELECT id FROM books WHERE id = ? AND club_id = ?').bind(bookId, clubId).first();
  if (!book) throw new HttpError(404, 'Book not found.', 'not_found');
  const result = await withIdempotency(env, session.user.id, request.headers.get('idempotency-key'), `checkpoint:${bookId}`, async () => {
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO reading_checkpoints (id, club_id, book_id, label, due_at, target_chapter, target_page, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, clubId, bookId, label, dueAt, targetChapter, targetPage, session.user.id, Date.now()).run();
    return { id, label, due_at: dueAt, target_chapter: targetChapter, target_page: targetPage };
  });
  return json({ checkpoint: result }, 201);
}

export async function addCheckpointOptions(request: Request, env: Env, session: AuthSession | null, clubId: string, checkpointId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId, 'admin');
  const input = await body<{ startsAt?: unknown }>(request);
  if (!Array.isArray(input.startsAt) || input.startsAt.length < 2 || input.startsAt.length > 5) throw new HttpError(400, 'Choose between two and five meeting times.', 'invalid_input');
  const checkpoint = await env.DB.prepare('SELECT id FROM reading_checkpoints WHERE id = ? AND club_id = ?').bind(checkpointId, clubId).first();
  if (!checkpoint) throw new HttpError(404, 'Checkpoint not found.', 'not_found');
  const now = Date.now();
  const statements = input.startsAt.map((value) => {
    if (!Number.isSafeInteger(value) || Number(value) <= now) throw new HttpError(400, 'Meeting times must be future timestamps.', 'invalid_input');
    return env.DB.prepare('INSERT INTO checkpoint_options (id, checkpoint_id, club_id, starts_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), checkpointId, clubId, value, session.user.id, now);
  });
  await env.DB.batch(statements);
  return json({ created: statements.length }, 201);
}

export async function voteCheckpointOption(request: Request, env: Env, session: AuthSession | null, clubId: string, checkpointId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId);
  const input = await body<{ optionId?: unknown; available?: unknown }>(request);
  const optionId = string(input.optionId, 'Option ID', { min: 1, max: 64 });
  const option = await env.DB.prepare('SELECT id FROM checkpoint_options WHERE id = ? AND checkpoint_id = ? AND club_id = ?').bind(optionId, checkpointId, clubId).first();
  if (!option) throw new HttpError(404, 'Meeting option not found.', 'not_found');
  if (input.available === false) await env.DB.prepare('DELETE FROM checkpoint_votes WHERE option_id = ? AND user_id = ?').bind(optionId, session.user.id).run();
  else await env.DB.prepare('INSERT OR IGNORE INTO checkpoint_votes (option_id, checkpoint_id, club_id, user_id, created_at) VALUES (?, ?, ?, ?, ?)').bind(optionId, checkpointId, clubId, session.user.id, Date.now()).run();
  return json({ optionId, available: input.available !== false });
}

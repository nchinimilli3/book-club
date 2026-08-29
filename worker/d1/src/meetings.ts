import type { AuthSession } from './auth';
import { requireMember, requireSession } from './authorization';
import type { Env } from './env';
import { body, HttpError, json, string } from './http';
import { withIdempotency } from './idempotency';

type Meeting = { id: string; book_id: string | null; starts_at: number; location: string; notes: string; created_at: number; updated_at: number };

export async function listMeetings(env: Env, session: AuthSession | null, clubId: string): Promise<Response> {
  await requireMember(env, session, clubId);
  const rows = await env.DB.prepare(`SELECT m.id, m.book_id, m.starts_at, m.location, m.notes, m.created_at, m.updated_at,
    r.status AS my_rsvp, (SELECT COUNT(*) FROM meeting_rsvps rr WHERE rr.meeting_id = m.id AND rr.status = 'yes') AS yes_count
    FROM meetings m LEFT JOIN meeting_rsvps r ON r.meeting_id = m.id AND r.user_id = ?
    WHERE m.club_id = ? ORDER BY m.starts_at ASC LIMIT 50`).bind(session?.user.id, clubId).all();
  return json({ meetings: rows.results });
}

export async function createMeeting(request: Request, env: Env, session: AuthSession | null, clubId: string): Promise<Response> {
  requireSession(session);
  await requireMember(env, session, clubId, 'admin');
  const input = await body<{ startsAt?: unknown; bookId?: unknown; location?: unknown; notes?: unknown; checkpointId?: unknown; meetingType?: unknown; meetingUrl?: unknown }>(request);
  if (typeof input.startsAt !== 'number' || !Number.isSafeInteger(input.startsAt) || input.startsAt <= Date.now()) throw new HttpError(400, 'A future meeting time is required.', 'invalid_input');
  const bookId = typeof input.bookId === 'string' && input.bookId.trim() ? input.bookId.trim() : null;
  if (bookId) {
    const book = await env.DB.prepare('SELECT id FROM books WHERE id = ? AND club_id = ?').bind(bookId, clubId).first();
    if (!book) throw new HttpError(400, 'That book is not part of this club.', 'invalid_input');
  }
  const location = typeof input.location === 'string' ? input.location.trim().slice(0, 500) : '';
  const notes = typeof input.notes === 'string' ? input.notes.trim().slice(0, 2000) : '';
  const checkpointId = typeof input.checkpointId === 'string' && input.checkpointId ? input.checkpointId : null;
  if (checkpointId && !await env.DB.prepare('SELECT id FROM reading_checkpoints WHERE id=? AND club_id=?').bind(checkpointId, clubId).first()) throw new HttpError(400, 'That checkpoint is not part of this club.', 'invalid_input');
  const meetingType = typeof input.meetingType === 'string' ? input.meetingType.slice(0, 40) : 'facetime';
  const meetingUrl = typeof input.meetingUrl === 'string' ? input.meetingUrl.trim().slice(0, 2000) : null;
  const meeting = await withIdempotency(env, session.user.id, request.headers.get('idempotency-key'), `create-meeting:${clubId}`, async () => {
    const id = crypto.randomUUID(); const now = Date.now();
    await env.DB.prepare('INSERT INTO meetings (id, club_id, book_id, checkpoint_id, starts_at, location, notes, meeting_type, meeting_url, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, clubId, bookId, checkpointId, input.startsAt, location, notes, meetingType, meetingUrl, session.user.id, now, now).run();
    return { id, book_id: bookId, checkpoint_id: checkpointId, starts_at: input.startsAt, location, notes, meeting_type: meetingType, meeting_url: meetingUrl, created_at: now, updated_at: now };
  });
  return json({ meeting }, 201);
}

export async function updateMeeting(request: Request, env: Env, session: AuthSession | null, clubId: string, meetingId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId, 'admin');
  const input = await body<{ startsAt?: unknown; location?: unknown; notes?: unknown; checkpointId?: unknown; meetingType?: unknown; meetingUrl?: unknown }>(request);
  if (typeof input.startsAt !== 'number' || !Number.isSafeInteger(input.startsAt) || input.startsAt <= Date.now()) throw new HttpError(400, 'A future meeting time is required.', 'invalid_input');
  const checkpointId = typeof input.checkpointId === 'string' && input.checkpointId ? input.checkpointId : null;
  if (checkpointId && !await env.DB.prepare('SELECT id FROM reading_checkpoints WHERE id=? AND club_id=?').bind(checkpointId, clubId).first()) throw new HttpError(400, 'That checkpoint is not part of this club.', 'invalid_input');
  const changed = await env.DB.prepare(`UPDATE meetings SET checkpoint_id=?, starts_at=?, location=?, notes=?, meeting_type=?, meeting_url=?, updated_at=?
    WHERE id=? AND club_id=? AND status!='cancelled'`).bind(checkpointId, input.startsAt, typeof input.location === 'string' ? input.location.trim().slice(0, 500) : '', typeof input.notes === 'string' ? input.notes.trim().slice(0, 2000) : '', typeof input.meetingType === 'string' ? input.meetingType.slice(0, 40) : 'facetime', typeof input.meetingUrl === 'string' ? input.meetingUrl.trim().slice(0, 2000) : null, Date.now(), meetingId, clubId).run();
  if (!Number(changed.meta.changes)) throw new HttpError(404, 'Meeting not found.', 'not_found');
  return json({ id: meetingId, updated: true });
}

export async function setRsvp(request: Request, env: Env, session: AuthSession | null, clubId: string, meetingId: string): Promise<Response> {
  requireSession(session);
  await requireMember(env, session, clubId);
  const input = await body<{ status?: unknown }>(request);
  const status = string(input.status, 'RSVP status', { min: 2, max: 5 });
  if (!['yes', 'no', 'maybe'].includes(status)) throw new HttpError(400, 'RSVP status must be yes, no, or maybe.', 'invalid_input');
  const meeting = await env.DB.prepare('SELECT id FROM meetings WHERE id = ? AND club_id = ?').bind(meetingId, clubId).first();
  if (!meeting) throw new HttpError(404, 'Meeting not found.', 'not_found');
  await env.DB.prepare(`INSERT INTO meeting_rsvps (meeting_id, club_id, user_id, status, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(meeting_id, user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`)
    .bind(meetingId, clubId, session.user.id, status, Date.now()).run();
  return json({ meetingId, status });
}

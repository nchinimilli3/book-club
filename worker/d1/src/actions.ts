import type { AuthSession } from './auth';
import { requireMember, requireSession } from './authorization';
import type { Env } from './env';
import { body, HttpError, json, string } from './http';

type BookRow = { id: string; club_id: string; created_by: string; status: string; total_chapters: number | null; total_pages: number | null };

function randomIndex(length: number): number {
  if (length < 1) throw new Error('Cannot choose from an empty list.');
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % length;
}

async function bookForAction(env: Env, bookId: string): Promise<BookRow> {
  const book = await env.DB.prepare('SELECT id, club_id, created_by, status, total_chapters, total_pages FROM books WHERE id=?').bind(bookId).first<BookRow>();
  if (!book) throw new HttpError(404, 'Book not found.', 'not_found');
  return book;
}

async function clubForPost(env: Env, postId: string) {
  const post = await env.DB.prepare('SELECT id, club_id, author_id FROM discussion_posts WHERE id=?').bind(postId).first<{ id: string; club_id: string; author_id: string }>();
  if (!post) throw new HttpError(404, 'Discussion post not found.', 'not_found');
  return post;
}

export async function bookAction(request: Request, env: Env, session: AuthSession | null, bookId: string): Promise<Response> {
  requireSession(session);
  const book = await bookForAction(env, bookId);
  const input = await body<{ action?: unknown; format?: unknown; finishDate?: unknown; chapters?: unknown; pages?: unknown }>(request);
  const action = string(input.action, 'Action', { min: 1, max: 40 });
  const role = await requireMember(env, session, book.club_id);
  const isManager = role === 'owner' || role === 'admin';
  const now = Date.now();

  if (action === 'remove_suggestion') {
    if (!isManager && book.created_by !== session.user.id) throw new HttpError(403, 'Only the person who suggested this book or a club admin can remove it.', 'forbidden');
    if (!['suggested', 'ballot'].includes(book.status)) throw new HttpError(409, 'Only an active suggestion can be removed.', 'invalid_state');
    await env.DB.prepare('DELETE FROM books WHERE id=? AND club_id=?').bind(bookId, book.club_id).run();
    return json({ removed: true });
  }
  if (action === 'acquire') {
    const format = typeof input.format === 'string' ? input.format.slice(0, 80) : 'Physical';
    await env.DB.prepare(`INSERT INTO reading_progress (club_id, book_id, user_id, status, format, updated_at) VALUES (?, ?, ?, 'not_started', ?, ?)
      ON CONFLICT(book_id, user_id) DO UPDATE SET format=excluded.format, updated_at=excluded.updated_at`).bind(book.club_id, bookId, session.user.id, format, now).run();
    return json({ acquired: true, format });
  }
  if (action === 'start_reading') {
    if (!isManager) throw new HttpError(403, 'Only club admins can start the reading plan.', 'forbidden');
    const finishDate = string(input.finishDate, 'Finish date', { min: 8, max: 32 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(finishDate)) throw new HttpError(400, 'Finish date must use YYYY-MM-DD.', 'invalid_input');
    const chapters = Number.isSafeInteger(input.chapters) && Number(input.chapters) > 0 ? Number(input.chapters) : null;
    const pages = Number.isSafeInteger(input.pages) && Number(input.pages) > 0 ? Number(input.pages) : null;
    const startDate = new Date().toISOString().slice(0, 10);
    const statements: D1PreparedStatement[] = [
      env.DB.prepare("UPDATE books SET status='current', start_date=?, target_finish_date=?, total_chapters=?, total_pages=?, updated_at=? WHERE id=? AND club_id=?")
        .bind(startDate, finishDate, chapters, pages, now, bookId, book.club_id),
      env.DB.prepare("UPDATE books SET status='suggested', updated_at=? WHERE club_id=? AND status='ballot' AND id<>?").bind(now, book.club_id, bookId),
      env.DB.prepare("UPDATE ballots SET status='finalized', finalized_book_id=?, updated_at=? WHERE club_id=? AND status='open'").bind(bookId, now, book.club_id),
      env.DB.prepare('DELETE FROM reading_checkpoints WHERE book_id=?').bind(bookId),
    ];
    const start = new Date(`${startDate}T12:00:00Z`).getTime(); const end = new Date(`${finishDate}T12:00:00Z`).getTime();
    for (let position = 1; position <= 4; position++) {
      const due = new Date(start + Math.max(0, end - start) * position / 4).toISOString().slice(0, 10);
      statements.push(env.DB.prepare('INSERT INTO reading_checkpoints (id, club_id, book_id, label, due_at, target_chapter, target_page, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), book.club_id, bookId, `Checkpoint ${position}`, due, chapters ? Math.ceil(chapters * position / 4) : null, pages ? Math.ceil(pages * position / 4) : null, session.user.id, now));
    }
    await env.DB.batch(statements);
    return json({ started: true });
  }
  if (action === 'finish' || action === 'archive' || action === 'restore') {
    if (!isManager) throw new HttpError(403, 'Only club admins can change this book’s club status.', 'forbidden');
    const status = action === 'finish' ? 'completed' : action === 'archive' ? 'archived' : 'completed';
    await env.DB.prepare('UPDATE books SET status=?, updated_at=? WHERE id=? AND club_id=?').bind(status, now, bookId, book.club_id).run();
    return json({ status });
  }
  throw new HttpError(400, 'Unknown book action.', 'invalid_input');
}

export async function postAction(request: Request, env: Env, session: AuthSession | null, postId: string): Promise<Response> {
  requireSession(session);
  const post = await clubForPost(env, postId); const role = await requireMember(env, session, post.club_id);
  const input = await body<{ action?: unknown }>(request); const action = string(input.action, 'Action', { min: 1, max: 40 });
  if (action !== 'reveal_prediction') throw new HttpError(400, 'Unknown post action.', 'invalid_input');
  if (post.author_id !== session.user.id && role !== 'owner' && role !== 'admin') throw new HttpError(403, 'Only the author or a club admin can reveal this prediction.', 'forbidden');
  await env.DB.prepare('UPDATE discussion_posts SET locked=0, revealed_at=?, updated_at=? WHERE id=? AND club_id=?').bind(Date.now(), Date.now(), postId, post.club_id).run();
  return json({ revealed: true });
}

export async function checkpointCheckin(request: Request, env: Env, session: AuthSession | null, checkpointId: string): Promise<Response> {
  requireSession(session);
  const checkpoint = await env.DB.prepare('SELECT club_id FROM reading_checkpoints WHERE id=?').bind(checkpointId).first<{ club_id: string }>();
  if (!checkpoint) throw new HttpError(404, 'Checkpoint not found.', 'not_found');
  await requireMember(env, session, checkpoint.club_id);
  const input = await body<{ status?: unknown }>(request); const status = string(input.status, 'Check-in status', { min: 1, max: 32 });
  if (!['reached', 'catching_up', 'not_yet'].includes(status)) throw new HttpError(400, 'Choose a valid check-in status.', 'invalid_input');
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO checkpoint_checkins (checkpoint_id, club_id, user_id, status, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(checkpoint_id, user_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at`).bind(checkpointId, checkpoint.club_id, session.user.id, status, now).run();
  return json({ checkpointId, status, updatedAt: now });
}

export async function finalizeBallotAction(_request: Request, env: Env, session: AuthSession | null, ballotId: string): Promise<Response> {
  requireSession(session);
  const ballot = await env.DB.prepare('SELECT club_id, status, finalized_book_id FROM ballots WHERE id=?').bind(ballotId).first<{ club_id: string; status: string; finalized_book_id: string | null }>();
  if (!ballot) throw new HttpError(404, 'Ballot not found.', 'not_found');
  await requireMember(env, session, ballot.club_id, 'admin');
  if (ballot.status === 'finalized' && ballot.finalized_book_id) return json({ bookId: ballot.finalized_book_id, tieBreak: null, alreadyFinalized: true });
  if (ballot.status !== 'open') throw new HttpError(409, 'This ballot is no longer open.', 'ballot_closed');
  const [candidateRows, rankingRows] = await env.DB.batch([
    env.DB.prepare('SELECT book_id FROM ballot_books WHERE ballot_id=? ORDER BY book_id ASC').bind(ballotId),
    env.DB.prepare('SELECT user_id, book_id, rank FROM ballot_rankings WHERE ballot_id=? ORDER BY user_id, rank').bind(ballotId),
  ]);
  const candidates = candidateRows.results.map(row => String((row as { book_id: string }).book_id));
  if (!candidates.length) throw new HttpError(409, 'This ballot has no candidates.', 'invalid_state');
  const rankings = new Map<string, string[]>();
  for (const row of rankingRows.results as { user_id: string; book_id: string; rank: number }[]) rankings.set(row.user_id, [...(rankings.get(row.user_id) || []), row.book_id]);
  const active = new Set(candidates); let finalTie = [...active];
  while (active.size > 1) {
    const tally = new Map([...active].map(candidate => [candidate, 0])); let counted = 0;
    for (const ranked of rankings.values()) { const choice = ranked.find(candidate => active.has(candidate)); if (choice) { tally.set(choice, (tally.get(choice) || 0) + 1); counted++; } }
    const ordered = [...active].sort((left, right) => (tally.get(right) || 0) - (tally.get(left) || 0) || left.localeCompare(right));
    const leader = ordered[0]; const leaderVotes = tally.get(leader) || 0;
    if (counted > 0 && leaderVotes > counted / 2) { finalTie = [leader]; break; }
    const minimum = Math.min(...ordered.map(candidate => tally.get(candidate) || 0)); const eliminated = ordered.filter(candidate => (tally.get(candidate) || 0) === minimum);
    if (eliminated.length === active.size) { finalTie = eliminated; break; }
    // A random draw is used only when a complete elimination tie cannot be
    // resolved from ranked preferences; it is recorded in the response.
    active.delete(eliminated[randomIndex(eliminated.length)]);
    finalTie = [...active];
  }
  const chosen = finalTie[randomIndex(finalTie.length)]; const now = Date.now(); const startDate = new Date().toISOString().slice(0, 10);
  await env.DB.batch([
    env.DB.prepare("UPDATE ballots SET status='finalized', finalized_book_id=?, updated_at=? WHERE id=? AND status='open'").bind(chosen, now, ballotId),
    env.DB.prepare("UPDATE books SET status='current', start_date=COALESCE(start_date, ?), updated_at=? WHERE id=? AND club_id=? AND EXISTS (SELECT 1 FROM ballots WHERE id=? AND finalized_book_id=?)").bind(startDate, now, chosen, ballot.club_id, ballotId, chosen),
    env.DB.prepare("UPDATE books SET status='suggested', updated_at=? WHERE club_id=? AND status='ballot' AND id<>? AND EXISTS (SELECT 1 FROM ballots WHERE id=? AND finalized_book_id=?)").bind(now, ballot.club_id, chosen, ballotId, chosen),
  ]);
  const finalized = await env.DB.prepare('SELECT finalized_book_id FROM ballots WHERE id=?').bind(ballotId).first<{ finalized_book_id: string | null }>();
  if (!finalized?.finalized_book_id) throw new HttpError(409, 'This ballot could not be finalized.', 'ballot_closed');
  return json({ bookId: finalized.finalized_book_id, tieBreak: finalized.finalized_book_id === chosen && finalTie.length > 1 ? { kind: 'random_draw' } : null, alreadyFinalized: finalized.finalized_book_id !== chosen });
}

export async function cancelMeetingAction(env: Env, session: AuthSession | null, meetingId: string): Promise<Response> {
  requireSession(session);
  const meeting = await env.DB.prepare('SELECT club_id FROM meetings WHERE id=?').bind(meetingId).first<{ club_id: string }>();
  if (!meeting) throw new HttpError(404, 'Meeting not found.', 'not_found');
  await requireMember(env, session, meeting.club_id, 'admin');
  await env.DB.prepare("UPDATE meetings SET status='cancelled', updated_at=? WHERE id=? AND club_id=?").bind(Date.now(), meetingId, meeting.club_id).run();
  return json({ cancelled: true });
}

export async function createMeetingOptions(request: Request, env: Env, session: AuthSession | null, clubId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId, 'admin');
  const input = await body<{ checkpointId?: unknown; startsAt?: unknown }>(request);
  const checkpointId = string(input.checkpointId, 'Checkpoint', { min: 1, max: 64 });
  if (!Array.isArray(input.startsAt) || input.startsAt.length < 2 || input.startsAt.length > 5) throw new HttpError(400, 'Choose between two and five meeting times.', 'invalid_input');
  const checkpoint = await env.DB.prepare('SELECT id FROM reading_checkpoints WHERE id=? AND club_id=?').bind(checkpointId, clubId).first();
  if (!checkpoint) throw new HttpError(404, 'Checkpoint not found.', 'not_found');
  const starts = input.startsAt.map(value => typeof value === 'string' ? Date.parse(value) : Number.NaN);
  if (starts.some(value => !Number.isSafeInteger(value) || value <= Date.now())) throw new HttpError(400, 'Meeting times must be future timestamps.', 'invalid_input');
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM checkpoint_options WHERE checkpoint_id=? AND club_id=?').bind(checkpointId, clubId),
    ...starts.map(startsAt => env.DB.prepare('INSERT INTO checkpoint_options (id, checkpoint_id, club_id, starts_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), checkpointId, clubId, startsAt, session.user.id, now)),
  ]);
  return json({ created: starts.length });
}

export async function setMeetingOption(request: Request, env: Env, session: AuthSession | null, optionId: string): Promise<Response> {
  requireSession(session);
  const option = await env.DB.prepare('SELECT checkpoint_id, club_id FROM checkpoint_options WHERE id=?').bind(optionId).first<{ checkpoint_id: string; club_id: string }>();
  if (!option) throw new HttpError(404, 'Meeting option not found.', 'not_found');
  await requireMember(env, session, option.club_id);
  const input = await body<{ available?: unknown }>(request);
  if (input.available === false) await env.DB.prepare('DELETE FROM checkpoint_votes WHERE option_id=? AND user_id=?').bind(optionId, session.user.id).run();
  else await env.DB.prepare('INSERT OR IGNORE INTO checkpoint_votes (option_id, checkpoint_id, club_id, user_id, created_at) VALUES (?, ?, ?, ?, ?)').bind(optionId, option.checkpoint_id, option.club_id, session.user.id, Date.now()).run();
  return json({ available: input.available !== false });
}

export async function submitMeetingPollAction(env: Env, session: AuthSession | null, checkpointId: string): Promise<Response> {
  requireSession(session);
  const checkpoint = await env.DB.prepare('SELECT club_id, book_id FROM reading_checkpoints WHERE id=?').bind(checkpointId).first<{ club_id: string; book_id: string }>();
  if (!checkpoint) throw new HttpError(404, 'Checkpoint not found.', 'not_found');
  await requireMember(env, session, checkpoint.club_id, 'admin');
  const option = await env.DB.prepare(`SELECT o.id, o.starts_at FROM checkpoint_options o LEFT JOIN checkpoint_votes v ON v.option_id=o.id
    WHERE o.checkpoint_id=? GROUP BY o.id ORDER BY COUNT(v.user_id) DESC, o.starts_at ASC LIMIT 1`).bind(checkpointId).first<{ id: string; starts_at: number }>();
  if (!option) throw new HttpError(409, 'There are no meeting options to confirm.', 'invalid_state');
  const now = Date.now(); const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO meetings (id, club_id, book_id, checkpoint_id, starts_at, location, notes, meeting_type, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '', '', 'facetime', ?, ?, ?)`)
    .bind(id, checkpoint.club_id, checkpoint.book_id, checkpointId, option.starts_at, session.user.id, now, now).run();
  return json({ id, startsAt: option.starts_at });
}

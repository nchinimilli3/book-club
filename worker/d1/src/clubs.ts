import type { AuthSession } from './auth';
import { requireMember, requireSession } from './authorization';
import type { Env } from './env';
import { body, HttpError, json, string } from './http';
import { withIdempotency } from './idempotency';

type ClubRow = { id: string; name: string; description: string; cover_key: string | null; created_at: number; updated_at: number; role: 'owner' | 'admin' | 'member' };

export async function listClubs(env: Env, session: AuthSession | null): Promise<Response> {
  requireSession(session);
  const rows = await env.DB.prepare(`SELECT c.id, c.name, c.description, c.cover_key, c.created_at, c.updated_at, m.role
    FROM clubs c JOIN club_memberships m ON m.club_id = c.id WHERE m.user_id = ? ORDER BY c.updated_at DESC`).bind(session.user.id).all<ClubRow>();
  return json({ clubs: rows.results });
}

export async function createClub(request: Request, env: Env, session: AuthSession | null): Promise<Response> {
  requireSession(session);
  const input = await body<{ name?: unknown; description?: unknown }>(request);
  const name = string(input.name, 'Club name', { min: 1, max: 120 });
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 2000) : '';
  const result = await withIdempotency(env, session.user.id, request.headers.get('idempotency-key'), 'create-club', async () => {
    const id = crypto.randomUUID(); const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO clubs (id, name, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, name, description, session.user.id, now, now),
      env.DB.prepare("INSERT INTO club_memberships (club_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").bind(id, session.user.id, now),
    ]);
    return { id, name, description, role: 'owner' as const, created_at: now, updated_at: now };
  });
  return json({ club: result }, 201);
}

export async function clubSummary(env: Env, session: AuthSession | null, clubId: string): Promise<Response> {
  await requireMember(env, session, clubId);
  const [club, books, ballot, meetings] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, description, cover_key, created_at, updated_at FROM clubs WHERE id = ?').bind(clubId),
    env.DB.prepare("SELECT id, title, author, cover_url, status, created_at, updated_at FROM books WHERE club_id = ? AND status IN ('suggested', 'ballot', 'current') ORDER BY created_at DESC LIMIT 50").bind(clubId),
    env.DB.prepare("SELECT id, status, opens_at, closes_at, finalized_book_id FROM ballots WHERE club_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1").bind(clubId),
    env.DB.prepare('SELECT id, book_id, starts_at, location, notes FROM meetings WHERE club_id = ? AND starts_at >= ? ORDER BY starts_at ASC LIMIT 3').bind(clubId, Date.now()),
  ]);
  return json({ club: club.results[0] ?? null, books: books.results, activeBallot: ballot.results[0] ?? null, upcomingMeetings: meetings.results });
}

export async function suggestBook(request: Request, env: Env, session: AuthSession | null, clubId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId);
  const input = await body<{ title?: unknown; author?: unknown; coverUrl?: unknown; description?: unknown; pages?: unknown; publishedYear?: unknown; isbn?: unknown; subjects?: unknown }>(request);
  const title = string(input.title, 'Book title', { min: 1, max: 240 });
  const author = typeof input.author === 'string' ? input.author.trim().slice(0, 240) : '';
  const coverUrl = typeof input.coverUrl === 'string' && /^https?:\/\//i.test(input.coverUrl) ? input.coverUrl.slice(0, 2000) : null;
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 10_000) : null;
  const pages = Number.isSafeInteger(input.pages) && Number(input.pages) > 0 ? Number(input.pages) : null;
  const publishedYear = Number.isSafeInteger(input.publishedYear) && Number(input.publishedYear) > 0 ? Number(input.publishedYear) : null;
  const isbn = typeof input.isbn === 'string' ? input.isbn.replace(/[^0-9X]/gi, '').slice(0, 32) || null : null;
  const subjects = Array.isArray(input.subjects) ? JSON.stringify(input.subjects.map(String).map(value => value.trim()).filter(Boolean).slice(0, 18)) : '[]';
  const result = await withIdempotency(env, session.user.id, request.headers.get('idempotency-key'), `suggest-book:${clubId}`, async () => {
    const existing = await env.DB.prepare("SELECT id, title, author, cover_url, status, created_at, updated_at FROM books WHERE club_id = ? AND lower(title) = lower(?) AND status IN ('suggested', 'ballot', 'current') LIMIT 1").bind(clubId, title).first();
    if (existing) return existing;
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM books WHERE club_id = ? AND status = 'suggested'").bind(clubId).first<{ count: number }>();
    if (Number(count?.count ?? 0) >= 100) throw new HttpError(409, 'This club has reached its suggestion limit. Start a ballot before adding more.', 'suggestion_limit_reached');
    const id = crypto.randomUUID(); const now = Date.now();
    await env.DB.prepare("INSERT INTO books (id, club_id, title, author, cover_url, description, pages, published_year, isbn, subjects_json, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'suggested', ?, ?, ?)").bind(id, clubId, title, author, coverUrl, description, pages, publishedYear, isbn, subjects, session.user.id, now, now).run();
    return { id, title, author, cover_url: coverUrl, description, pages, published_year: publishedYear, isbn, subjects: JSON.parse(subjects), status: 'suggested', created_at: now, updated_at: now };
  });
  return json({ book: result }, 201);
}

export async function startBallot(request: Request, env: Env, session: AuthSession | null, clubId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId, 'admin');
  const input = await body<{ closesAt?: unknown }>(request);
  const closesAt = typeof input.closesAt === 'number' && Number.isSafeInteger(input.closesAt) ? input.closesAt : Date.now() + 5 * 24 * 60 * 60 * 1000;
  if (closesAt <= Date.now()) throw new HttpError(400, 'The ballot closing time must be in the future.', 'invalid_input');
  const result = await withIdempotency(env, session.user.id, request.headers.get('idempotency-key'), `start-ballot:${clubId}`, async () => {
    const existing = await env.DB.prepare("SELECT id, status, opens_at, closes_at FROM ballots WHERE club_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1").bind(clubId).first();
    if (existing) return existing;
    const candidates = await env.DB.prepare("SELECT id FROM books WHERE club_id = ? AND status = 'suggested' ORDER BY created_at ASC LIMIT 50").bind(clubId).all<{ id: string }>();
    if (candidates.results.length < 2) throw new HttpError(409, 'Add at least two book suggestions before starting a vote.', 'not_enough_suggestions');
    const ballotId = crypto.randomUUID(); const now = Date.now();
    const statements = [env.DB.prepare("INSERT INTO ballots (id, club_id, status, opens_at, closes_at, created_by, created_at, updated_at) VALUES (?, ?, 'open', ?, ?, ?, ?, ?)").bind(ballotId, clubId, now, closesAt, session.user.id, now, now)];
    for (const candidate of candidates.results) {
      statements.push(env.DB.prepare('INSERT INTO ballot_books (ballot_id, book_id) VALUES (?, ?)').bind(ballotId, candidate.id));
      statements.push(env.DB.prepare("UPDATE books SET status = 'ballot', updated_at = ? WHERE id = ? AND club_id = ? AND status = 'suggested'").bind(now, candidate.id, clubId));
    }
    await env.DB.batch(statements);
    return { id: ballotId, status: 'open', opens_at: now, closes_at: closesAt };
  });
  return json({ ballot: result }, 201);
}

export async function getActiveBallot(env: Env, session: AuthSession | null, clubId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId);
  const ballot = await env.DB.prepare("SELECT id, status, opens_at, closes_at, finalized_book_id FROM ballots WHERE club_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1").bind(clubId).first<{ id: string; status: string; opens_at: number; closes_at: number | null; finalized_book_id: string | null }>();
  if (!ballot) return json({ ballot: null });
  const [books, rankings, voters] = await env.DB.batch([
    env.DB.prepare('SELECT b.id, b.title, b.author, b.cover_url FROM ballot_books bb JOIN books b ON b.id = bb.book_id WHERE bb.ballot_id = ? ORDER BY b.created_at ASC').bind(ballot.id),
    env.DB.prepare('SELECT book_id, rank FROM ballot_rankings WHERE ballot_id = ? AND user_id = ? ORDER BY rank ASC').bind(ballot.id, session.user.id),
    env.DB.prepare('SELECT COUNT(DISTINCT user_id) AS count FROM ballot_rankings WHERE ballot_id = ?').bind(ballot.id),
  ]);
  const rankingIds = rankings.results.map((row) => (row as { book_id: string }).book_id);
  const nominations = books.results.map((row) => {
    const book = row as { id: string; title: string; author: string; cover_url: string | null };
    return { id: book.id, book, rank: rankingIds.indexOf(book.id) + 1 };
  });
  return json({ ballot: { ...ballot, rankedChoice: true, rankingIds, voterCount: Number((voters.results[0] as { count?: number } | undefined)?.count ?? 0), nominations } });
}

export async function submitRankings(request: Request, env: Env, session: AuthSession | null, clubId: string, ballotId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId);
  const input = await body<{ rankings?: unknown }>(request);
  if (!Array.isArray(input.rankings) || input.rankings.length > 3) throw new HttpError(400, 'Rankings may include up to three books.', 'invalid_input');
  const rankings = input.rankings.map((bookId, index) => ({ bookId: string(bookId, 'Book ID', { min: 1, max: 64 }), rank: index + 1 }));
  if (new Set(rankings.map((item) => item.bookId)).size !== rankings.length) throw new HttpError(400, 'Each book may be ranked once.', 'invalid_input');
  const result = await withIdempotency(env, session.user.id, request.headers.get('idempotency-key'), `rank-ballot:${ballotId}`, async () => {
    const ballot = await env.DB.prepare("SELECT id FROM ballots WHERE id = ? AND club_id = ? AND status = 'open' AND (closes_at IS NULL OR closes_at > ?)").bind(ballotId, clubId, Date.now()).first();
    if (!ballot) throw new HttpError(409, 'This ballot is no longer open.', 'ballot_closed');
    const candidates = await env.DB.prepare('SELECT book_id FROM ballot_books WHERE ballot_id = ?').bind(ballotId).all<{ book_id: string }>();
    const allowed = new Set(candidates.results.map((row) => row.book_id));
    if (rankings.some((item) => !allowed.has(item.bookId))) throw new HttpError(400, 'A ranked book is not on this ballot.', 'invalid_input');
    const now = Date.now();
    const statements = [env.DB.prepare('DELETE FROM ballot_rankings WHERE ballot_id = ? AND user_id = ?').bind(ballotId, session.user.id)];
    for (const item of rankings) statements.push(env.DB.prepare('INSERT INTO ballot_rankings (ballot_id, book_id, user_id, rank, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(ballotId, item.bookId, session.user.id, item.rank, now, now));
    await env.DB.batch(statements);
    return { ballotId, rankings };
  });
  return json(result);
}

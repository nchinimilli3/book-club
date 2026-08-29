import type { AuthSession } from './auth';
import { requireMember, requireSession } from './authorization';
import type { Env } from './env';
import { HttpError, json } from './http';

function parseJson(value: unknown, fallback: unknown) { try { return typeof value === 'string' ? JSON.parse(value) : fallback; } catch { return fallback; } }

export async function loadWorkspace(env: Env, session: AuthSession | null, clubId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId);
  const [clubResult, membersResult, booksResult, meetingsResult, checkpointsResult, progressResult, questionsResult, checkinsResult] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, description, cover_key, created_by, created_at, updated_at FROM clubs WHERE id=?').bind(clubId),
    env.DB.prepare(`SELECT m.user_id, m.role, m.joined_at, u.name, u.image, s.username, s.profile_style_json,
      p.chapter, p.page, p.percent, p.status, p.format FROM club_memberships m JOIN user u ON u.id=m.user_id
      LEFT JOIN user_settings s ON s.user_id=u.id LEFT JOIN reading_progress p ON p.user_id=m.user_id AND p.club_id=m.club_id
        AND p.book_id=(SELECT b2.id FROM books b2 WHERE b2.club_id=m.club_id AND b2.status IN ('current','completed') ORDER BY CASE b2.status WHEN 'current' THEN 0 ELSE 1 END, b2.updated_at DESC LIMIT 1)
      WHERE m.club_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.joined_at ASC LIMIT 100`).bind(clubId),
    env.DB.prepare(`SELECT b.id, b.title, b.author, b.cover_url, b.description, b.pages, b.published_year, b.isbn, b.subjects_json, b.status, b.start_date, b.target_finish_date, b.total_chapters, b.total_pages, b.created_by, b.created_at, b.updated_at,
      (SELECT COUNT(*) FROM book_ratings r WHERE r.book_id=b.id) AS rating_count
      FROM books b WHERE b.club_id=? ORDER BY b.created_at DESC LIMIT 250`).bind(clubId),
    env.DB.prepare(`SELECT m.id, m.book_id, m.checkpoint_id, m.starts_at, m.location, m.notes, m.meeting_type, m.meeting_url, m.status,
      r.status AS my_rsvp FROM meetings m LEFT JOIN meeting_rsvps r ON r.meeting_id=m.id AND r.user_id=? WHERE m.club_id=? AND m.status!='cancelled' ORDER BY m.starts_at ASC LIMIT 50`).bind(session.user.id, clubId),
    env.DB.prepare('SELECT id, book_id, label, due_at, target_chapter, target_page FROM reading_checkpoints WHERE club_id=? ORDER BY due_at ASC LIMIT 100').bind(clubId),
    env.DB.prepare('SELECT book_id, chapter, page, percent, status, format FROM reading_progress WHERE club_id=? AND user_id=?').bind(clubId, session.user.id),
    env.DB.prepare(`SELECT q.id, q.book_id, q.post_id, q.body, q.created_at, q.user_id, u.name FROM meeting_questions q JOIN user u ON u.id=q.user_id
      WHERE q.club_id=? AND q.resolved_at IS NULL ORDER BY q.created_at ASC LIMIT 100`).bind(clubId),
    env.DB.prepare('SELECT checkpoint_id, user_id, status, updated_at FROM checkpoint_checkins WHERE club_id=? LIMIT 500').bind(clubId),
  ]);
  const club = clubResult.results[0] as Record<string, unknown> | undefined;
  if (!club) throw new HttpError(404, 'Club not found.', 'not_found');
  type WorkspaceBook = Record<string, unknown> & { id: string; status: string; subjects: unknown };
  const books: WorkspaceBook[] = booksResult.results.map(row => {
    const value = row as Record<string, unknown>;
    return { ...value, id: String(value.id), status: String(value.status), subjects: parseJson(value.subjects_json, []) };
  });
  const currentBook = books.find(book => book.status === 'current')
    ?? books.find(book => book.status === 'completed' && Number(book.rating_count ?? 0) < membersResult.results.length)
    ?? null;
  const currentBookId = typeof currentBook?.id === 'string' ? currentBook.id : null;
  const [postsResult, optionsResult, ratingsResult, acquiredResult] = await env.DB.batch([
    currentBookId ? env.DB.prepare(`SELECT p.id, p.book_id, p.author_id, p.body, p.post_type, p.chapter, p.locked, p.revealed_at, p.created_at, p.updated_at, u.name, u.image,
      (SELECT COUNT(*) FROM discussion_replies r WHERE r.post_id=p.id) AS reply_count,
      (SELECT COUNT(*) FROM reactions x WHERE x.post_id=p.id) AS reaction_count FROM discussion_posts p JOIN user u ON u.id=p.author_id
      WHERE p.club_id=? AND p.book_id=? ORDER BY p.created_at DESC LIMIT 50`).bind(clubId, currentBookId) : env.DB.prepare('SELECT id FROM discussion_posts WHERE 1=0'),
    currentBookId ? env.DB.prepare(`SELECT o.id, o.checkpoint_id, o.starts_at, COUNT(v.user_id) AS available_count,
      MAX(CASE WHEN v.user_id=? THEN 1 ELSE 0 END) AS my_available FROM checkpoint_options o LEFT JOIN checkpoint_votes v ON v.option_id=o.id
      WHERE o.club_id=? GROUP BY o.id ORDER BY o.starts_at ASC LIMIT 100`).bind(session.user.id, clubId) : env.DB.prepare('SELECT id FROM checkpoint_options WHERE 1=0'),
    currentBookId ? env.DB.prepare('SELECT rating, review, recommend FROM book_ratings WHERE book_id=? AND user_id=?').bind(currentBookId, session.user.id) : env.DB.prepare('SELECT rating FROM book_ratings WHERE 1=0'),
    currentBookId ? env.DB.prepare('SELECT COUNT(*) AS count FROM reading_progress WHERE club_id=? AND book_id=? AND format IS NOT NULL').bind(clubId, currentBookId) : env.DB.prepare('SELECT 0 AS count'),
  ]);
  const members = membersResult.results.map(row => { const value = row as Record<string, unknown>; return { ...value, style: parseJson(value.profile_style_json, {}) }; });
  const archiveBooks = books.filter(book => book.status === 'completed' || book.status === 'archived').slice(0, 12);
  const postIds = postsResult.results.map(row => String((row as Record<string, unknown>).id)).filter(Boolean).slice(0, 50);
  const placeholders = postIds.map(() => '?').join(',');
  const [replies, reactions] = postIds.length ? await env.DB.batch([
    env.DB.prepare(`SELECT r.id, r.post_id, r.author_id, r.body, r.created_at, u.name, u.image FROM discussion_replies r JOIN user u ON u.id=r.author_id WHERE r.post_id IN (${placeholders}) ORDER BY r.created_at ASC LIMIT 200`).bind(...postIds),
    env.DB.prepare(`SELECT post_id, user_id, emoji, created_at FROM reactions WHERE post_id IN (${placeholders}) ORDER BY created_at ASC LIMIT 300`).bind(...postIds),
  ]) : [{ results: [] as unknown[] }, { results: [] as unknown[] }];
  return json({
    club, members, books, currentBook, contextConfigured: Boolean(env.OPENAI_API_KEY), archiveBooks,
    archiveBookCount: books.filter(book => book.status === 'completed' || book.status === 'archived').length,
    meetings: meetingsResult.results, meetingOptions: optionsResult.results, thoughts: postsResult.results, checkpoints: checkpointsResult.results,
    checkpointCheckins: checkinsResult.results, replies: replies.results, reactions: reactions.results, myProgress: progressResult.results.find(row => (row as Record<string, unknown>).book_id === currentBookId) ?? null,
    myClubRating: ratingsResult.results[0] ?? null, meetingQuestions: questionsResult.results,
    acquired: Number((acquiredResult.results[0] as Record<string, unknown> | undefined)?.count ?? 0),
    lockedPostCount: postsResult.results.filter(row => Boolean((row as Record<string, unknown>).locked)).length,
  });
}

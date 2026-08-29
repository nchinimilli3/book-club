import type { AuthSession } from './auth';
import { requireMember, requireSession } from './authorization';
import type { Env } from './env';
import { body, HttpError, json, string } from './http';
import { withIdempotency } from './idempotency';

const MAX_POSTS = 50;
const MAX_REPLIES = 50;

export async function listDiscussion(request: Request, env: Env, session: AuthSession | null, clubId: string): Promise<Response> {
  await requireMember(env, session, clubId);
  const url = new URL(request.url);
  const bookId = url.searchParams.get('bookId');
  const requestedLimit = Number(url.searchParams.get('limit') ?? MAX_POSTS);
  const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), MAX_POSTS) : MAX_POSTS;
  const query = bookId
    ? env.DB.prepare(`SELECT p.id, p.book_id, p.author_id, p.body, p.created_at, p.updated_at,
        u.name AS author_name, (SELECT COUNT(*) FROM discussion_replies r WHERE r.post_id = p.id) AS reply_count
        FROM discussion_posts p JOIN user u ON u.id = p.author_id
        WHERE p.club_id = ? AND p.book_id = ? ORDER BY p.created_at DESC LIMIT ?`).bind(clubId, bookId, limit)
    : env.DB.prepare(`SELECT p.id, p.book_id, p.author_id, p.body, p.created_at, p.updated_at,
        u.name AS author_name, (SELECT COUNT(*) FROM discussion_replies r WHERE r.post_id = p.id) AS reply_count
        FROM discussion_posts p JOIN user u ON u.id = p.author_id
        WHERE p.club_id = ? ORDER BY p.created_at DESC LIMIT ?`).bind(clubId, limit);
  const posts = await query.all();
  return json({ posts: posts.results });
}

export async function createPost(request: Request, env: Env, session: AuthSession | null, clubId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId);
  const input = await body<{ body?: unknown; bookId?: unknown; type?: unknown; chapter?: unknown }>(request);
  const text = string(input.body, 'Post', { min: 1, max: 10000 });
  const bookId = typeof input.bookId === 'string' ? input.bookId : null;
  if (bookId) {
    const book = await env.DB.prepare('SELECT id FROM books WHERE id = ? AND club_id = ?').bind(bookId, clubId).first();
    if (!book) throw new HttpError(400, 'That book does not belong to this club.', 'invalid_input');
  }
  const type = typeof input.type === 'string' && ['thought', 'question', 'prediction', 'quote'].includes(input.type) ? input.type : 'thought';
  const chapter = Number.isSafeInteger(input.chapter) && Number(input.chapter) > 0 ? Number(input.chapter) : null;
  const result = await withIdempotency(env, session.user.id, request.headers.get('idempotency-key'), `create-post:${clubId}`, async () => {
    const id = crypto.randomUUID(); const now = Date.now();
    await env.DB.prepare('INSERT INTO discussion_posts (id, club_id, book_id, author_id, body, post_type, chapter, locked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, clubId, bookId, session.user.id, text, type, chapter, type === 'prediction' ? 1 : 0, now, now).run();
    return { id, club_id: clubId, book_id: bookId, author_id: session.user.id, body: text, post_type: type, chapter, created_at: now, updated_at: now };
  });
  return json({ post: result }, 201);
}

export async function listReplies(env: Env, session: AuthSession | null, clubId: string, postId: string): Promise<Response> {
  await requireMember(env, session, clubId);
  const post = await env.DB.prepare('SELECT id FROM discussion_posts WHERE id = ? AND club_id = ?').bind(postId, clubId).first();
  if (!post) throw new HttpError(404, 'Discussion post not found.', 'not_found');
  const replies = await env.DB.prepare(`SELECT r.id, r.post_id, r.author_id, r.body, r.created_at, r.updated_at, u.name AS author_name
    FROM discussion_replies r JOIN user u ON u.id = r.author_id WHERE r.post_id = ? AND r.club_id = ? ORDER BY r.created_at ASC LIMIT ?`).bind(postId, clubId, MAX_REPLIES).all();
  return json({ replies: replies.results });
}

export async function createReply(request: Request, env: Env, session: AuthSession | null, clubId: string, postId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId);
  const post = await env.DB.prepare('SELECT id FROM discussion_posts WHERE id = ? AND club_id = ?').bind(postId, clubId).first();
  if (!post) throw new HttpError(404, 'Discussion post not found.', 'not_found');
  const input = await body<{ body?: unknown }>(request);
  const text = string(input.body, 'Reply', { min: 1, max: 10000 });
  const result = await withIdempotency(env, session.user.id, request.headers.get('idempotency-key'), `create-reply:${postId}`, async () => {
    const id = crypto.randomUUID(); const now = Date.now();
    await env.DB.prepare('INSERT INTO discussion_replies (id, club_id, post_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, clubId, postId, session.user.id, text, now, now).run();
    return { id, club_id: clubId, post_id: postId, author_id: session.user.id, body: text, created_at: now, updated_at: now };
  });
  return json({ reply: result }, 201);
}

export async function toggleReaction(request: Request, env: Env, session: AuthSession | null, clubId: string, postId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId);
  const post = await env.DB.prepare('SELECT id FROM discussion_posts WHERE id = ? AND club_id = ?').bind(postId, clubId).first();
  if (!post) throw new HttpError(404, 'Discussion post not found.', 'not_found');
  const input = await body<{ emoji?: unknown }>(request);
  const emoji = string(input.emoji ?? 'heart', 'Reaction', { min: 1, max: 16 });
  const existing = await env.DB.prepare('SELECT 1 FROM reactions WHERE post_id = ? AND user_id = ? AND emoji = ?').bind(postId, session.user.id, emoji).first();
  if (existing) {
    await env.DB.prepare('DELETE FROM reactions WHERE post_id = ? AND user_id = ? AND emoji = ?').bind(postId, session.user.id, emoji).run();
    return json({ reacted: false, emoji });
  }
  await env.DB.prepare('INSERT INTO reactions (club_id, post_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)').bind(clubId, postId, session.user.id, emoji, Date.now()).run();
  return json({ reacted: true, emoji });
}

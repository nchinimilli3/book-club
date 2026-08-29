import type { AuthSession } from './auth';
import { requireMember, requireSession } from './authorization';
import type { Env } from './env';
import { body, HttpError, json, noContent, string } from './http';
import { withIdempotency } from './idempotency';

type LibraryInput = {
  title?: unknown; author?: unknown; coverUrl?: unknown; isbn?: unknown; pages?: unknown;
  publishedYear?: unknown; description?: unknown; shelf?: unknown; rating?: unknown;
  dateFinished?: unknown; isFavorite?: unknown; isPublic?: unknown; source?: unknown;
};

function safeJson(value: string, fallback: unknown): unknown {
  try { return JSON.parse(value); } catch { return fallback; }
}

function optionalText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function optionalInteger(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

function libraryRecord(input: LibraryInput) {
  const title = string(input.title, 'Book title', { min: 1, max: 240 });
  const author = typeof input.author === 'string' ? input.author.trim().slice(0, 240) : '';
  const shelf = typeof input.shelf === 'string' && ['want_to_read', 'currently_reading', 'read'].includes(input.shelf) ? input.shelf : 'want_to_read';
  const rating = optionalInteger(input.rating, 1, 5);
  const source = typeof input.source === 'string' ? input.source.trim().slice(0, 40) : 'search';
  return {
    title, author, coverUrl: optionalText(input.coverUrl, 2000), isbn: optionalText(input.isbn, 32),
    pages: optionalInteger(input.pages, 1, 100_000), publishedYear: optionalInteger(input.publishedYear, 1, 9999),
    description: optionalText(input.description, 10_000), shelf, rating,
    dateFinished: typeof input.dateFinished === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.dateFinished) ? input.dateFinished : null,
    isFavorite: input.isFavorite === true ? 1 : 0, isPublic: input.isPublic === true ? 1 : 0, source,
    titleKey: title.toLocaleLowerCase(), authorKey: author.toLocaleLowerCase(),
  };
}

export async function getSettings(env: Env, session: AuthSession | null): Promise<Response> {
  requireSession(session);
  const [user, settings] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, email, image, emailVerified FROM user WHERE id = ?').bind(session.user.id),
    env.DB.prepare('SELECT username, profile_style_json, notification_mode, reading_avoidances_json, reading_moods_json, timezone FROM user_settings WHERE user_id = ?').bind(session.user.id),
  ]);
  const row = settings.results[0] as Record<string, string> | undefined;
  return json({ user: user.results[0] ?? null, settings: {
    username: row?.username ?? null, style: safeJson(row?.profile_style_json ?? '{}', {}),
    notificationMode: row?.notification_mode ?? 'essential', readingAvoidances: safeJson(row?.reading_avoidances_json ?? '[]', []),
    readingMoods: safeJson(row?.reading_moods_json ?? '[]', []), timezone: row?.timezone ?? null,
  } });
}

export async function updateSettings(request: Request, env: Env, session: AuthSession | null): Promise<Response> {
  requireSession(session);
  const input = await body<{ name?: unknown; image?: unknown; username?: unknown; style?: unknown; notificationMode?: unknown; readingAvoidances?: unknown; readingMoods?: unknown; timezone?: unknown }>(request);
  const name = input.name === undefined ? null : string(input.name, 'Name', { min: 1, max: 120 });
  const image = input.image === undefined ? undefined : (input.image === null || input.image === '' ? null : string(input.image, 'Profile image', { max: 2000 }));
  if (image && !/^https:\/\//i.test(image)) throw new HttpError(400, 'Profile image must use HTTPS.', 'invalid_input');
  const username = input.username === undefined ? undefined : optionalText(input.username, 80);
  const notificationMode = typeof input.notificationMode === 'string' && ['essential', 'all', 'none'].includes(input.notificationMode) ? input.notificationMode : undefined;
  const timezone = input.timezone === undefined ? undefined : optionalText(input.timezone, 100);
  const style = input.style === undefined ? undefined : JSON.stringify(input.style);
  const avoidances = input.readingAvoidances === undefined ? undefined : JSON.stringify(Array.isArray(input.readingAvoidances) ? input.readingAvoidances.map(String).slice(0, 30) : []);
  const moods = input.readingMoods === undefined ? undefined : JSON.stringify(Array.isArray(input.readingMoods) ? input.readingMoods.map(String).slice(0, 30) : []);
  if (style && /"(?:avatarUrl|wallpaperUrl)"\s*:\s*"data:image\//i.test(style)) {
    throw new HttpError(400, 'Profile images must be uploaded through the profile media flow.', 'profile_media_required');
  }
  if (style && style.length > 50_000) throw new HttpError(413, 'Profile style is too large.', 'payload_too_large');
  const existing = await env.DB.prepare('SELECT username, profile_style_json, notification_mode, reading_avoidances_json, reading_moods_json, timezone FROM user_settings WHERE user_id = ?').bind(session.user.id).first<Record<string, string | null>>();
  const now = Date.now();
  await env.DB.batch([
    ...(name !== null || image !== undefined ? [env.DB.prepare('UPDATE user SET name = COALESCE(?, name), image = CASE WHEN ? THEN ? ELSE image END, updatedAt = ? WHERE id = ?').bind(name, image !== undefined ? 1 : 0, image ?? null, now, session.user.id)] : []),
    env.DB.prepare(`INSERT INTO user_settings (user_id, username, profile_style_json, notification_mode, reading_avoidances_json, reading_moods_json, timezone, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username, profile_style_json=excluded.profile_style_json,
      notification_mode=excluded.notification_mode, reading_avoidances_json=excluded.reading_avoidances_json, reading_moods_json=excluded.reading_moods_json,
      timezone=excluded.timezone, updated_at=excluded.updated_at`).bind(
      session.user.id, username ?? existing?.username ?? null, style ?? existing?.profile_style_json ?? '{}', notificationMode ?? existing?.notification_mode ?? 'essential',
      avoidances ?? existing?.reading_avoidances_json ?? '[]', moods ?? existing?.reading_moods_json ?? '[]', timezone ?? existing?.timezone ?? null, now),
  ]);
  return getSettings(env, session);
}

export async function listLibrary(env: Env, session: AuthSession | null): Promise<Response> {
  requireSession(session);
  const rows = await env.DB.prepare('SELECT id, title, author, cover_url, isbn, pages, published_year, description, shelf, rating, date_finished, is_favorite, is_public, source, created_at, updated_at FROM personal_library WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1000').bind(session.user.id).all();
  return json({ books: rows.results });
}

export async function upsertLibrary(request: Request, env: Env, session: AuthSession | null): Promise<Response> {
  requireSession(session);
  const input = await body<LibraryInput>(request);
  const record = libraryRecord(input); const now = Date.now();
  const result = await withIdempotency(env, session.user.id, request.headers.get('idempotency-key'), `library:${record.titleKey}:${record.authorKey}`, async () => {
    const existing = await env.DB.prepare('SELECT id FROM personal_library WHERE user_id = ? AND title_key = ? AND author_key = ?').bind(session.user.id, record.titleKey, record.authorKey).first<{ id: string }>();
    const id = existing?.id ?? crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO personal_library (id, user_id, title, author, cover_url, isbn, pages, published_year, description, shelf, rating, date_finished, is_favorite, is_public, source, title_key, author_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, title_key, author_key) DO UPDATE SET
      cover_url=excluded.cover_url, isbn=excluded.isbn, pages=excluded.pages, published_year=excluded.published_year, description=excluded.description,
      shelf=excluded.shelf, rating=excluded.rating, date_finished=excluded.date_finished, is_favorite=excluded.is_favorite, is_public=excluded.is_public, source=excluded.source, updated_at=excluded.updated_at`)
      .bind(id, session.user.id, record.title, record.author, record.coverUrl, record.isbn, record.pages, record.publishedYear, record.description, record.shelf, record.rating, record.dateFinished, record.isFavorite, record.isPublic, record.source, record.titleKey, record.authorKey, now, now).run();
    return { id, ...record, created_at: now, updated_at: now };
  });
  return json({ book: result }, 201);
}

export async function importLibrary(request: Request, env: Env, session: AuthSession | null): Promise<Response> {
  requireSession(session);
  const input = await body<{ books?: unknown }>(request);
  if (!Array.isArray(input.books) || input.books.length === 0 || input.books.length > 500) throw new HttpError(400, 'Import between one and 500 books at a time.', 'invalid_input');
  const records = input.books.map((item) => libraryRecord(typeof item === 'object' && item !== null ? item as LibraryInput : {}));
  const now = Date.now();
  const inserted = await withIdempotency(env, session.user.id, request.headers.get('idempotency-key'), `library-import:${records.length}:${records.map((item) => `${item.titleKey}:${item.authorKey}`).join('|').slice(0, 500)}`, async () => {
    const statements = records.map((record) => env.DB.prepare(`INSERT INTO personal_library (id, user_id, title, author, cover_url, isbn, pages, published_year, description, shelf, rating, date_finished, is_favorite, is_public, source, title_key, author_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, title_key, author_key) DO UPDATE SET shelf=excluded.shelf, rating=excluded.rating, date_finished=excluded.date_finished, is_favorite=excluded.is_favorite, is_public=excluded.is_public, updated_at=excluded.updated_at`)
      .bind(crypto.randomUUID(), session.user.id, record.title, record.author, record.coverUrl, record.isbn, record.pages, record.publishedYear, record.description, record.shelf, record.rating, record.dateFinished, record.isFavorite, record.isPublic, record.source, record.titleKey, record.authorKey, now, now));
    await env.DB.batch(statements);
    return records.length;
  });
  return json({ imported: inserted });
}

export async function patchLibrary(request: Request, env: Env, session: AuthSession | null, libraryId: string): Promise<Response> {
  requireSession(session);
  const existing = await env.DB.prepare('SELECT title, author, cover_url, isbn, pages, published_year, description, shelf, rating, date_finished, is_favorite, is_public, source FROM personal_library WHERE id = ? AND user_id = ?').bind(libraryId, session.user.id).first<Record<string, unknown>>();
  if (!existing) throw new HttpError(404, 'Library book not found.', 'not_found');
  const input = await body<LibraryInput>(request);
  const record = libraryRecord({ title: input.title ?? existing.title, author: input.author ?? existing.author, coverUrl: input.coverUrl ?? existing.cover_url, isbn: input.isbn ?? existing.isbn, pages: input.pages ?? existing.pages, publishedYear: input.publishedYear ?? existing.published_year, description: input.description ?? existing.description, shelf: input.shelf ?? existing.shelf, rating: input.rating ?? existing.rating, dateFinished: input.dateFinished ?? existing.date_finished, isFavorite: input.isFavorite ?? Boolean(existing.is_favorite), isPublic: input.isPublic ?? Boolean(existing.is_public), source: input.source ?? existing.source });
  await env.DB.prepare('UPDATE personal_library SET title=?, author=?, cover_url=?, isbn=?, pages=?, published_year=?, description=?, shelf=?, rating=?, date_finished=?, is_favorite=?, is_public=?, source=?, title_key=?, author_key=?, updated_at=? WHERE id=? AND user_id=?').bind(record.title, record.author, record.coverUrl, record.isbn, record.pages, record.publishedYear, record.description, record.shelf, record.rating, record.dateFinished, record.isFavorite, record.isPublic, record.source, record.titleKey, record.authorKey, Date.now(), libraryId, session.user.id).run();
  return json({ updated: true });
}

export async function deleteLibrary(env: Env, session: AuthSession | null, libraryId: string): Promise<Response> {
  requireSession(session);
  await env.DB.prepare('DELETE FROM personal_library WHERE id = ? AND user_id = ?').bind(libraryId, session.user.id).run();
  return noContent();
}

export async function listMargins(env: Env, session: AuthSession | null, clubId: string, bookId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId);
  const rows = await env.DB.prepare('SELECT id, kind, body, note, chapter, page, created_at, updated_at FROM reader_margins WHERE club_id = ? AND book_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 200').bind(clubId, bookId, session.user.id).all();
  return json({ margins: rows.results });
}

export async function createMargin(request: Request, env: Env, session: AuthSession | null, clubId: string, bookId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId);
  const input = await body<{ kind?: unknown; body?: unknown; note?: unknown; chapter?: unknown; page?: unknown }>(request);
  const kind = input.kind === 'quote' ? 'quote' : input.kind === 'note' ? 'note' : null;
  if (!kind) throw new HttpError(400, 'Margin type must be note or quote.', 'invalid_input');
  const text = string(input.body, 'Text', { min: 1, max: 10_000 }); const now = Date.now();
  const margin = await withIdempotency(env, session.user.id, request.headers.get('idempotency-key'), `margin:${bookId}:${kind}:${text.slice(0, 120)}`, async () => {
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO reader_margins (id, club_id, book_id, user_id, kind, body, note, chapter, page, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, clubId, bookId, session.user.id, kind, text, optionalText(input.note, 2_000), optionalInteger(input.chapter), optionalInteger(input.page), now, now).run();
    return { id, kind, body: text, created_at: now };
  });
  return json({ margin }, 201);
}

export async function deleteMargin(env: Env, session: AuthSession | null, clubId: string, marginId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId);
  await env.DB.prepare('DELETE FROM reader_margins WHERE id = ? AND club_id = ? AND user_id = ?').bind(marginId, clubId, session.user.id).run();
  return noContent();
}

export async function listArchive(env: Env, session: AuthSession | null, clubId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId);
  const rows = await env.DB.prepare(`SELECT b.id, b.title, b.author, b.cover_url, b.status, b.updated_at,
    (SELECT COUNT(*) FROM book_ratings r WHERE r.book_id = b.id) AS rating_count,
    (SELECT ROUND(AVG(r.rating), 1) FROM book_ratings r WHERE r.book_id = b.id) AS average_rating
    FROM books b WHERE b.club_id = ? AND b.status IN ('completed', 'archived') ORDER BY b.updated_at DESC LIMIT 200`).bind(clubId).all();
  return json({ books: rows.results });
}

export async function rateBook(request: Request, env: Env, session: AuthSession | null, clubId: string, bookId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId);
  const input = await body<{ rating?: unknown; review?: unknown; recommend?: unknown }>(request);
  const rating = optionalInteger(input.rating, 1, 5);
  if (!rating) throw new HttpError(400, 'Rating must be between one and five.', 'invalid_input');
  const book = await env.DB.prepare('SELECT id FROM books WHERE id = ? AND club_id = ?').bind(bookId, clubId).first();
  if (!book) throw new HttpError(404, 'Book not found.', 'not_found');
  const review = optionalText(input.review, 10_000); const recommend = input.recommend === undefined ? null : input.recommend === true ? 1 : 0; const now = Date.now();
  await withIdempotency(env, session.user.id, request.headers.get('idempotency-key'), `rating:${bookId}`, async () => {
    await env.DB.prepare(`INSERT INTO book_ratings (club_id, book_id, user_id, rating, review, recommend, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(book_id, user_id) DO UPDATE SET rating=excluded.rating, review=excluded.review, recommend=excluded.recommend, updated_at=excluded.updated_at`).bind(clubId, bookId, session.user.id, rating, review, recommend, now, now).run();
    return { bookId, rating };
  });
  return json({ saved: true });
}

export async function updateBookStatus(request: Request, env: Env, session: AuthSession | null, clubId: string, bookId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId, 'admin');
  const input = await body<{ status?: unknown }>(request);
  const status = typeof input.status === 'string' && ['suggested', 'ballot', 'current', 'completed', 'archived'].includes(input.status) ? input.status : null;
  if (!status) throw new HttpError(400, 'Invalid book status.', 'invalid_input');
  await env.DB.prepare('UPDATE books SET status = ?, updated_at = ? WHERE id = ? AND club_id = ?').bind(status, Date.now(), bookId, clubId).run();
  return json({ status });
}

export async function listMembers(env: Env, session: AuthSession | null, clubId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId);
  const rows = await env.DB.prepare(`SELECT u.id, u.name, u.image, s.username, s.profile_style_json, m.role, m.joined_at
    FROM club_memberships m JOIN user u ON u.id=m.user_id LEFT JOIN user_settings s ON s.user_id=u.id
    WHERE m.club_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.joined_at ASC LIMIT 100`).bind(clubId).all();
  return json({ members: rows.results.map((row) => ({ ...row, style: safeJson(String((row as Record<string, unknown>).profile_style_json ?? '{}'), {}) })) });
}

export async function getMemberProfile(env: Env, session: AuthSession | null, clubId: string, memberId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId);
  const member = await env.DB.prepare(`SELECT u.id, u.name, u.image, s.username, s.profile_style_json, m.role FROM club_memberships m
    JOIN user u ON u.id=m.user_id LEFT JOIN user_settings s ON s.user_id=u.id WHERE m.club_id=? AND m.user_id=?`).bind(clubId, memberId).first<Record<string, unknown>>();
  if (!member) throw new HttpError(404, 'Member not found.', 'not_found');
  const library = await env.DB.prepare('SELECT id, title, author, cover_url, shelf, rating, date_finished FROM personal_library WHERE user_id = ? AND is_public = 1 ORDER BY updated_at DESC LIMIT 100').bind(memberId).all();
  return json({ member: { ...member, style: safeJson(String(member.profile_style_json ?? '{}'), {}) }, library: library.results });
}

export async function changeMembership(request: Request, env: Env, session: AuthSession | null, clubId: string, memberId: string): Promise<Response> {
  requireSession(session); const actorRole = await requireMember(env, session, clubId, 'admin');
  const target = await env.DB.prepare('SELECT role FROM club_memberships WHERE club_id=? AND user_id=?').bind(clubId, memberId).first<{ role: string }>();
  if (!target) throw new HttpError(404, 'Member not found.', 'not_found');
  const input = await body<{ action?: unknown; role?: unknown }>(request);
  if (input.action === 'remove') {
    if (target.role === 'owner') throw new HttpError(409, 'Transfer ownership before removing the owner.', 'owner_required');
    await env.DB.prepare('DELETE FROM club_memberships WHERE club_id=? AND user_id=?').bind(clubId, memberId).run();
    return json({ removed: true });
  }
  if (input.action === 'transfer') {
    if (actorRole !== 'owner') throw new HttpError(403, 'Only the club owner can transfer ownership.', 'forbidden');
    await env.DB.batch([
      env.DB.prepare("UPDATE club_memberships SET role='admin' WHERE club_id=? AND user_id=?").bind(clubId, session.user.id),
      env.DB.prepare("UPDATE club_memberships SET role='owner' WHERE club_id=? AND user_id=?").bind(clubId, memberId),
      env.DB.prepare('UPDATE clubs SET created_by=?, updated_at=? WHERE id=?').bind(memberId, Date.now(), clubId),
    ]);
    return json({ transferred: true });
  }
  const role = input.role === 'admin' || input.role === 'member' ? input.role : null;
  if (!role) throw new HttpError(400, 'Choose admin or member.', 'invalid_input');
  if (target.role === 'owner') throw new HttpError(409, 'Transfer ownership before changing the owner role.', 'owner_required');
  await env.DB.prepare('UPDATE club_memberships SET role=? WHERE club_id=? AND user_id=?').bind(role, clubId, memberId).run();
  return json({ role });
}

export async function leaveClub(env: Env, session: AuthSession | null, clubId: string): Promise<Response> {
  requireSession(session); const role = await requireMember(env, session, clubId);
  if (role === 'owner') throw new HttpError(409, 'Transfer ownership before leaving this club.', 'owner_required');
  await env.DB.prepare('DELETE FROM club_memberships WHERE club_id=? AND user_id=?').bind(clubId, session.user.id).run();
  return noContent();
}

export async function listMeetingQuestions(env: Env, session: AuthSession | null, clubId: string, bookId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId);
  const rows = await env.DB.prepare(`SELECT q.id, q.post_id, q.body, q.resolved_at, q.created_at, q.user_id, u.name, u.image
    FROM meeting_questions q JOIN user u ON u.id=q.user_id WHERE q.club_id=? AND q.book_id=? AND q.resolved_at IS NULL ORDER BY q.created_at ASC LIMIT 100`).bind(clubId, bookId).all();
  return json({ questions: rows.results });
}

export async function createMeetingQuestion(request: Request, env: Env, session: AuthSession | null, clubId: string, bookId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId);
  const input = await body<{ body?: unknown; postId?: unknown }>(request); const text = string(input.body, 'Question', { min: 1, max: 10_000 }); const now = Date.now();
  const question = await withIdempotency(env, session.user.id, request.headers.get('idempotency-key'), `meeting-question:${bookId}:${text.slice(0, 120)}`, async () => {
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO meeting_questions (id, club_id, book_id, post_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, clubId, bookId, optionalText(input.postId, 64), session.user.id, text, now).run();
    return { id, body: text, created_at: now };
  });
  return json({ question }, 201);
}

export async function resolveMeetingQuestion(request: Request, env: Env, session: AuthSession | null, clubId: string, questionId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId, 'admin');
  const input = await body<{ resolved?: unknown }>(request);
  await env.DB.prepare('UPDATE meeting_questions SET resolved_at=? WHERE id=? AND club_id=?').bind(input.resolved === false ? null : Date.now(), questionId, clubId).run();
  return json({ updated: true });
}

/** Cloudflare-only data adapter. It intentionally has no Supabase import. */
import { cloudApi, cloudAssetUrl, cloudRequest } from './cloudApi';
import type { AppNotification, Club, MarginItem, Profile, ProfileStyle, Tone, Workspace } from './model';

const tones: Tone[] = ['rose', 'olive', 'gold', 'plum', 'blue', 'clay'];
const iso = (value: unknown) => typeof value === 'number' ? new Date(value).toISOString() : typeof value === 'string' ? value : new Date().toISOString();
const book = (row: any) => ({ id: String(row.id), title: String(row.title || 'Untitled'), author: String(row.author || 'Unknown author'), coverUrl: row.cover_url || row.coverUrl || undefined, description: row.description || undefined, pages: Number(row.pages) || undefined, year: Number(row.published_year || row.year) || undefined, isbn: row.isbn || undefined, subjects: Array.isArray(row.subjects) ? row.subjects : [] });
const libraryItem = (row: any) => ({ id: String(row.id), shelf: row.shelf || 'want_to_read', rating: row.rating == null ? undefined : Number(row.rating), dateFinished: row.date_finished || row.dateFinished || undefined, isPublic: Boolean(row.is_public ?? row.isPublic), isFavorite: Boolean(row.is_favorite ?? row.isFavorite), source: row.source || undefined, book: book(row) });

export async function getProfile(userId: string): Promise<Profile> {
  const result: any = await cloudApi.settings(); const user = result.user || {};
  return { id: user.id || userId, displayName: user.name || 'Reader', username: result.settings?.username || undefined, avatarUrl: cloudAssetUrl(user.image || result.settings?.style?.avatarUrl), style: result.settings?.style || undefined };
}
export async function getMyClubs(_userId: string) {
  const result = await cloudApi.clubs(); const clubs: Club[] = result.clubs.map((item, index) => ({ id: item.id, name: item.name, ownerId: item.role === 'owner' ? '' : '', tone: tones[index % tones.length], phase: 'setup', coverImageUrl: item.cover_key || undefined, memberCount: 1 }));
  return { clubs, activeClubId: clubs[0]?.id };
}
export async function setActiveClub(_id: string) { /* selection is local in Cloudflare mode */ }
export async function getWorkspace(_clubId: string, _userId: string): Promise<Workspace> { throw new Error('Workspace loading is handled by the Cloudflare app provider.'); }
export async function createClub(name: string, _tone: Tone) { return (await cloudApi.createClub(name)).club; }
export async function joinClub(code: string) { const joined = await cloudApi.joinInvite(code.trim().split('/').filter(Boolean).pop() || code); return { id: joined.clubId }; }

export async function updateProgress(bookId: string, chapter?: number, status = 'reading', totalChapters?: number, page?: number, totalPages?: number, explicitPercent?: number) {
  const percent = explicitPercent ?? (totalChapters && chapter != null ? Math.round(chapter / totalChapters * 100) : totalPages && page != null ? Math.round(page / totalPages * 100) : undefined);
  return cloudRequest(`/api/books/${encodeURIComponent(bookId)}/progress`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chapter, page, status: status === 'dnf' ? 'not_started' : status, percent, format: explicitPercent != null ? 'percent' : page != null ? 'page' : 'chapter' }) });
}
export async function markAcquired(bookId: string, format = 'Physical') { return cloudApi.bookAction(bookId, 'acquire', { format }); }
export async function setFinishDate(bookId: string, date: string, chapters?: number, pages?: number) { return cloudApi.bookAction(bookId, 'start_reading', { finishDate: date, chapters, pages }); }
export async function rsvp(meetingId: string, _userId: string, response: string) { return cloudRequest(`/api/meetings/${encodeURIComponent(meetingId)}/rsvp`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: response === 'going' ? 'yes' : response === 'cant' ? 'no' : response }) }); }
export async function scheduleMeeting(clubId: string, bookId: string | undefined, _userId: string, startsAt: string, meetingType = 'facetime', meetingUrl?: string, _meetingId?: string, checkpointId?: string) {
  const payload = { startsAt: Date.parse(startsAt), bookId, location: meetingUrl || '', notes: '', checkpointId, meetingType, meetingUrl };
  if (_meetingId) return cloudRequest(`/api/clubs/${encodeURIComponent(clubId)}/meetings/${encodeURIComponent(_meetingId)}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(payload) });
  const result: any = await cloudRequest(`/api/clubs/${encodeURIComponent(clubId)}/meetings`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(payload) });
  return { id: result.meeting?.id, checkpointId, meetingType };
}
export async function saveMeetingOptions(clubId: string, _bookId: string | undefined, startsAt: string[], checkpointId?: string) { if (!checkpointId) throw new Error('Choose a reading checkpoint first.'); return cloudApi.saveMeetingOptions(clubId, checkpointId, startsAt); }
export async function setMeetingOptionResponse(optionId: string, available: boolean) { return cloudApi.setMeetingOption(optionId, available); }
export async function submitMeetingPoll(checkpointId: string) { return cloudApi.submitMeetingPoll(checkpointId); }
export async function createThought(bookId: string, _userId: string, body: string, chapter?: number, type = 'thought') { return cloudApi.createBookPost(bookId, body, type, chapter); }

export async function saveBookToClub(clubId: string, value: { title: string; author: string; cover: string; year?: number; isbn?: string; pages?: number; description?: string; subjects?: string[] }) {
  const result: any = await cloudApi.suggestBook(clubId, value.title, value.author, value.cover, { publishedYear: value.year, isbn: value.isbn, pages: value.pages, description: value.description, subjects: value.subjects }); return { bookId: result.book?.id, clubBookId: result.book?.id, alreadySaved: Boolean(result.alreadySaved), status: result.book?.status || 'suggested' };
}
export async function savePersonalBook(_userId: string, value: { title: string; author: string; cover?: string; year?: number; isbn?: string; pages?: number; description?: string }, options: { shelf?: string; rating?: number; dateFinished?: string | null; isFavorite?: boolean; source?: 'search' | 'goodreads' } = {}) {
  const result: any = await cloudApi.saveLibraryBook({ title: value.title, author: value.author, coverUrl: value.cover, publishedYear: value.year, isbn: value.isbn, pages: value.pages, description: value.description, shelf: options.shelf, rating: options.rating, dateFinished: options.dateFinished, isFavorite: options.isFavorite, source: options.source }); return result.book?.id;
}
export async function updatePersonalBook(_userId: string, libraryId: string, patch: { shelf?: string; rating?: number | null; dateFinished?: string | null; isFavorite?: boolean; isPublic?: boolean; coverUrl?: string | null }) { return cloudApi.updateLibraryBook(libraryId, patch); }
export async function updateProfileStyle(_userId: string, style: ProfileStyle): Promise<ProfileStyle> { const result: any = await cloudApi.updateProfileStyle(style as Record<string, unknown>); return (result.style || style) as ProfileStyle; }
export async function saveClubCoverImage(clubId: string, image: Blob | null, _previousPath?: string) { if (!image) return cloudApi.resetHeader(clubId); return cloudApi.uploadHeader(clubId, image); }
export async function getBookContext(_bookId: string, _chapter?: number) { return []; }
export async function repairBookCover(_bookId: string, _coverUrl: string) { return false; }
export async function getPersonalLibrary(_userId: string) { const result: any = await cloudApi.library(); return (result.books || []).map(libraryItem); }

export async function getBallot(clubId: string, _userId: string) {
  const result: any = await cloudApi.activeBallot(clubId); if (!result.ballot) return null;
  return { ...result.ballot, closes_at: result.ballot.closes_at ? iso(result.ballot.closes_at) : undefined, rankingIds: result.ballot.rankingIds || [], nominations: (result.ballot.nominations || []).map((item: any) => ({ ...item, book: book(item.book), voted: false, preference: undefined })) };
}
export async function startBallotFromIdeas(clubId: string, closesAt?: string) { const result: any = await cloudApi.startBallot(clubId, closesAt ? Date.parse(closesAt) : undefined); return result.ballot?.id; }
export async function castVote(_nominationId: string, _userId?: string) { throw new Error('This club uses ranked-choice voting. Choose your ranked books instead.'); }
export async function setBallotPreference(_nominationId: string, _preference: 'strong_yes' | 'okay' | 'no') { throw new Error('This club uses ranked-choice voting. Choose your ranked books instead.'); }
export async function setBallotRanking(ballotId: string, nominationIds: string[]) { return cloudApi.saveRanking('', ballotId, nominationIds); }
export async function removeClubIdea(bookId: string) { return cloudApi.bookAction(bookId, 'remove_suggestion'); }
export async function revealPrediction(postId: string) { return cloudApi.postAction(postId, 'reveal_prediction'); }
export async function finalizeBallot(ballotId: string) { const result: any = await cloudApi.finalizeBallot(ballotId); return result.bookId; }
export async function getBallotTieBreak(_ballotId: string) { return undefined; }
export async function decideTiedBallot(ballotId: string, _nominationId: string) { return finalizeBallot(ballotId); }
export async function setCheckpointCheckin(checkpointId: string, status: 'reached' | 'catching_up' | 'not_yet') { return cloudApi.checkpointCheckin(checkpointId, status); }
export async function setMyTimezone(timezone: string) { return cloudApi.updateSettings({ timezone }); }
export async function createReply(postId: string, body: string) { return cloudApi.createPostReply(postId, body); }
export async function toggleReaction(postId: string, reaction = 'heart') { const result: any = await cloudApi.togglePostReaction(postId, reaction); return Boolean(result.reacted); }
export async function getMargins(bookId: string, _userId: string): Promise<MarginItem[]> { const result: any = await cloudApi.bookMargins(bookId); return (result.margins || []).map((row: any) => ({ id: String(row.id), kind: row.kind, body: row.body, note: row.note || undefined, chapter: row.chapter ?? undefined, page: row.page ?? undefined, createdAt: iso(row.created_at) })); }
export async function savePrivateNote(bookId: string, body: string, chapter?: number, page?: number) { return cloudApi.createBookMargin(bookId, { kind: 'note', body, chapter, page }); }
export async function saveQuote(bookId: string, body: string, note?: string, chapter?: number, page?: number) { return cloudApi.createBookMargin(bookId, { kind: 'quote', body, note, chapter, page }); }
export async function deleteMargin(_kind: 'note' | 'quote', id: string) { return cloudRequest(`/api/margins/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
export async function finishClubBook(bookId: string) { return cloudApi.bookAction(bookId, 'finish'); }
export async function saveClubRating(bookId: string, rating: number, review = '', recommend?: boolean) { return cloudRequest(`/api/books/${encodeURIComponent(bookId)}/rating`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rating, review, recommend }) }); }
export async function archiveClubBook(bookId: string) { return cloudApi.bookAction(bookId, 'archive'); }
export async function restoreArchivedBook(bookId: string) { return cloudApi.bookAction(bookId, 'restore'); }

export async function updateProfileBasics(_userId: string, displayName: string, username: string) { return cloudApi.updateSettings({ name: displayName, username }); }
export async function updateNotificationMode(_userId: string, mode: string) { return cloudApi.updateSettings({ notificationMode: mode === 'quiet' ? 'essential' : mode }); }
export async function deleteMyAccount() { return cloudApi.deleteAccount(); }
export async function getNotifications(_userId: string): Promise<AppNotification[]> { const result: any = await cloudApi.notifications(); return (result.notifications || []).map((row: any) => ({ id: String(row.id), clubId: row.club_id || undefined, type: row.kind || 'notice', title: row.payload?.title || row.kind || 'BOOK CLUB update', body: row.payload?.body || undefined, deepLink: row.payload?.deepLink || undefined, readAt: row.read_at ? iso(row.read_at) : undefined, createdAt: iso(row.created_at) })); }
export async function markNotificationRead(id: string) { return cloudApi.markNotificationRead(id); }
export async function markAllNotificationsRead(_userId: string) { return cloudApi.markAllNotificationsRead(); }
export async function getNotificationMode(_userId: string) { const result: any = await cloudApi.settings(); return result.settings?.notificationMode || 'essential'; }
export async function getMyExportData(_userId: string) { return cloudApi.exportAccount(); }
export async function createOrGetInvite(clubId: string) { return (await cloudApi.invite(clubId)).code; }
export async function cancelMeeting(meetingId: string) { return cloudApi.cancelMeeting(meetingId); }
export async function saveMeetingQuestion(bookId: string, postId: string | undefined, body: string) { return cloudApi.createBookMeetingQuestion(bookId, body, postId); }
export async function removeMeetingQuestion(id: string) { return cloudRequest(`/api/meeting-questions/${encodeURIComponent(id)}/resolve`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resolved: true }) }); }
export async function resolveMeetingQuestion(id: string, resolved = true) { return cloudRequest(`/api/meeting-questions/${encodeURIComponent(id)}/resolve`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resolved }) }); }
export async function getClubArchive(clubId: string) { const result: any = await cloudApi.archive(clubId); return (result.books || []).map((row: any) => ({ id: String(row.id), status: row.status, createdAt: iso(row.updated_at), book: book(row), ratings: [] })); }
export async function getUnreadNotificationCount(_userId: string) { const result: any = await cloudApi.notifications(); return (result.notifications || []).filter((row: any) => !row.read_at).length; }
export type ReadingPreferences = { avoidances: string[]; moods: string[] };
export async function getReadingPreferences(_userId: string): Promise<ReadingPreferences> { const result: any = await cloudApi.settings(); return { avoidances: Array.isArray(result.settings?.readingAvoidances) ? result.settings.readingAvoidances : [], moods: Array.isArray(result.settings?.readingMoods) ? result.settings.readingMoods : [] }; }
export async function updateReadingPreferences(_userId: string, prefs: ReadingPreferences) { return cloudApi.updateSettings({ readingAvoidances: prefs.avoidances, readingMoods: prefs.moods }); }
export async function previewClubInvite(code: string) { const value: any = await cloudApi.previewInvite(code.trim().split('/').filter(Boolean).pop() || code); return { ...value, id: value.clubId, choosing: (value.books || []).map(book) }; }
export async function getClubInvites(clubId: string) { const result: any = await cloudApi.invites(clubId); return result.invites || []; }
export async function resetClubInvite(clubId: string) { return (await cloudApi.resetInvite(clubId)).code; }
export async function disableClubInvites(clubId: string) { return cloudApi.disableInvites(clubId); }
export async function getSharedMemberProfile(clubId: string, memberId: string) { const result: any = await cloudApi.memberProfile(clubId, memberId); const member = result.member || {}; return { profile: { id: member.id, displayName: member.name || 'Reader', username: member.username || undefined, avatarUrl: cloudAssetUrl(member.image || member.style?.avatarUrl), style: member.style || undefined }, books: (result.library || []).map(libraryItem) }; }
export async function leaveClub(clubId: string) { return cloudApi.leaveClub(clubId); }
export async function removeClubMember(clubId: string, userId: string) { return cloudApi.changeMember(clubId, userId, 'remove'); }
export async function transferClubOwnership(clubId: string, userId: string) { return cloudApi.changeMember(clubId, userId, 'transfer'); }

export type GoodreadsImportBook = { title: string; author: string; isbn?: string; isbn13?: string; rating?: number; pages?: number; year?: number; dateRead?: string; shelf: 'want_to_read' | 'currently_reading' | 'read'; cover?: string };
export type GoodreadsImportPreview = { total: number; read: number; currentlyReading: number; wantToRead: number; rated: number; samples: GoodreadsImportBook[] };
export type GoodreadsImportResult = GoodreadsImportPreview & { imported: number };
const GOODREADS_IMPORT_LIMIT = 500;
function csv(text: string) { const rows: string[][] = [[]]; let value = '', quote = false; for (let index = 0; index < text.length; index++) { const char = text[index]; if (char === '"') { if (quote && text[index + 1] === '"') { value += char; index++; } else quote = !quote; } else if (char === ',' && !quote) { rows.at(-1)!.push(value); value = ''; } else if ((char === '\n' || char === '\r') && !quote) { if (char === '\r' && text[index + 1] === '\n') index++; rows.at(-1)!.push(value); value = ''; rows.push([]); } else value += char; } if (value || rows.at(-1)!.length) rows.at(-1)!.push(value); return rows.filter(row => row.some(cell => cell.trim())); }
function goodreads(fileRows: string[][]): GoodreadsImportBook[] { const headers = fileRows[0]?.map(value => value.trim()) || []; const at = (name: string) => headers.indexOf(name); if (at('Title') < 0 || at('Author') < 0) throw new Error('Choose a Goodreads CSV export with Title and Author columns.'); return fileRows.slice(1).map(row => { const value = (name: string) => at(name) < 0 ? '' : String(row[at(name)] || '').trim(); const title = value('Title'); if (!title) return null; const rawShelf = `${value('Exclusive Shelf')} ${value('Bookshelves')}`.toLowerCase(); const shelf = rawShelf.includes('currently-reading') ? 'currently_reading' : rawShelf.includes('read') && !rawShelf.includes('to-read') ? 'read' : 'want_to_read'; const rating = Number(value('My Rating')); const pages = Number(value('Number of Pages')); const year = Number(value('Year Published')); return { title, author: value('Author') || 'Unknown author', isbn: value('ISBN') || undefined, isbn13: value('ISBN13') || undefined, rating: rating >= 1 && rating <= 5 ? rating : undefined, pages: pages || undefined, year: year || undefined, dateRead: value('Date Read') || undefined, shelf }; }).filter(Boolean) as GoodreadsImportBook[]; }
function dedupeGoodreads(rows: GoodreadsImportBook[]): GoodreadsImportBook[] { const unique = new Map<string, GoodreadsImportBook>(); rows.forEach(row => { const key = `${row.title.trim().toLocaleLowerCase()}::${row.author.trim().toLocaleLowerCase()}`; unique.set(key, row); }); return [...unique.values()]; }
function boundedGoodreads(rows: GoodreadsImportBook[]): GoodreadsImportBook[] { return dedupeGoodreads(rows).slice(0, GOODREADS_IMPORT_LIMIT); }
function summary(rows: GoodreadsImportBook[]): GoodreadsImportPreview { return { total: rows.length, read: rows.filter(row => row.shelf === 'read').length, currentlyReading: rows.filter(row => row.shelf === 'currently_reading').length, wantToRead: rows.filter(row => row.shelf === 'want_to_read').length, rated: rows.filter(row => row.rating != null).length, samples: rows.slice(0, 6) }; }
export async function previewGoodreadsImport(file: File): Promise<GoodreadsImportPreview> { if (!/\.csv$/i.test(file.name)) throw new Error('Choose a Goodreads CSV file.'); return summary(boundedGoodreads(goodreads(csv(await file.text())))); }
export async function importGoodreads(_userId: string, file: File, onProgress?: (done: number, total: number) => void): Promise<GoodreadsImportResult> { const rows = boundedGoodreads(goodreads(csv(await file.text()))); const result: any = await cloudApi.importLibrary(rows.map(row => ({ title: row.title, author: row.author, isbn: row.isbn13 || row.isbn, pages: row.pages, publishedYear: row.year, shelf: row.shelf, rating: row.rating, dateFinished: row.dateRead, source: 'goodreads' }))); rows.forEach((_row, index) => onProgress?.(index + 1, rows.length)); return { ...summary(rows), imported: Number(result.imported || rows.length) }; }

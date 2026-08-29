import { createAuth, sessionFor } from './auth';
import { clubSummary, createClub, getActiveBallot, listClubs, startBallot, suggestBook, submitRankings } from './clubs';
import type { Env } from './env';
import { HttpError, json, noContent, withCors } from './http';
import { cleanupMedia, issueHeaderUrl, resetHeader, serveMedia, uploadHeader } from './media';
import { createPost, createReply, listDiscussion, listReplies, toggleReaction } from './discussion';
import { createOrGetInvite, disableInvites, joinInvite, listInvites, previewInvite, resetInvite } from './invitations';
import { createMeeting, listMeetings, setRsvp, updateMeeting } from './meetings';
import { addCheckpointOptions, createCheckpoint, readingRoom, saveProgress, voteCheckpointOption } from './reading';
import { cacheContext, deleteMyAccount, exportMyData, getContext, getProfile, listNotifications, markAllNotificationsRead, markNotificationRead, updateProfile } from './account';
import { changeMembership, createMargin, createMeetingQuestion, deleteLibrary, deleteMargin, getMemberProfile, getSettings, importLibrary, leaveClub, listArchive, listLibrary, listMargins, listMeetingQuestions, listMembers, patchLibrary, rateBook, resolveMeetingQuestion, updateBookStatus, updateSettings, upsertLibrary } from './product';
import { calendarCallback, calendarStatus, disconnectCalendar, removeCalendarEvent, removeReadingPlan, startCalendar, syncMeeting, syncReadingPlan } from './calendar';
import { bookDecision, bookDiscovery, enrichBook, meetingGuide, readerContext, resolveCover, transcribePassage } from './integrations';
import { loadWorkspace } from './workspace';
import { bookAction, cancelMeetingAction, checkpointCheckin, createMeetingOptions, finalizeBallotAction, postAction, setMeetingOption, submitMeetingPollAction } from './actions';
import { cleanupProfileMedia, profileMediaPath, serveProfileMedia, updateProfileStyle } from './profileMedia';

function pathParts(pathname: string): string[] { return pathname.split('/').filter(Boolean).map(decodeURIComponent); }

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return noContent();
  if (url.pathname === '/health') return json({ ok: true, backend: 'd1-r2' });

  // Better Auth owns these routes, OAuth state, password hashing and cookies.
  if (url.pathname.startsWith('/api/auth/')) return createAuth(env).handler(request);
  if (request.method === 'GET' && url.pathname === '/api/calendar/callback') return calendarCallback(request, env);

  const session = await sessionFor(request, env);
  if (request.method === 'GET' && url.pathname === '/api/me') return json({ user: session?.user ?? null });
  if (request.method === 'GET' && url.pathname === '/api/book-discovery') return bookDiscovery(env);
  if (request.method === 'GET' && url.pathname === '/api/profile') return getProfile(env, session);
  if (request.method === 'PUT' && url.pathname === '/api/profile') return updateProfile(request, env, session);
  if (request.method === 'PUT' && url.pathname === '/api/profile/style') return updateProfileStyle(request, env, session);
  const profileMedia = request.method === 'GET' ? profileMediaPath(url.pathname) : null;
  if (profileMedia) return serveProfileMedia(env, session, profileMedia.userId, profileMedia.kind, profileMedia.version);
  if (request.method === 'GET' && url.pathname === '/api/account/export') return exportMyData(env, session);
  if (request.method === 'DELETE' && url.pathname === '/api/account') return deleteMyAccount(env, session);
  if (request.method === 'GET' && url.pathname === '/api/settings') return getSettings(env, session);
  if (request.method === 'PUT' && url.pathname === '/api/settings') return updateSettings(request, env, session);
  if (request.method === 'GET' && url.pathname === '/api/library') return listLibrary(env, session);
  if (request.method === 'POST' && url.pathname === '/api/library') return upsertLibrary(request, env, session);
  if (request.method === 'POST' && url.pathname === '/api/library/import') return importLibrary(request, env, session);
  if (request.method === 'GET' && url.pathname === '/api/notifications') return listNotifications(env, session);
  if (request.method === 'GET' && url.pathname === '/api/calendar/status') return calendarStatus(env, session);
  if (request.method === 'POST' && url.pathname === '/api/calendar/start') return startCalendar(env, session);
  if (request.method === 'POST' && url.pathname === '/api/calendar/disconnect') return disconnectCalendar(env, session);
  if (request.method === 'POST' && url.pathname === '/api/reader-context') return readerContext(request, env, session);
  if (request.method === 'POST' && url.pathname === '/api/meeting-guide') return meetingGuide(request, env, session);
  if (request.method === 'POST' && url.pathname === '/api/book-decision') return bookDecision(request, env, session);
  if (request.method === 'POST' && url.pathname === '/api/transcribe-passage') return transcribePassage(request, env, session);
  if (request.method === 'POST' && url.pathname === '/api/book-cover/resolve') return resolveCover(request, env, session);
  if (request.method === 'POST' && url.pathname === '/api/enrich') return enrichBook(request, env, session);
  if (request.method === 'POST' && url.pathname === '/api/notifications/read-all') return markAllNotificationsRead(env, session);
  if (request.method === 'POST' && topPath(url.pathname, 'api', 'ballots')?.[3] === 'finalize') return finalizeBallotAction(request, env, session, topPath(url.pathname, 'api', 'ballots')![2]);
  if (request.method === 'POST' && partsFor(url.pathname)[0] === 'api' && partsFor(url.pathname)[1] === 'notifications' && partsFor(url.pathname)[2] && partsFor(url.pathname)[3] === 'read') return markNotificationRead(env, session, partsFor(url.pathname)[2]);
  const topParts = pathParts(url.pathname);
  if (topParts[0] === 'api' && topParts[1] === 'books' && topParts[2] && topParts.length >= 4) {
    const book = await env.DB.prepare('SELECT club_id FROM books WHERE id=?').bind(topParts[2]).first<{ club_id: string }>();
    if (!book) throw new HttpError(404, 'Book not found.', 'not_found');
    if (topParts[3] === 'posts' && topParts.length === 4 && request.method === 'POST') return createPost(request, env, session, book.club_id);
    if (topParts[3] === 'progress' && topParts.length === 4 && request.method === 'PUT') return saveProgress(request, env, session, book.club_id, topParts[2]);
    if (topParts[3] === 'rating' && topParts.length === 4 && request.method === 'PUT') return rateBook(request, env, session, book.club_id, topParts[2]);
    if (topParts[3] === 'margins' && topParts.length === 4) {
      if (request.method === 'GET') return listMargins(env, session, book.club_id, topParts[2]);
      if (request.method === 'POST') return createMargin(request, env, session, book.club_id, topParts[2]);
    }
    if (topParts[3] === 'meeting-questions' && topParts.length === 4) {
      if (request.method === 'GET') return listMeetingQuestions(env, session, book.club_id, topParts[2]);
      if (request.method === 'POST') return createMeetingQuestion(request, env, session, book.club_id, topParts[2]);
    }
  }
  if (topParts[0] === 'api' && topParts[1] === 'meetings' && topParts[2] && topParts[3] === 'rsvp' && topParts.length === 4 && request.method === 'PUT') {
    const meeting = await env.DB.prepare('SELECT club_id FROM meetings WHERE id=?').bind(topParts[2]).first<{ club_id: string }>();
    if (!meeting) throw new HttpError(404, 'Meeting not found.', 'not_found');
    return setRsvp(request, env, session, meeting.club_id, topParts[2]);
  }
  if (topParts[0] === 'api' && topParts[1] === 'meetings' && topParts[2] && topParts[3] === 'calendar' && topParts.length === 4) {
    const meeting = await env.DB.prepare('SELECT club_id FROM meetings WHERE id=?').bind(topParts[2]).first<{ club_id: string }>();
    if (!meeting) throw new HttpError(404, 'Meeting not found.', 'not_found');
    if (request.method === 'POST') return syncMeeting(env, session, meeting.club_id, topParts[2]);
    if (request.method === 'DELETE') {
      if (!session) throw new HttpError(401, 'Sign in is required.', 'unauthenticated');
      const event = await env.DB.prepare("SELECT id FROM calendar_events WHERE user_id=? AND meeting_id=? AND kind='meeting'").bind(session.user.id, topParts[2]).first<{ id: string }>();
      return event ? removeCalendarEvent(env, session, event.id) : json({ removed: true });
    }
  }
  if (topParts[0] === 'api' && topParts[1] === 'books' && topParts[2] && topParts[3] === 'calendar-reading-plan' && topParts.length === 4) {
    const book = await env.DB.prepare('SELECT club_id FROM books WHERE id=?').bind(topParts[2]).first<{ club_id: string }>();
    if (!book) throw new HttpError(404, 'Book not found.', 'not_found');
    if (request.method === 'POST') return syncReadingPlan(env, session, book.club_id, topParts[2]);
    if (request.method === 'DELETE') return removeReadingPlan(env, session, book.club_id, topParts[2]);
  }
  if (topParts[0] === 'api' && topParts[1] === 'margins' && topParts[2] && topParts.length === 3 && request.method === 'DELETE') {
    const margin = await env.DB.prepare('SELECT club_id FROM reader_margins WHERE id=?').bind(topParts[2]).first<{ club_id: string }>();
    if (!margin) return noContent();
    return deleteMargin(env, session, margin.club_id, topParts[2]);
  }
  if (topParts[0] === 'api' && topParts[1] === 'meeting-questions' && topParts[2] && topParts[3] === 'resolve' && topParts.length === 4 && request.method === 'PUT') {
    const question = await env.DB.prepare('SELECT club_id FROM meeting_questions WHERE id=?').bind(topParts[2]).first<{ club_id: string }>();
    if (!question) throw new HttpError(404, 'Meeting question not found.', 'not_found');
    return resolveMeetingQuestion(request, env, session, question.club_id, topParts[2]);
  }
  if (topParts[0] === 'api' && topParts[1] === 'posts' && topParts[2] && topParts.length >= 4 && (topParts[3] === 'replies' || topParts[3] === 'reaction')) {
    const post = await env.DB.prepare('SELECT club_id FROM discussion_posts WHERE id=?').bind(topParts[2]).first<{ club_id: string }>();
    if (!post) throw new HttpError(404, 'Discussion post not found.', 'not_found');
    if (topParts[3] === 'replies') {
      if (request.method === 'GET') return listReplies(env, session, post.club_id, topParts[2]);
      if (request.method === 'POST') return createReply(request, env, session, post.club_id, topParts[2]);
    }
    if (topParts[3] === 'reaction' && request.method === 'POST') return toggleReaction(request, env, session, post.club_id, topParts[2]);
  }
  if (topParts[0] === 'api' && topParts[1] === 'books' && topParts[2] && topParts[3] === 'actions' && topParts.length === 4 && request.method === 'POST') return bookAction(request, env, session, topParts[2]);
  if (topParts[0] === 'api' && topParts[1] === 'posts' && topParts[2] && topParts[3] === 'actions' && topParts.length === 4 && request.method === 'POST') return postAction(request, env, session, topParts[2]);
  if (topParts[0] === 'api' && topParts[1] === 'checkpoints' && topParts[2] && topParts[3] === 'checkin' && topParts.length === 4 && request.method === 'PUT') return checkpointCheckin(request, env, session, topParts[2]);
  if (topParts[0] === 'api' && topParts[1] === 'checkpoints' && topParts[2] && topParts[3] === 'submit-meeting-poll' && topParts.length === 4 && request.method === 'POST') return submitMeetingPollAction(env, session, topParts[2]);
  if (topParts[0] === 'api' && topParts[1] === 'meeting-options' && topParts[2] && topParts.length === 3 && request.method === 'PUT') return setMeetingOption(request, env, session, topParts[2]);
  if (topParts[0] === 'api' && topParts[1] === 'meetings' && topParts[2] && topParts[3] === 'cancel' && topParts.length === 4 && request.method === 'POST') return cancelMeetingAction(env, session, topParts[2]);
  if (topParts[0] === 'api' && topParts[1] === 'calendar' && topParts[2] === 'events' && topParts[3] && topParts.length === 4 && request.method === 'DELETE') return removeCalendarEvent(env, session, topParts[3]);
  if (topParts[0] === 'api' && topParts[1] === 'library' && topParts[2] && topParts.length === 3) {
    if (request.method === 'PUT') return patchLibrary(request, env, session, topParts[2]);
    if (request.method === 'DELETE') return deleteLibrary(env, session, topParts[2]);
  }
  if (request.method === 'PUT' && topParts[0] === 'api' && topParts[1] === 'ballots' && topParts[2] && topParts[3] === 'rankings' && topParts.length === 4) {
    const ballot = await env.DB.prepare('SELECT club_id FROM ballots WHERE id = ?').bind(topParts[2]).first<{ club_id: string }>();
    if (!ballot) throw new HttpError(404, 'Ballot not found.', 'not_found');
    return submitRankings(request, env, session, ballot.club_id, topParts[2]);
  }
  if (partsFor(url.pathname)[0] === 'api' && partsFor(url.pathname)[1] === 'invites' && partsFor(url.pathname)[2]) {
    const code = partsFor(url.pathname)[2];
    if (request.method === 'GET' && partsFor(url.pathname).length === 3) return previewInvite(env, code);
    if (request.method === 'POST' && partsFor(url.pathname).length === 3) return joinInvite(request, env, session, code);
  }
  if (request.method === 'GET' && url.pathname === '/api/clubs') return listClubs(env, session);
  if (request.method === 'POST' && url.pathname === '/api/clubs') return createClub(request, env, session);

  const parts = pathParts(url.pathname);
  if (parts[0] === 'api' && parts[1] === 'clubs' && parts[2]) {
    const clubId = parts[2];
    if (request.method === 'GET' && parts.length === 3) return clubSummary(env, session, clubId);
    if (request.method === 'GET' && parts[3] === 'workspace' && parts.length === 4) return loadWorkspace(env, session, clubId);
    if (request.method === 'POST' && parts[3] === 'leave' && parts.length === 4) return leaveClub(env, session, clubId);
    if (request.method === 'POST' && parts[3] === 'meetings' && parts[4] && parts[5] === 'calendar' && parts.length === 6) return syncMeeting(env, session, clubId, parts[4]);
    if (parts[3] === 'books' && parts[4] && parts[5] === 'calendar-reading-plan' && parts.length === 6) {
      if (request.method === 'POST') return syncReadingPlan(env, session, clubId, parts[4]);
      if (request.method === 'DELETE') return removeReadingPlan(env, session, clubId, parts[4]);
    }
    if (request.method === 'GET' && parts[3] === 'members' && parts.length === 4) return listMembers(env, session, clubId);
    if (parts[3] === 'members' && parts[4] && parts.length === 5) {
      if (request.method === 'GET') return getMemberProfile(env, session, clubId, parts[4]);
      if (request.method === 'PUT') return changeMembership(request, env, session, clubId, parts[4]);
    }
    if (request.method === 'GET' && parts[3] === 'archive' && parts.length === 4) return listArchive(env, session, clubId);
    if (request.method === 'POST' && parts[3] === 'books' && parts.length === 4) return suggestBook(request, env, session, clubId);
    if (request.method === 'POST' && parts[3] === 'ballots' && parts.length === 4) return startBallot(request, env, session, clubId);
    if (request.method === 'GET' && parts[3] === 'ballot' && parts.length === 4) return getActiveBallot(env, session, clubId);
    if (request.method === 'GET' && parts[3] === 'discussion' && parts.length === 4) return listDiscussion(request, env, session, clubId);
    if (request.method === 'POST' && parts[3] === 'discussion' && parts.length === 4) return createPost(request, env, session, clubId);
    if (request.method === 'GET' && parts[3] === 'discussion' && parts[4] && parts[5] === 'replies' && parts.length === 6) return listReplies(env, session, clubId, parts[4]);
    if (request.method === 'POST' && parts[3] === 'discussion' && parts[4] && parts[5] === 'replies' && parts.length === 6) return createReply(request, env, session, clubId, parts[4]);
    if (request.method === 'POST' && parts[3] === 'discussion' && parts[4] && parts[5] === 'reaction' && parts.length === 6) return toggleReaction(request, env, session, clubId, parts[4]);
    if (request.method === 'PUT' && parts[3] === 'header' && parts.length === 4) return uploadHeader(request, env, session, clubId);
    if (request.method === 'DELETE' && parts[3] === 'header' && parts.length === 4) return resetHeader(env, session, clubId);
    if (request.method === 'GET' && parts[3] === 'header-url' && parts.length === 4) return json({ url: await issueHeaderUrl(env, session, clubId) });
    if (request.method === 'POST' && parts[3] === 'invite' && parts.length === 4) return createOrGetInvite(env, session, clubId);
    if (request.method === 'GET' && parts[3] === 'invites' && parts.length === 4) return listInvites(env, session, clubId);
    if (request.method === 'POST' && parts[3] === 'invite/reset' && parts.length === 4) return resetInvite(env, session, clubId);
    if (request.method === 'POST' && parts[3] === 'invite/disable' && parts.length === 4) return disableInvites(env, session, clubId);
    if (request.method === 'GET' && parts[3] === 'meetings' && parts.length === 4) return listMeetings(env, session, clubId);
    if (request.method === 'POST' && parts[3] === 'meetings' && parts.length === 4) return createMeeting(request, env, session, clubId);
    if (request.method === 'PUT' && parts[3] === 'meetings' && parts[4] && parts.length === 5) return updateMeeting(request, env, session, clubId, parts[4]);
    if (request.method === 'POST' && parts[3] === 'meeting-options' && parts.length === 4) return createMeetingOptions(request, env, session, clubId);
    if (request.method === 'PUT' && parts[3] === 'meetings' && parts[4] && parts[5] === 'rsvp' && parts.length === 6) return setRsvp(request, env, session, clubId, parts[4]);
    if (request.method === 'GET' && parts[3] === 'books' && parts[4] && parts[5] === 'reading-room' && parts.length === 6) return readingRoom(env, session, clubId, parts[4]);
    if (request.method === 'PUT' && parts[3] === 'books' && parts[4] && parts[5] === 'progress' && parts.length === 6) return saveProgress(request, env, session, clubId, parts[4]);
    if (request.method === 'POST' && parts[3] === 'books' && parts[4] && parts[5] === 'checkpoints' && parts.length === 6) return createCheckpoint(request, env, session, clubId, parts[4]);
    if (request.method === 'PUT' && parts[3] === 'books' && parts[4] && parts[5] === 'status' && parts.length === 6) return updateBookStatus(request, env, session, clubId, parts[4]);
    if (request.method === 'PUT' && parts[3] === 'books' && parts[4] && parts[5] === 'rating' && parts.length === 6) return rateBook(request, env, session, clubId, parts[4]);
    if (request.method === 'GET' && parts[3] === 'books' && parts[4] && parts[5] === 'margins' && parts.length === 6) return listMargins(env, session, clubId, parts[4]);
    if (request.method === 'POST' && parts[3] === 'books' && parts[4] && parts[5] === 'margins' && parts.length === 6) return createMargin(request, env, session, clubId, parts[4]);
    if (request.method === 'GET' && parts[3] === 'books' && parts[4] && parts[5] === 'meeting-questions' && parts.length === 6) return listMeetingQuestions(env, session, clubId, parts[4]);
    if (request.method === 'POST' && parts[3] === 'books' && parts[4] && parts[5] === 'meeting-questions' && parts.length === 6) return createMeetingQuestion(request, env, session, clubId, parts[4]);
    if (request.method === 'DELETE' && parts[3] === 'margins' && parts[4] && parts.length === 5) return deleteMargin(env, session, clubId, parts[4]);
    if (request.method === 'PUT' && parts[3] === 'meeting-questions' && parts[4] && parts[5] === 'resolve' && parts.length === 6) return resolveMeetingQuestion(request, env, session, clubId, parts[4]);
    if (request.method === 'POST' && parts[3] === 'checkpoints' && parts[4] && parts[5] === 'options' && parts.length === 6) return addCheckpointOptions(request, env, session, clubId, parts[4]);
    if (request.method === 'POST' && parts[3] === 'checkpoints' && parts[4] && parts[5] === 'vote' && parts.length === 6) return voteCheckpointOption(request, env, session, clubId, parts[4]);
    if (request.method === 'GET' && parts[3] === 'ai-context' && parts[4] && parts.length === 5) return getContext(env, session, clubId, parts[4]);
    if (request.method === 'PUT' && parts[3] === 'ai-context' && parts.length === 4) return cacheContext(request, env, session, clubId);
    if (request.method === 'PUT' && parts[3] === 'ballots' && parts[4] && parts[5] === 'rankings' && parts.length === 6) return submitRankings(request, env, session, clubId, parts[4]);
  }
  if (parts[0] === 'api' && parts[1] === 'media' && parts.length >= 3 && request.method === 'GET') return serveMedia(request, env, session, parts.slice(2).join('/'));
  throw new HttpError(404, 'Route not found.', 'not_found');
}

export default {
  async fetch(request, env): Promise<Response> {
    try { return withCors(await route(request, env), request, env); }
    catch (error) {
      const known = error instanceof HttpError;
      if (!known) console.error(JSON.stringify({ event: 'request_failed', method: request.method, path: new URL(request.url).pathname, message: error instanceof Error ? error.message : 'Unknown error' }));
      return withCors(json({ error: known ? error.code : 'internal_error', message: known ? error.message : 'Something went wrong.' }, known ? error.status : 500), request, env);
    }
  },
  scheduled(_controller, env, ctx): void {
    // Retires failed uploads and replaced objects without any browser polling.
    ctx.waitUntil(Promise.all([cleanupMedia(env), cleanupProfileMedia(env)]).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;

function partsFor(pathname: string): string[] { return pathParts(pathname); }
function topPath(pathname: string, first: string, second: string): string[] | null {
  const parts = pathParts(pathname);
  return parts[0] === first && parts[1] === second ? parts : null;
}

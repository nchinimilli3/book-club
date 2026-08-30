/**
 * Cloudflare backend client for the staged D1/R2 migration. This does not turn
 * on until every current Supabase resource has endpoint and UI parity tests.
 * Auth uses secure HttpOnly cookies; no database or storage key reaches Vite.
 */
export class CloudApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const CLOUD_API_BASE = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

/** Resolve media references returned by the API against the same API origin.
 * Profile and club media are authenticated routes, so leaving a relative
 * reference unresolved can send an image request to the Pages host instead
 * of the configured Worker when the API is deployed separately.
 */
export function cloudAssetUrl(value?: string | null): string | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  if (/^(?:data|blob|https?):/i.test(raw)) return raw;
  try { return new URL(raw, CLOUD_API_BASE || window.location.origin).toString(); }
  catch { return raw; }
}

export type CloudClub = { id: string; name: string; description: string; cover_key?: string | null; role: 'owner' | 'admin' | 'member' };

export async function cloudRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${CLOUD_API_BASE}${path}`, { ...init, credentials: 'include', headers: { accept: 'application/json', ...init.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new CloudApiError(response.status, payload.error ?? 'request_failed', payload.message ?? 'Request failed.');
  return payload as T;
}
const request = cloudRequest;

export const cloudApi = {
  session: () => request<{ user: { id: string; email: string; name: string } | null }>('/api/me'),
  clubs: () => request<{ clubs: CloudClub[] }>('/api/clubs'),
  createClub: (name: string, description = '') => request<{ club: CloudClub }>('/api/clubs', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ name, description }) }),
  clubSummary: (clubId: string) => request(`/api/clubs/${encodeURIComponent(clubId)}`),
  workspace: (clubId: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/workspace`),
  suggestBook: (clubId: string, title: string, author = '', coverUrl?: string, details: Record<string, unknown> = {}) => request(`/api/clubs/${encodeURIComponent(clubId)}/books`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ title, author, coverUrl, ...details }) }),
  startBallot: (clubId: string, closesAt?: number) => request(`/api/clubs/${encodeURIComponent(clubId)}/ballots`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ closesAt }) }),
  activeBallot: (clubId: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/ballot`),
  saveRanking: (clubId: string, ballotId: string, rankings: string[]) => request(`${clubId ? `/api/clubs/${encodeURIComponent(clubId)}/ballots/${encodeURIComponent(ballotId)}/rankings` : `/api/ballots/${encodeURIComponent(ballotId)}/rankings`}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ rankings }) }),
  invite: (clubId: string) => request<{ code: string; expiresAt: number }>(`/api/clubs/${encodeURIComponent(clubId)}/invite`, { method: 'POST' }),
  invites: (clubId: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/invites`),
  resetInvite: (clubId: string) => request<{ code: string; expiresAt: number }>(`/api/clubs/${encodeURIComponent(clubId)}/invite/reset`, { method: 'POST' }),
  disableInvites: (clubId: string) => request<{ disabled: true }>(`/api/clubs/${encodeURIComponent(clubId)}/invite/disable`, { method: 'POST' }),
  previewInvite: (code: string) => request(`/api/invites/${encodeURIComponent(code)}`),
  joinInvite: (code: string) => request<{ clubId: string }>(`/api/invites/${encodeURIComponent(code)}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ code }) }),
  meetings: (clubId: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/meetings`),
  createMeeting: (clubId: string, startsAt: number, bookId?: string, location = '', notes = '') => request(`/api/clubs/${encodeURIComponent(clubId)}/meetings`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ startsAt, bookId, location, notes }) }),
  rsvp: (clubId: string, meetingId: string, status: 'yes' | 'no' | 'maybe') => request(`/api/clubs/${encodeURIComponent(clubId)}/meetings/${encodeURIComponent(meetingId)}/rsvp`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) }),
  readingRoom: (clubId: string, bookId: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/books/${encodeURIComponent(bookId)}/reading-room`),
  saveProgress: (clubId: string, bookId: string, progress: Record<string, unknown>) => request(`/api/clubs/${encodeURIComponent(clubId)}/books/${encodeURIComponent(bookId)}/progress`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(progress) }),
  createCheckpoint: (clubId: string, bookId: string, checkpoint: Record<string, unknown>) => request(`/api/clubs/${encodeURIComponent(clubId)}/books/${encodeURIComponent(bookId)}/checkpoints`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(checkpoint) }),
  addCheckpointOptions: (clubId: string, checkpointId: string, startsAt: number[]) => request(`/api/clubs/${encodeURIComponent(clubId)}/checkpoints/${encodeURIComponent(checkpointId)}/options`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startsAt }) }),
  voteCheckpointOption: (clubId: string, checkpointId: string, optionId: string, available: boolean) => request(`/api/clubs/${encodeURIComponent(clubId)}/checkpoints/${encodeURIComponent(checkpointId)}/vote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ optionId, available }) }),
  profile: () => request('/api/profile'),
  updateProfileStyle: (style: Record<string, unknown>) => request<{ style: Record<string, unknown> }>('/api/profile/style', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ style }) }),
  updateProfile: (name: string, image?: string) => request('/api/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, image }) }),
  settings: () => request('/api/settings'),
  updateSettings: (settings: Record<string, unknown>) => request('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) }),
  library: () => request('/api/library'),
  saveLibraryBook: (book: Record<string, unknown>) => request('/api/library', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(book) }),
  importLibrary: (books: Record<string, unknown>[]) => request('/api/library/import', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ books }) }),
  updateLibraryBook: (id: string, book: Record<string, unknown>) => request(`/api/library/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(book) }),
  deleteLibraryBook: (id: string) => request(`/api/library/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  notifications: () => request('/api/notifications'),
  markNotificationRead: (notificationId: string) => request(`/api/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'POST' }),
  markAllNotificationsRead: () => request('/api/notifications/read-all', { method: 'POST' }),
  aiContext: (clubId: string, key: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/ai-context/${encodeURIComponent(key)}`),
  cacheAiContext: (clubId: string, key: string, value: unknown, expiresAt?: number) => request(`/api/clubs/${encodeURIComponent(clubId)}/ai-context`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, value, expiresAt }) }),
  discussion: (clubId: string, bookId?: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/discussion${bookId ? `?bookId=${encodeURIComponent(bookId)}` : ''}`),
  createPost: (clubId: string, body: string, bookId?: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/discussion`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ body, bookId }) }),
  replies: (clubId: string, postId: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/discussion/${encodeURIComponent(postId)}/replies`),
  createReply: (clubId: string, postId: string, body: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/discussion/${encodeURIComponent(postId)}/replies`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ body }) }),
  toggleReaction: (clubId: string, postId: string, emoji = 'heart') => request(`/api/clubs/${encodeURIComponent(clubId)}/discussion/${encodeURIComponent(postId)}/reaction`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ emoji }) }),
  headerUrl: (clubId: string) => request<{ url: string }>(`/api/clubs/${encodeURIComponent(clubId)}/header-url`),
  uploadHeader: (clubId: string, file: Blob) => request<{ key: string; url: string }>(`/api/clubs/${encodeURIComponent(clubId)}/header`, { method: 'PUT', headers: { 'content-type': 'image/webp' }, body: file }),
  resetHeader: (clubId: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/header`, { method: 'DELETE' }),
  members: (clubId: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/members`),
  memberProfile: (clubId: string, memberId: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/members/${encodeURIComponent(memberId)}`),
  changeMember: (clubId: string, memberId: string, action: 'remove' | 'transfer' | 'role', role?: 'admin' | 'member') => request(`/api/clubs/${encodeURIComponent(clubId)}/members/${encodeURIComponent(memberId)}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ action, role }) }),
  leaveClub: (clubId: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/leave`, { method: 'POST' }),
  archive: (clubId: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/archive`),
  setBookStatus: (clubId: string, bookId: string, status: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/books/${encodeURIComponent(bookId)}/status`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) }),
  rateBook: (clubId: string, bookId: string, rating: number, review = '', recommend?: boolean) => request(`/api/clubs/${encodeURIComponent(clubId)}/books/${encodeURIComponent(bookId)}/rating`, { method: 'PUT', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ rating, review, recommend }) }),
  margins: (clubId: string, bookId: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/books/${encodeURIComponent(bookId)}/margins`),
  createMargin: (clubId: string, bookId: string, margin: Record<string, unknown>) => request(`/api/clubs/${encodeURIComponent(clubId)}/books/${encodeURIComponent(bookId)}/margins`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(margin) }),
  deleteMargin: (clubId: string, marginId: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/margins/${encodeURIComponent(marginId)}`, { method: 'DELETE' }),
  meetingQuestions: (clubId: string, bookId: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/books/${encodeURIComponent(bookId)}/meeting-questions`),
  createMeetingQuestion: (clubId: string, bookId: string, body: string, postId?: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/books/${encodeURIComponent(bookId)}/meeting-questions`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ body, postId }) }),
  resolveMeetingQuestion: (clubId: string, questionId: string, resolved = true) => request(`/api/clubs/${encodeURIComponent(clubId)}/meeting-questions/${encodeURIComponent(questionId)}/resolve`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resolved }) }),
  calendarStatus: () => request('/api/calendar/status'),
  startCalendar: () => request<{ url: string }>('/api/calendar/start', { method: 'POST' }),
  disconnectCalendar: () => request('/api/calendar/disconnect', { method: 'POST' }),
  syncMeetingCalendar: (clubId: string, meetingId: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/meetings/${encodeURIComponent(meetingId)}/calendar`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() } }),
  syncMeetingCalendarById: (meetingId: string) => request(`/api/meetings/${encodeURIComponent(meetingId)}/calendar`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() } }),
  removeMeetingCalendarById: (meetingId: string) => request(`/api/meetings/${encodeURIComponent(meetingId)}/calendar`, { method: 'DELETE' }),
  removeCalendarEvent: (eventId: string) => request(`/api/calendar/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' }),
  syncReadingPlanCalendar: (clubId: string, bookId: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/books/${encodeURIComponent(bookId)}/calendar-reading-plan`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() } }),
  removeReadingPlanCalendar: (clubId: string, bookId: string) => request(`/api/clubs/${encodeURIComponent(clubId)}/books/${encodeURIComponent(bookId)}/calendar-reading-plan`, { method: 'DELETE' }),
  syncReadingPlanCalendarById: (bookId: string) => request(`/api/books/${encodeURIComponent(bookId)}/calendar-reading-plan`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() } }),
  removeReadingPlanCalendarById: (bookId: string) => request(`/api/books/${encodeURIComponent(bookId)}/calendar-reading-plan`, { method: 'DELETE' }),
  readerContext: (input: Record<string, unknown>) => request('/api/reader-context', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }),
  meetingGuide: (input: Record<string, unknown>) => request('/api/meeting-guide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }),
  bookDecision: (input: Record<string, unknown>) => request('/api/book-decision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }),
  transcribePassage: (input: Record<string, unknown>) => request('/api/transcribe-passage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }),
  resolveBookCover: (input: Record<string, unknown>) => request('/api/book-cover/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }),
  enrichBook: (title: string, author: string) => request(`/api/enrich`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, author }) }),
  bookAction: (bookId: string, action: string, input: Record<string, unknown> = {}) => request(`/api/books/${encodeURIComponent(bookId)}/actions`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ action, ...input }) }),
  postAction: (postId: string, action: string) => request(`/api/posts/${encodeURIComponent(postId)}/actions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) }),
  finalizeBallot: (ballotId: string) => request(`/api/ballots/${encodeURIComponent(ballotId)}/finalize`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() } }),
  checkpointCheckin: (checkpointId: string, status: string) => request(`/api/checkpoints/${encodeURIComponent(checkpointId)}/checkin`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) }),
  saveMeetingOptions: (clubId: string, checkpointId: string, startsAt: string[]) => request(`/api/clubs/${encodeURIComponent(clubId)}/meeting-options`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ checkpointId, startsAt }) }),
  setMeetingOption: (optionId: string, available: boolean) => request(`/api/meeting-options/${encodeURIComponent(optionId)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ available }) }),
  submitMeetingPoll: (checkpointId: string) => request(`/api/checkpoints/${encodeURIComponent(checkpointId)}/submit-meeting-poll`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() } }),
  cancelMeeting: (meetingId: string) => request(`/api/meetings/${encodeURIComponent(meetingId)}/cancel`, { method: 'POST' }),
  createBookPost: (bookId: string, body: string, type = 'thought', chapter?: number) => request(`/api/books/${encodeURIComponent(bookId)}/posts`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ body, bookId, type, chapter }) }),
  bookMargins: (bookId: string) => request(`/api/books/${encodeURIComponent(bookId)}/margins`),
  createBookMargin: (bookId: string, margin: Record<string, unknown>) => request(`/api/books/${encodeURIComponent(bookId)}/margins`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(margin) }),
  bookMeetingQuestions: (bookId: string) => request(`/api/books/${encodeURIComponent(bookId)}/meeting-questions`),
  createBookMeetingQuestion: (bookId: string, body: string, postId?: string) => request(`/api/books/${encodeURIComponent(bookId)}/meeting-questions`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ body, postId }) }),
  postReplies: (postId: string) => request(`/api/posts/${encodeURIComponent(postId)}/replies`),
  createPostReply: (postId: string, body: string) => request(`/api/posts/${encodeURIComponent(postId)}/replies`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ body }) }),
  togglePostReaction: (postId: string, emoji = 'heart') => request(`/api/posts/${encodeURIComponent(postId)}/reaction`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ emoji }) }),
  exportAccount: () => request('/api/account/export'),
  deleteAccount: () => request('/api/account', { method: 'DELETE' }),
};

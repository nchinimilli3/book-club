import type { AuthSession } from './auth';
import { requireMember, requireSession } from './authorization';
import type { Env } from './env';
import { body, HttpError, json, string } from './http';
import { withIdempotency } from './idempotency';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_LIFETIME = 30 * 24 * 60 * 60 * 1000;

function createCode(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code.toUpperCase()));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createOrGetInvite(env: Env, session: AuthSession | null, clubId: string): Promise<Response> {
  requireSession(session);
  await requireMember(env, session, clubId, 'admin');
  // Tokens are stored only as hashes. Re-issuing also makes the old link
  // invalid, so the caller always receives a usable link without exposing
  // bearer tokens in the database.
  await env.DB.prepare('UPDATE invitations SET accepted_at = ? WHERE club_id = ? AND accepted_at IS NULL').bind(Date.now(), clubId).run();
  return issueInvite(env, session, clubId);
}

async function issueInvite(env: Env, session: AuthSession, clubId: string): Promise<Response> {
  const code = createCode();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO invitations (id, club_id, email, role, token_hash, expires_at, created_by, created_at) VALUES (?, ?, ?, \'member\', ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), clubId, '', await hashCode(code), now + INVITE_LIFETIME, session.user.id, now).run();
  return json({ code, expiresAt: now + INVITE_LIFETIME }, 201);
}

export async function previewInvite(env: Env, codeInput: string): Promise<Response> {
  const code = string(codeInput, 'Invite code', { min: 8, max: 32 }).toUpperCase();
  const invite = await env.DB.prepare("SELECT i.club_id, c.name, c.description, i.expires_at FROM invitations i JOIN clubs c ON c.id = i.club_id WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.expires_at > ?")
    .bind(await hashCode(code), Date.now()).first<{ club_id: string; name: string; description: string; expires_at: number }>();
  if (!invite) throw new HttpError(404, 'This invite has expired or is no longer available.', 'invite_unavailable');
  const members = await env.DB.prepare('SELECT u.id, u.name FROM club_memberships m JOIN user u ON u.id = m.user_id WHERE m.club_id = ? ORDER BY m.joined_at ASC LIMIT 12').bind(invite.club_id).all<{ id: string; name: string }>();
  const books = await env.DB.prepare("SELECT id, title, author, cover_url FROM books WHERE club_id = ? AND status IN ('current', 'ballot') ORDER BY updated_at DESC LIMIT 4").bind(invite.club_id).all();
  return json({ clubId: invite.club_id, name: invite.name, description: invite.description, expiresAt: invite.expires_at, memberCount: members.results.length, members: members.results, books: books.results });
}

export async function joinInvite(request: Request, env: Env, session: AuthSession | null, codeInput: string): Promise<Response> {
  requireSession(session);
  const input = await body<{ code?: unknown }>(request);
  const code = string(input.code ?? codeInput, 'Invite code', { min: 8, max: 32 }).toUpperCase();
  const result = await withIdempotency(env, session.user.id, request.headers.get('idempotency-key'), `join:${code}`, async () => {
    const invite = await env.DB.prepare("SELECT id, club_id FROM invitations WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > ?").bind(await hashCode(code), Date.now()).first<{ id: string; club_id: string }>();
    if (!invite) throw new HttpError(404, 'This invite has expired or is no longer available.', 'invite_unavailable');
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO club_memberships (club_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").bind(invite.club_id, session.user.id, now),
      env.DB.prepare('UPDATE invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL').bind(now, invite.id),
    ]);
    return { clubId: invite.club_id };
  });
  return json(result);
}

export async function resetInvite(env: Env, session: AuthSession | null, clubId: string): Promise<Response> {
  requireSession(session);
  await requireMember(env, session, clubId, 'admin');
  await env.DB.prepare('UPDATE invitations SET accepted_at = ? WHERE club_id = ? AND accepted_at IS NULL').bind(Date.now(), clubId).run();
  return issueInvite(env, session, clubId);
}

export async function disableInvites(env: Env, session: AuthSession | null, clubId: string): Promise<Response> {
  requireSession(session);
  await requireMember(env, session, clubId, 'admin');
  await env.DB.prepare('UPDATE invitations SET accepted_at = ? WHERE club_id = ? AND accepted_at IS NULL').bind(Date.now(), clubId).run();
  return json({ disabled: true });
}

export async function listInvites(env: Env, session: AuthSession | null, clubId: string): Promise<Response> {
  requireSession(session); await requireMember(env, session, clubId, 'admin');
  const rows = await env.DB.prepare('SELECT id, expires_at, accepted_at, created_at FROM invitations WHERE club_id=? ORDER BY created_at DESC LIMIT 20').bind(clubId).all();
  return json({ invites: rows.results.map(row => ({ ...row, revoked_at: (row as { accepted_at: number | null }).accepted_at })) });
}

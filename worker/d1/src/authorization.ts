import type { AuthSession } from './auth';
import type { Env } from './env';
import { HttpError } from './http';

export type Role = 'owner' | 'admin' | 'member';
const rank: Record<Role, number> = { member: 1, admin: 2, owner: 3 };

export async function requireMember(env: Env, session: AuthSession | null, clubId: string, minimum: Role = 'member'): Promise<Role> {
  if (!session) throw new HttpError(401, 'Sign in is required.', 'unauthenticated');
  const row = await env.DB.prepare('SELECT role FROM club_memberships WHERE club_id = ? AND user_id = ?').bind(clubId, session.user.id).first<{ role: Role }>();
  if (!row || rank[row.role] < rank[minimum]) throw new HttpError(403, 'You do not have permission to do that in this club.', 'forbidden');
  return row.role;
}

export function requireSession(session: AuthSession | null): asserts session is AuthSession {
  if (!session) throw new HttpError(401, 'Sign in is required.', 'unauthenticated');
}

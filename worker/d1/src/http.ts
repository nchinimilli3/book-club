import type { Env } from './env';

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code = 'request_failed') { super(message); }
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}

export function noContent(headers: HeadersInit = {}): Response { return new Response(null, { status: 204, headers }); }

export function cors(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('origin');
  if (origin && origin !== env.APP_ORIGIN) return {};
  return { 'access-control-allow-origin': env.APP_ORIGIN, 'access-control-allow-credentials': 'true', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type,idempotency-key', vary: 'Origin' };
}

export function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors(request, env))) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

export async function body<T>(request: Request): Promise<T> {
  try { return await request.json<T>(); } catch { throw new HttpError(400, 'A valid JSON request body is required.', 'invalid_json'); }
}

export function string(value: unknown, field: string, options: { min?: number; max?: number } = {}): string {
  if (typeof value !== 'string') throw new HttpError(400, `${field} is required.`, 'invalid_input');
  const result = value.trim();
  if ((options.min && result.length < options.min) || (options.max && result.length > options.max)) throw new HttpError(400, `${field} has an invalid length.`, 'invalid_input');
  return result;
}

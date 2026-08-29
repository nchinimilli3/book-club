export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  APP_ORIGIN: string;
  AUTH_BASE_URL: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  AUTH_EMAIL_MODE?: 'resend' | 'console';
  TURNSTILE_SECRET_KEY: string;
  R2_MAX_STORAGE_BYTES?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  NYT_BOOKS_API_KEY?: string;
  GOOGLE_VISION_API_KEY?: string;
  CALENDAR_STATE_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;
}

export function required(env: Env, key: keyof Env): string {
  const value = env[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing required Worker binding: ${key}`);
  return value;
}

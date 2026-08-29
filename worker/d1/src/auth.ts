import { betterAuth } from 'better-auth';
import { captcha } from 'better-auth/plugins';
import type { Env } from './env';
import { required } from './env';

type MailjetError = { ErrorMessage?: unknown; ErrorInfo?: unknown; ErrorCode?: unknown; ErrorIdentifier?: unknown };
type MailjetResponse = { Messages?: Array<{ Status?: unknown; Errors?: MailjetError[] }>; ErrorMessage?: unknown; ErrorInfo?: unknown };

function safeProviderMessage(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  return value.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]').replace(/https?:\/\/\S+/gi, '[link]').slice(0, 240);
}

function mailjetMessage(payload: MailjetResponse | null): string {
  const firstError = payload?.Messages?.[0]?.Errors?.[0];
  return safeProviderMessage(firstError?.ErrorMessage)
    || safeProviderMessage(firstError?.ErrorInfo)
    || safeProviderMessage(payload?.ErrorMessage)
    || safeProviderMessage(payload?.ErrorInfo)
    || 'Mailjet rejected the email request.';
}

async function sendEmail(env: Env, to: string, subject: string, html: string): Promise<void> {
  if (env.AUTH_EMAIL_MODE === 'console') {
    console.log(JSON.stringify({ event: 'local_email', to, subject, html }));
    return;
  }
  if (env.AUTH_EMAIL_MODE === 'mailjet') {
    console.log(JSON.stringify({ event: 'email_send_requested', provider: 'mailjet' }));
    let apiKey: string;
    let secretKey: string;
    try {
      apiKey = required(env, 'MAILJET_API_KEY');
      secretKey = required(env, 'MAILJET_SECRET_KEY');
    } catch (error) {
      console.error(JSON.stringify({ event: 'email_provider_error', provider: 'mailjet', category: 'missing_credentials' }));
      throw error;
    }
    let response: Response;
    try {
      response = await fetch('https://api.mailjet.com/v3.1/send', {
        method: 'POST',
        headers: {
          authorization: `Basic ${btoa(`${apiKey}:${secretKey}`)}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          Messages: [{
            From: { Email: required(env, 'MAILJET_FROM_EMAIL'), Name: env.MAILJET_FROM_NAME || 'BOOK CLUB' },
            To: [{ Email: to }],
            Subject: subject,
            HTMLPart: html,
          }],
        }),
      });
    } catch (error) {
      console.error(JSON.stringify({ event: 'email_provider_error', provider: 'mailjet', category: 'network_error' }));
      throw error;
    }
    const responseText = await response.text();
    let payload: MailjetResponse | null = null;
    try { payload = JSON.parse(responseText) as MailjetResponse; } catch { /* Mailjet may return a non-JSON proxy error. */ }
    const messageStatus = typeof payload?.Messages?.[0]?.Status === 'string' ? payload.Messages[0].Status.toLowerCase() : '';
    const messageErrors = payload?.Messages?.[0]?.Errors || [];
    const messageAccepted = response.ok && messageStatus === 'success' && messageErrors.length === 0;
    if (!messageAccepted) {
      const normalized = responseText.toLowerCase();
      const category = response.status === 401 || response.status === 403
        ? 'invalid_credentials'
        : response.status === 429
          ? 'rate_limited'
          : response.status >= 500
            ? 'provider_unavailable'
            : response.status === 400 && /(sender|from|authorized|verified)/.test(normalized)
              ? 'sender_not_approved'
              : 'request_rejected';
      console.error(JSON.stringify({ event: 'email_provider_error', provider: 'mailjet', status: response.status, category }));
      throw new Error(`Mailjet email delivery failed (${response.status}): ${mailjetMessage(payload)}`);
    }
    console.log(JSON.stringify({ event: 'email_provider_accepted', provider: 'mailjet', status: response.status, messageStatus }));
    return;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${required(env, 'RESEND_API_KEY')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: required(env, 'RESEND_FROM'), to: [to], subject, html }),
  });
  if (!response.ok) throw new Error(`Resend email delivery failed (${response.status}).`);
}

function safeLink(url: string, label: string): string {
  const escaped = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<p>${label}</p><p><a href="${escaped}">${escaped}</a></p><p>This link expires in one hour.</p>`;
}

export function createAuth(env: Env) {
  const appOrigin = required(env, 'APP_ORIGIN');
  const secure = new URL(required(env, 'AUTH_BASE_URL')).protocol === 'https:';
  const trustedOrigins = [appOrigin, ...(env.APP_ALLOWED_ORIGINS || '').split(',')]
    .map(origin => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return betterAuth({
    database: env.DB,
    secret: required(env, 'BETTER_AUTH_SECRET'),
    baseURL: required(env, 'AUTH_BASE_URL'),
    trustedOrigins,
    advanced: { useSecureCookies: secure, defaultCookieAttributes: { sameSite: 'lax', httpOnly: true, secure } },
    emailAndPassword: {
      enabled: true, requireEmailVerification: true, minPasswordLength: 12,
      sendResetPassword: async ({ user, url }) => sendEmail(env, user.email, 'Reset your BOOK CLUB password', safeLink(url, 'Use this secure link to reset your password.')),
    },
    emailVerification: {
      sendOnSignUp: true, autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => sendEmail(env, user.email, 'Verify your BOOK CLUB email', safeLink(url, 'Confirm your email address to activate BOOK CLUB.')),
    },
    // Email/password remains available when Google OAuth has not been set up.
    // Better Auth returns a normal unsupported-provider response for the button
    // instead of preventing every auth request from starting.
    socialProviders: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {},
    // Local auth tests should not depend on an external challenge or secret.
    // Production and preview always use Turnstile.
    plugins: env.AUTH_EMAIL_MODE === 'console' ? [] : [captcha({ provider: 'cloudflare-turnstile', secretKey: required(env, 'TURNSTILE_SECRET_KEY') })],
  });
}

export type AuthSession = { user: { id: string; email: string; name: string }; session: { id: string; expiresAt: Date } };

export async function sessionFor(request: Request, env: Env): Promise<AuthSession | null> {
  return (await createAuth(env).api.getSession({ headers: request.headers })) as AuthSession | null;
}

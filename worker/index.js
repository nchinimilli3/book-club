const rateBuckets = new Map();

const enc = new TextEncoder();
const dec = new TextDecoder();

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function cors(request, env) {
  const origin = request.headers.get('origin') || '';

  const allowed =
    env.APP_ORIGIN && origin === env.APP_ORIGIN
      ? origin
      : env.APP_ORIGIN
        ? ''
        : origin || '*';

  return {
    'access-control-allow-origin': allowed || env.APP_ORIGIN || '*',
    vary: 'Origin',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-max-age': '86400',
  };
}

function json(data, status = 200, request, env, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      ...cors(request, env),
      ...extra,
    },
  });
}

async function timedFetch(url, init = {}, ms = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, init = {}, ms = 12000) {
  const response = await timedFetch(url, init, ms);
  const parsed = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      parsed?.error?.message ||
        parsed?.error_description ||
        parsed?.message ||
        `${response.status} ${url}`,
    );
  }

  return parsed;
}

function outputText(response) {
  if (typeof response?.output_text === 'string') {
    return response.output_text;
  }

  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && content?.text) {
        return content.text;
      }
    }
  }

  return '';
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {}

  const match = String(text || '').match(/[\[{][\s\S]*[\]}]/);

  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Encoding / crypto                                                          */
/* -------------------------------------------------------------------------- */

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function unb64url(value) {
  let s = value.replace(/-/g, '+').replace(/_/g, '/');

  while (s.length % 4) {
    s += '=';
  }

  return Uint8Array.from(atob(s), (char) => char.charCodeAt(0));
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  );

  return b64url(
    new Uint8Array(
      await crypto.subtle.sign('HMAC', key, enc.encode(text)),
    ),
  );
}

async function stateFor(env, userId) {
  const payload = b64url(
    enc.encode(
      JSON.stringify({
        u: userId,
        t: Date.now(),
      }),
    ),
  );

  const signature = await hmac(
    env.CALENDAR_STATE_SECRET ||
      env.GOOGLE_CLIENT_SECRET ||
      'missing',
    payload,
  );

  return `${payload}.${signature}`;
}

async function verifyState(env, state) {
  const [payload, sig] = String(state || '').split('.');

  if (!payload || !sig) {
    return null;
  }

  const expected = await hmac(
    env.CALENDAR_STATE_SECRET ||
      env.GOOGLE_CLIENT_SECRET ||
      'missing',
    payload,
  );

  if (expected !== sig) {
    return null;
  }

  try {
    const data = JSON.parse(dec.decode(unb64url(payload)));

    if (!data.u || Date.now() - Number(data.t) > 10 * 60 * 1000) {
      return null;
    }

    return data.u;
  } catch {
    return null;
  }
}

async function aesKey(secret) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    enc.encode(secret),
  );

  return crypto.subtle.importKey(
    'raw',
    digest,
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encrypt(env, value) {
  if (!env.TOKEN_ENCRYPTION_KEY) {
    throw new Error('TOKEN_ENCRYPTION_KEY is not configured');
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(env.TOKEN_ENCRYPTION_KEY);

  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      enc.encode(JSON.stringify(value)),
    ),
  );

  const combined = new Uint8Array(iv.length + cipher.length);

  combined.set(iv);
  combined.set(cipher, iv.length);

  return b64url(combined);
}

async function decrypt(env, value) {
  const combined = unb64url(value);
  const iv = combined.slice(0, 12);
  const cipher = combined.slice(12);
  const key = await aesKey(env.TOKEN_ENCRYPTION_KEY);

  return JSON.parse(
    dec.decode(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv,
        },
        key,
        cipher,
      ),
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Supabase                                                                   */
/* -------------------------------------------------------------------------- */

function supaHeaders(env, bearer) {
  return {
    apikey: env.SUPABASE_ANON_KEY || '',
    authorization:
      bearer || `Bearer ${env.SUPABASE_ANON_KEY || ''}`,
    'content-type': 'application/json',
  };
}

function adminHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY || '',
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY || ''}`,
    'content-type': 'application/json',
  };
}

async function authedUser(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error('Supabase Worker configuration is incomplete');
  }

  const auth = request.headers.get('authorization');

  if (!auth?.startsWith('Bearer ')) {
    return null;
  }

  try {
    return await fetchJson(
      `${env.SUPABASE_URL}/auth/v1/user`,
      {
        headers: supaHeaders(env, auth),
      },
      7000,
    );
  } catch {
    return null;
  }
}

async function userRpc(env, auth, name, body) {
  return fetchJson(
    `${env.SUPABASE_URL}/rest/v1/rpc/${name}`,
    {
      method: 'POST',
      headers: supaHeaders(env, auth),
      body: JSON.stringify(body),
    },
    10000,
  );
}

async function adminSelect(env, table, query) {
  return fetchJson(
    `${env.SUPABASE_URL}/rest/v1/${table}?${query}`,
    {
      headers: adminHeaders(env),
    },
    10000,
  );
}

async function adminUpsert(env, table, body, onConflict) {
  const suffix = onConflict
    ? `?on_conflict=${encodeURIComponent(onConflict)}`
    : '';

  return fetchJson(
    `${env.SUPABASE_URL}/rest/v1/${table}${suffix}`,
    {
      method: 'POST',
      headers: {
        ...adminHeaders(env),
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(body),
    },
    10000,
  );
}

async function adminInsert(env, table, body) {
  const response = await timedFetch(
    `${env.SUPABASE_URL}/rest/v1/${table}`,
    {
      method: 'POST',
      headers: {
        ...adminHeaders(env),
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    },
    10000,
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');

    throw new Error(
      `Supabase insert failed for ${table} (${response.status}) ${detail}`,
    );
  }
}

async function adminDelete(env, table, query) {
  const response = await timedFetch(
    `${env.SUPABASE_URL}/rest/v1/${table}?${query}`,
    {
      method: 'DELETE',
      headers: adminHeaders(env),
    },
    10000,
  );

  if (!response.ok) {
    throw new Error(
      `Supabase delete failed (${response.status})`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                              */
/* -------------------------------------------------------------------------- */

function rateLimit(key, limit = 20, windowMs = 60000) {
  const now = Date.now();
  const old = rateBuckets.get(key);

  if (!old || now - old.start > windowMs) {
    rateBuckets.set(key, {
      start: now,
      count: 1,
    });

    return true;
  }

  old.count++;

  return old.count <= limit;
}

/* -------------------------------------------------------------------------- */
/* Book metadata / source context                                             */
/* -------------------------------------------------------------------------- */

async function sourceContext(title, author) {
  const out = {
    description: '',
    wikipedia: '',
    subjects: [],
    sources: [],
  };

  try {
    const ol = await fetchJson(
      `https://openlibrary.org/search.json?title=${encodeURIComponent(
        title,
      )}&author=${encodeURIComponent(
        author || '',
      )}&limit=1&fields=key,title,author_name,subject`,
      {},
      8000,
    );

    const doc = ol?.docs?.[0];

    out.subjects = (doc?.subject || []).slice(0, 18);

    if (doc?.key?.startsWith('/works/')) {
      const work = await fetchJson(
        `https://openlibrary.org${doc.key}.json`,
        {},
        8000,
      );

      out.description =
        typeof work?.description === 'string'
          ? work.description
          : work?.description?.value || '';

      out.subjects = [
        ...new Set([
          ...(out.subjects || []),
          ...(work?.subjects || []),
        ]),
      ].slice(0, 24);

      out.sources.push({
        name: 'Open Library',
        url: `https://openlibrary.org${doc.key}`,
      });
    }
  } catch {}

  try {
    const search = await fetchJson(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        `${title} ${author}`,
      )}&utf8=1&format=json&origin=*`,
      {},
      8000,
    );

    const hit = search?.query?.search?.[0];

    if (hit) {
      const page = await fetchJson(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
          hit.title,
        )}`,
        {},
        8000,
      );

      out.wikipedia = page?.extract || '';

      if (page?.content_urls?.desktop?.page) {
        out.sources.push({
          name: 'Wikipedia',
          url: page.content_urls.desktop.page,
        });
      }
    }
  } catch {}

  return out;
}

async function openLibraryCandidate(title, author) {
  try {
    const response = await fetchJson(
      `https://openlibrary.org/search.json?title=${encodeURIComponent(
        title,
      )}&author=${encodeURIComponent(
        author || '',
      )}&limit=1&fields=key,title,author_name,cover_i,first_publish_year,number_of_pages_median,isbn`,
      {},
      8000,
    );

    const doc = response?.docs?.[0];

    if (!doc) {
      return null;
    }

    return {
      title: doc.title || title,
      author:
        doc.author_name?.[0] ||
        author ||
        'Unknown author',
      year: doc.first_publish_year || undefined,
      pages: doc.number_of_pages_median || undefined,
      isbn: doc.isbn?.[0] || undefined,
      cover: doc.cover_i
        ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
        : undefined,
    };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* OpenAI                                                                     */
/* -------------------------------------------------------------------------- */

async function openAi(env, prompt) {
  if (!env.OPENAI_API_KEY) {
    throw new Error('AI synthesis is not configured');
  }

  const response = await fetchJson(
    'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || 'gpt-5.6',
        input: prompt,
        store: false,
      }),
    },
    30000,
  );

  return safeJson(outputText(response));
}

/* -------------------------------------------------------------------------- */
/* Google Vision OCR                                                          */
/* -------------------------------------------------------------------------- */

async function googleVisionOcr(env, imageDataUrl) {
  if (!env.GOOGLE_VISION_API_KEY) {
    throw new Error('Passage scanning is not configured');
  }

  const base64 = imageDataUrl.replace(
    /^data:image\/[^;]+;base64,/i,
    '',
  );

  const response = await fetchJson(
    `https://vision.googleapis.com/v1/images:annotate?key=${env.GOOGLE_VISION_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            image: {
              content: base64,
            },
            features: [
              {
                type: 'DOCUMENT_TEXT_DETECTION',
              },
            ],
          },
        ],
      }),
    },
    30000,
  );

  const result = response?.responses?.[0];

  if (result?.error) {
    throw new Error(
      result.error.message ||
        'Google Vision OCR failed',
    );
  }

  const text = String(
    result?.fullTextAnnotation?.text || '',
  ).trim();

  if (!text) {
    return {
      text: '',
      confidence: 0,
      needsReview: true,
      pageNumber: null,
      chapterNumber: null,
    };
  }

  const confidences = [];

  for (
    const page of
      result?.fullTextAnnotation?.pages || []
  ) {
    for (const block of page.blocks || []) {
      for (
        const paragraph of block.paragraphs || []
      ) {
        for (const word of paragraph.words || []) {
          if (
            typeof word.confidence === 'number'
          ) {
            confidences.push(word.confidence);
          }
        }
      }
    }
  }

  const confidence = confidences.length
    ? confidences.reduce(
        (sum, value) => sum + value,
        0,
      ) / confidences.length
    : 0.95;

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let pageNumber = null;
  let chapterNumber = null;

  const pageCandidateIndexes = new Set([
    0,
    1,
    Math.max(0, lines.length - 2),
    Math.max(0, lines.length - 1),
  ]);

  for (const index of pageCandidateIndexes) {
    const line = lines[index];

    if (line && /^\d{1,4}$/.test(line)) {
      pageNumber = Number(line);
      break;
    }
  }

  for (const line of lines.slice(0, 8)) {
    const match = line.match(
      /^chapter\s+(?:no\.?\s*)?(\d+)\b/i,
    );

    if (match) {
      chapterNumber = Number(match[1]);
      break;
    }
  }

  return {
    text,
    confidence,
    needsReview: confidence < 0.9,
    pageNumber,
    chapterNumber,
  };
}

/* -------------------------------------------------------------------------- */
/* Google Calendar                                                            */
/* -------------------------------------------------------------------------- */

function calendarConfigured(env) {
  return Boolean(
    env.SUPABASE_URL &&
      env.SUPABASE_ANON_KEY &&
      env.SUPABASE_SERVICE_ROLE_KEY &&
      env.GOOGLE_CLIENT_ID &&
      env.GOOGLE_CLIENT_SECRET &&
      env.GOOGLE_REDIRECT_URI &&
      env.APP_ORIGIN &&
      env.TOKEN_ENCRYPTION_KEY,
  );
}

async function calendarConnection(env, userId) {
  const result = await adminSelect(
    env,
    'calendar_connections',
    `user_id=eq.${encodeURIComponent(
      userId,
    )}&select=*`,
  );

  return result?.[0] || null;
}

async function refreshedTokens(env, connection) {
  let tokens = await decrypt(
    env,
    connection.encrypted_tokens,
  );

  if (
    tokens.expires_at &&
    Number(tokens.expires_at) >
      Date.now() + 60000
  ) {
    return tokens;
  }

  if (!tokens.refresh_token) {
    throw new Error(
      'Google Calendar needs to be reconnected',
    );
  }

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
  });

  const next = await fetchJson(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: {
        'content-type':
          'application/x-www-form-urlencoded',
      },
      body: params,
    },
    12000,
  );

  tokens = {
    ...tokens,
    ...next,
    expires_at:
      Date.now() +
      Number(next.expires_in || 3600) * 1000,
  };

  await adminUpsert(
    env,
    'calendar_connections',
    {
      user_id: connection.user_id,
      encrypted_tokens: await encrypt(
        env,
        tokens,
      ),
      email: connection.email,
      expires_at: new Date(
        tokens.expires_at,
      ).toISOString(),
      scope: tokens.scope || connection.scope,
      updated_at: new Date().toISOString(),
    },
    'user_id',
  );

  return tokens;
}

async function syncCalendarMeeting(
  env,
  userId,
  meetingId,
) {
  const connection = await calendarConnection(
    env,
    userId,
  );

  if (!connection) {
    throw new Error(
      'Connect Google Calendar first',
    );
  }

  const meetings = await adminSelect(
    env,
    'meetings',
    `id=eq.${encodeURIComponent(
      meetingId,
    )}&select=id,club_id,club_book_id,starts_at,meeting_type,meeting_url,status`,
  );

  const meeting = meetings?.[0];

  if (!meeting) {
    throw new Error('Meeting not found');
  }

  const membership = await adminSelect(
    env,
    'club_members',
    `club_id=eq.${meeting.club_id}&user_id=eq.${userId}&select=role`,
  );

  if (!membership?.length) {
    throw new Error('Not a club member');
  }

  const clubs = await adminSelect(
    env,
    'clubs',
    `id=eq.${meeting.club_id}&select=name`,
  );

  let bookTitle = '';

  if (meeting.club_book_id) {
    const clubBooks = await adminSelect(
      env,
      'club_books',
      `id=eq.${meeting.club_book_id}&select=book_id`,
    );

    if (clubBooks?.[0]?.book_id) {
      const books = await adminSelect(
        env,
        'books',
        `id=eq.${clubBooks[0].book_id}&select=title,author`,
      );

      if (books?.[0]) {
        bookTitle = ` · ${books[0].title}`;
      }
    }
  }

  const tokens = await refreshedTokens(
    env,
    connection,
  );

  const start = new Date(meeting.starts_at);
  const end = new Date(
    start.getTime() + 90 * 60 * 1000,
  );

  const event = {
    summary: `BOOK CLUB · ${
      clubs?.[0]?.name || 'Meeting'
    }${bookTitle}`,
    description:
      'Book club meeting scheduled in BOOK CLUB.',
    start: {
      dateTime: start.toISOString(),
    },
    end: {
      dateTime: end.toISOString(),
    },
    location: meeting.meeting_url || undefined,
  };

  const links = await adminSelect(
    env,
    'calendar_event_links',
    `user_id=eq.${userId}&meeting_id=eq.${meetingId}&select=*`,
  );

  const old = links?.[0];

  const endpoint = old
    ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(
        old.google_event_id,
      )}`
    : 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

  const saved = await fetchJson(
    endpoint,
    {
      method: old ? 'PUT' : 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${tokens.access_token}`,
      },
      body: JSON.stringify(event),
    },
    12000,
  );

  await adminUpsert(
    env,
    'calendar_event_links',
    {
      user_id: userId,
      meeting_id: meetingId,
      google_event_id: saved.id,
      html_link: saved.htmlLink || null,
      last_synced_at: new Date().toISOString(),
    },
    'user_id,meeting_id',
  );

  return {
    ok: true,
    htmlLink: saved.htmlLink,
  };
}

/* -------------------------------------------------------------------------- */
/* Scheduled reminders                                                        */
/* -------------------------------------------------------------------------- */

async function reminderAlreadyExists(
  env,
  userId,
  type,
  deepLink,
  since,
) {
  const rows = await adminSelect(
    env,
    'notifications',
    [
      `user_id=eq.${encodeURIComponent(userId)}`,
      `type=eq.${encodeURIComponent(type)}`,
      `deep_link=eq.${encodeURIComponent(deepLink)}`,
      `created_at=gte.${encodeURIComponent(since)}`,
      'select=id',
      'limit=1',
    ].join('&'),
  );

  return Boolean(rows?.length);
}

async function clubMemberIds(env, clubId) {
  const rows = await adminSelect(
    env,
    'club_members',
    `club_id=eq.${encodeURIComponent(
      clubId,
    )}&select=user_id`,
  );

  return [
    ...new Set(
      (rows || [])
        .map((row) => row.user_id)
        .filter(Boolean),
    ),
  ];
}

async function createReminderForMembers(
  env,
  {
    clubId,
    type,
    title,
    body,
    deepLink,
    dedupeSince,
  },
) {
  const users = await clubMemberIds(
    env,
    clubId,
  );

  let created = 0;

  for (const userId of users) {
    try {
      const exists =
        await reminderAlreadyExists(
          env,
          userId,
          type,
          deepLink,
          dedupeSince,
        );

      if (exists) {
        continue;
      }

      await adminInsert(
        env,
        'notifications',
        {
          user_id: userId,
          club_id: clubId,
          type,
          title,
          body,
          deep_link: deepLink,
        },
      );

      created++;
    } catch (error) {
      console.error(
        'Could not create reminder',
        {
          userId,
          clubId,
          type,
          error:
            error?.message || String(error),
        },
      );
    }
  }

  return created;
}

async function processMeetingReminders(env) {
  const now = new Date();

  const from = new Date(
    now.getTime() +
      23.75 * 60 * 60 * 1000,
  );

  const to = new Date(
    now.getTime() +
      24.25 * 60 * 60 * 1000,
  );

  const meetings = await adminSelect(
    env,
    'meetings',
    [
      `starts_at=gte.${encodeURIComponent(
        from.toISOString(),
      )}`,
      `starts_at=lt.${encodeURIComponent(
        to.toISOString(),
      )}`,
      'status=neq.cancelled',
      'select=id,club_id,club_book_id,starts_at,meeting_type,meeting_url,status',
    ].join('&'),
  );

  let created = 0;

  for (const meeting of meetings || []) {
    if (
      !meeting?.club_id ||
      !meeting?.id
    ) {
      continue;
    }

    const clubs = await adminSelect(
      env,
      'clubs',
      `id=eq.${encodeURIComponent(
        meeting.club_id,
      )}&select=name`,
    );

    const clubName =
      clubs?.[0]?.name || 'Book Club';

    const start = new Date(
      meeting.starts_at,
    );

    const formatted =
      start.toLocaleString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Detroit',
      });

    const deepLink =
      `/clubs/${meeting.club_id}?meeting=${meeting.id}`;

    created +=
      await createReminderForMembers(
        env,
        {
          clubId: meeting.club_id,
          type: 'meeting_reminder',
          title: 'Book club tomorrow',
          body: `${clubName} meets ${formatted}.`,
          deepLink,
          dedupeSince: new Date(
            now.getTime() -
              7 *
                24 *
                60 *
                60 *
                1000,
          ).toISOString(),
        },
      );
  }

  return {
    meetingsFound:
      meetings?.length || 0,
    notificationsCreated: created,
  };
}

function dateInMichigan(date = new Date()) {
  return date.toLocaleDateString(
    'en-CA',
    {
      timeZone: 'America/Detroit',
    },
  );
}

async function processCheckpointReminders(
  env,
) {
  const now = new Date();
  const today = dateInMichigan(now);

  const checkpoints = await adminSelect(
    env,
    'reading_checkpoints',
    [
      `due_at=eq.${today}`,
      'select=id,club_book_id,due_at,target_chapter,target_page,label',
    ].join('&'),
  );

  let created = 0;

  for (
    const checkpoint of
      checkpoints || []
  ) {
    if (
      !checkpoint?.id ||
      !checkpoint?.club_book_id
    ) {
      continue;
    }

    const clubBooks =
      await adminSelect(
        env,
        'club_books',
        `id=eq.${encodeURIComponent(
          checkpoint.club_book_id,
        )}&select=id,club_id,book_id,status`,
      );

    const clubBook =
      clubBooks?.[0];

    if (!clubBook?.club_id) {
      continue;
    }

    if (
      [
        'finished',
        'dnf',
        'archived',
      ].includes(clubBook.status)
    ) {
      continue;
    }

    let bookTitle = 'your book';

    if (clubBook.book_id) {
      const books = await adminSelect(
        env,
        'books',
        `id=eq.${encodeURIComponent(
          clubBook.book_id,
        )}&select=title`,
      );

      if (books?.[0]?.title) {
        bookTitle =
          books[0].title;
      }
    }

    let target =
      checkpoint.label ||
      'Reading checkpoint';

    if (
      !checkpoint.label &&
      checkpoint.target_chapter
    ) {
      target = `Through Chapter ${checkpoint.target_chapter}`;
    }

    if (
      !checkpoint.label &&
      checkpoint.target_page
    ) {
      target = `Through page ${checkpoint.target_page}`;
    }

    const deepLink =
      `/clubs/${clubBook.club_id}?checkpoint=${checkpoint.id}`;

    created +=
      await createReminderForMembers(
        env,
        {
          clubId:
            clubBook.club_id,
          type:
            'reading_checkpoint',
          title: `Reading check-in · ${bookTitle}`,
          body: `${target} is due today.`,
          deepLink,
          dedupeSince: new Date(
            now.getTime() -
              30 *
                24 *
                60 *
                60 *
                1000,
          ).toISOString(),
        },
      );
  }

  return {
    checkpointsFound:
      checkpoints?.length || 0,
    notificationsCreated: created,
  };
}

async function processDueReminders(env) {
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      'Reminder backend is missing Supabase configuration',
    );
  }

  console.log(
    'BOOK CLUB reminder cron started',
    new Date().toISOString(),
  );

  const results = {
    meetings: null,
    checkpoints: null,
  };

  try {
    results.meetings =
      await processMeetingReminders(
        env,
      );
  } catch (error) {
    console.error(
      'Meeting reminders failed',
      error?.message || error,
    );

    results.meetings = {
      error:
        error?.message ||
        'Meeting reminder failure',
    };
  }

  try {
    results.checkpoints =
      await processCheckpointReminders(
        env,
      );
  } catch (error) {
    console.error(
      'Checkpoint reminders failed',
      error?.message || error,
    );

    results.checkpoints = {
      error:
        error?.message ||
        'Checkpoint reminder failure',
    };
  }

  console.log(
    'BOOK CLUB reminder cron finished',
    JSON.stringify(results),
  );

  return results;
}

/* -------------------------------------------------------------------------- */
/* Worker                                                                     */
/* -------------------------------------------------------------------------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: cors(request, env),
      });
    }

    /* ---------------------------------------------------------------------- */
    /* Book discovery                                                         */
    /* ---------------------------------------------------------------------- */

    if (
      url.pathname ===
      '/api/book-discovery'
    ) {
      const cacheHeaders = {
        'cache-control':
          'public, max-age=1800, s-maxage=21600',
      };

      const nyt = [];
      const nytErrors = [];

      if (env.NYT_BOOKS_API_KEY) {
        for (const list of [
          'hardcover-fiction',
          'hardcover-nonfiction',
        ]) {
          try {
            const data =
              await fetchJson(
                `https://api.nytimes.com/svc/books/v3/lists/current/${list}.json?api-key=${env.NYT_BOOKS_API_KEY}`,
                {},
                9000,
              );

            for (
              const book of
                (
                  data?.results
                    ?.books || []
                ).slice(0, 6)
            ) {
              nyt.push({
                key: `nyt:${
                  book.primary_isbn13 ||
                  book.primary_isbn10 ||
                  book.rank
                }`,
                source: 'nyt',
                title: book.title,
                author: book.author,
                cover:
                  book.book_image ||
                  '',
                isbn:
                  book.primary_isbn13 ||
                  book.primary_isbn10,
                rank: book.rank,
                weeksOnList:
                  book.weeks_on_list,
                listName:
                  data?.results
                    ?.display_name ||
                  '',
                storeUrl:
                  book.amazon_product_url ||
                  '',
              });
            }
          } catch (error) {
            nytErrors.push(
              String(
                error?.message ||
                  'NYT request failed',
              )
                .replace(
                  /api-key=[^&\s]+/gi,
                  'api-key=[redacted]',
                )
                .slice(0, 180),
            );
          }
        }
      }

      const apple = [];
      const terms = [
        'literary fiction',
        'thriller',
        'memoir',
      ];

      for (const term of terms) {
        try {
          const data = await fetchJson(
            `https://itunes.apple.com/search?term=${encodeURIComponent(
              term,
            )}&country=US&media=ebook&entity=ebook&limit=8&explicit=No`,
            {},
            9000,
          );

          for (
            const book of
              data?.results || []
          ) {
            const title =
              book.trackName ||
              book.collectionName;

            if (
              !title ||
              apple.some(
                (existing) =>
                  existing.title.toLowerCase() ===
                  String(
                    title,
                  ).toLowerCase(),
              )
            ) {
              continue;
            }

            apple.push({
              key: `apple:${
                book.trackId ||
                book.collectionId
              }`,
              source: 'apple',
              title,
              author:
                book.artistName ||
                'Unknown author',
              cover: String(
                book.artworkUrl100 ||
                  '',
              ).replace(
                '100x100',
                '600x600',
              ),
              year:
                Number(
                  String(
                    book.releaseDate ||
                      '',
                  ).slice(0, 4),
                ) || undefined,
              isbn:
                book.isbn13 ||
                undefined,
              subjects:
                book.genres || [],
              storeUrl:
                book.trackViewUrl ||
                book.collectionViewUrl ||
                '',
            });

            if (
              apple.length >= 12
            ) {
              break;
            }
          }
        } catch {}

        if (apple.length >= 12) {
          break;
        }
      }

      const nytConfigured =
        Boolean(
          env.NYT_BOOKS_API_KEY,
        );

      const nytStatus =
        !nytConfigured
          ? 'not_configured'
          : nyt.length
            ? 'ok'
            : 'error';

      return json(
        {
          nyt: nyt.slice(0, 10),
          apple:
            apple.slice(0, 10),
          nytConfigured,
          nytStatus,
          nytError:
            nytStatus === 'error'
              ? nytErrors[0] ||
                'NYT returned no books.'
              : undefined,
        },
        200,
        request,
        env,
        cacheHeaders,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Health                                                                 */
    /* ---------------------------------------------------------------------- */

    if (
      url.pathname ===
      '/api/health'
    ) {
      return json(
        {
          ok: true,
          services: {
            openLibrary: true,
            wikipedia: true,
            nyt: Boolean(
              env.NYT_BOOKS_API_KEY,
            ),
            ocr: Boolean(
              env.GOOGLE_VISION_API_KEY,
            ),
            ai: Boolean(
              env.OPENAI_API_KEY,
            ),
            calendarConfigured:
              calendarConfigured(env),
            reminders: Boolean(
              env.SUPABASE_URL &&
                env.SUPABASE_SERVICE_ROLE_KEY,
            ),
            tmdb: Boolean(
              env.TMDB_BEARER_TOKEN,
            ),
            youtube: Boolean(
              env.YOUTUBE_API_KEY,
            ),
            supabase: Boolean(
              env.SUPABASE_URL &&
                env.SUPABASE_ANON_KEY,
            ),
          },
        },
        200,
        request,
        env,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Passage OCR                                                            */
    /* ---------------------------------------------------------------------- */

    if (
      url.pathname ===
        '/api/transcribe-passage' &&
      request.method === 'POST'
    ) {
      const user =
        await authedUser(
          request,
          env,
        );

      if (!user) {
        return json(
          {
            error:
              'Sign in required',
          },
          401,
          request,
          env,
        );
      }

      if (
        !env.GOOGLE_VISION_API_KEY
      ) {
        return json(
          {
            error:
              'Passage scanning is not configured yet.',
          },
          503,
          request,
          env,
        );
      }

      if (
        !rateLimit(
          `passage:${user.id}`,
          12,
          60000,
        )
      ) {
        return json(
          {
            error:
              'Too many scans at once. Try again in a minute.',
          },
          429,
          request,
          env,
        );
      }

      let body;

      try {
        body =
          await request.json();
      } catch {
        return json(
          {
            error:
              'invalid json',
          },
          400,
          request,
          env,
        );
      }

      const imageDataUrl =
        String(
          body?.imageDataUrl ||
            '',
        );

      if (
        !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(
          imageDataUrl,
        )
      ) {
        return json(
          {
            error:
              'A readable photo is required.',
          },
          400,
          request,
          env,
        );
      }

      if (
        imageDataUrl.length >
        6500000
      ) {
        return json(
          {
            error:
              'That photo is too large. Try a smaller image or take it again a little closer.',
          },
          413,
          request,
          env,
        );
      }

      try {
        const parsed =
          await googleVisionOcr(
            env,
            imageDataUrl,
          );

        const text = String(
          parsed?.text || '',
        ).trim();

        if (!text) {
          return json(
            {
              error:
                'No readable passage found. Try a closer, brighter photo.',
            },
            422,
            request,
            env,
          );
        }

        const confidence =
          Math.max(
            0,
            Math.min(
              1,
              Number(
                parsed?.confidence,
              ) || 0,
            ),
          );

        return json(
          {
            text,
            confidence,
            needsReview:
              Boolean(
                parsed?.needsReview,
              ) ||
              confidence < 0.9,
            pageNumber:
              Number(
                parsed?.pageNumber,
              ) || null,
            chapterNumber:
              Number(
                parsed?.chapterNumber,
              ) || null,
            provider:
              'google-vision',
          },
          200,
          request,
          env,
        );
      } catch (error) {
        console.error(
          'Google Vision OCR failed',
          error?.message ||
            error,
        );

        return json(
          {
            error:
              error?.name ===
                'AbortError' ||
              error?.message?.includes(
                'timed',
              )
                ? 'Passage scan timed out. Try a closer photo.'
                : 'Could not read that passage. Try another photo.',
          },
          502,
          request,
          env,
        );
      }
    }

    /* ---------------------------------------------------------------------- */
    /* Enrichment                                                             */
    /* ---------------------------------------------------------------------- */

    if (
      url.pathname ===
      '/api/enrich'
    ) {
      const title =
        url.searchParams.get(
          'title',
        ) || '';

      const author =
        url.searchParams.get(
          'author',
        ) || '';

      if (!title) {
        return json(
          {
            error:
              'title required',
          },
          400,
          request,
          env,
        );
      }

      const source =
        await sourceContext(
          title,
          author,
        );

      const out = {
        title,
        author,
        wikipedia:
          source.wikipedia
            ? {
                extract:
                  source.wikipedia,
              }
            : null,
        adaptations: [],
        videos: [],
        sources:
          source.sources,
      };

      if (
        env.TMDB_BEARER_TOKEN
      ) {
        try {
          const tmdb =
            await fetchJson(
              `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(
                title,
              )}&include_adult=false`,
              {
                headers: {
                  Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}`,
                },
              },
              8000,
            );

          out.adaptations = (
            tmdb.results || []
          )
            .slice(0, 5)
            .map((item) => ({
              id: item.id,
              type:
                item.media_type,
              title:
                item.title ||
                item.name,
              year: (
                item.release_date ||
                item.first_air_date ||
                ''
              ).slice(0, 4),
              poster:
                item.poster_path
                  ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
                  : null,
            }));
        } catch {}
      }

      if (
        env.YOUTUBE_API_KEY
      ) {
        try {
          const youtube =
            await fetchJson(
              `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5&q=${encodeURIComponent(
                `${title} ${author} interview`,
              )}&key=${env.YOUTUBE_API_KEY}`,
              {},
              8000,
            );

          out.videos = (
            youtube.items || []
          ).map((video) => ({
            id:
              video.id.videoId,
            title:
              video.snippet
                .title,
            channel:
              video.snippet
                .channelTitle,
          }));
        } catch {}
      }

      return json(
        out,
        200,
        request,
        env,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Reader context                                                         */
    /* ---------------------------------------------------------------------- */

    if (
      url.pathname ===
        '/api/reader-context' &&
      request.method === 'POST'
    ) {
      let body;

      try {
        body =
          await request.json();
      } catch {
        return json(
          {
            error:
              'invalid json',
          },
          400,
          request,
          env,
        );
      }

      const title = String(
        body?.title || '',
      ).trim();

      const author = String(
        body?.author || '',
      ).trim();

      if (!title) {
        return json(
          {
            error:
              'title required',
          },
          400,
          request,
          env,
        );
      }

      const source =
        await sourceContext(
          title,
          author,
        );

      const sources =
        source.sources || [];

      if (
        !env.OPENAI_API_KEY
      ) {
        const subjects = (
          source.subjects || []
        )
          .slice(0, 6)
          .map((subject) =>
            String(
              subject,
            ).replace(
              /[_-]+/g,
              ' ',
            ),
          );

        return json(
          {
            items:
              subjects.length
                ? [
                    {
                      kind:
                        'themes',
                      title:
                        'Catalog context',
                      summary_short: `Cataloged themes include ${subjects.join(
                        ', ',
                      )}.`,
                      summary_medium: `Catalog metadata for ${title} points to ${subjects.join(
                        ', ',
                      )}.`,
                      summary_deep:
                        'More context will appear when BOOK CLUB can verify it against reliable sources.',
                      spoiler_chapter:
                        null,
                      context_sources:
                        sources.map(
                          (
                            sourceItem,
                          ) => ({
                            source_name:
                              sourceItem.name,
                            source_url:
                              sourceItem.url,
                            source_type:
                              'reference',
                          }),
                        ),
                    },
                  ]
                : [],
            ai: false,
          },
          200,
          request,
          env,
        );
      }

      const evidence = [
        source.description,
        source.wikipedia,
      ]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 9000);

      try {
        const parsed =
          await openAi(
            env,
            `Create a spoiler-safe Reader's Companion for ${title} by ${author}. Reader progress: chapter ${
              body?.chapter || 0
            }.

Use ONLY supplied evidence and bibliographic metadata.
Never invent characters, relationships, plot events, or chapter claims.
Prefer author background, history, setting, terminology, themes and places.
Every item must explicitly connect the context to why a reader of this book would care.
If the evidence cannot support something confidently, omit it.

Evidence:
${evidence || 'No prose evidence.'}

Subjects:
${(source.subjects || []).slice(0, 24).join(', ')}

Return ONLY JSON:
{"items":[{"kind":"author|setting|history|theme|term|character","title":"...","summary_short":"1-2 sentences","summary_medium":"3-5 sentences","summary_deep":"5-8 sentences"}]}

Return 3-5 items.`,
          );

        const items = (
          parsed?.items || []
        )
          .slice(0, 5)
          .map(
            (
              item,
              index,
            ) => ({
              ...item,
              id: `worker-${index}`,
              spoiler_chapter:
                null,
              context_sources:
                sources.map(
                  (
                    sourceItem,
                  ) => ({
                    source_name:
                      sourceItem.name,
                    source_url:
                      sourceItem.url,
                    source_type:
                      'reference',
                  }),
                ),
            }),
          );

        return json(
          {
            items,
            ai: true,
          },
          200,
          request,
          env,
        );
      } catch (error) {
        console.error(
          'Reader context failed',
          error?.message ||
            error,
        );

        return json(
          {
            error:
              'Reader context unavailable',
          },
          502,
          request,
          env,
        );
      }
    }

    /* ---------------------------------------------------------------------- */
    /* Book decision                                                          */
    /* ---------------------------------------------------------------------- */

    if (
      url.pathname ===
        '/api/book-decision' &&
      request.method === 'POST'
    ) {
      let body;

      try {
        body =
          await request.json();
      } catch {
        return json(
          {
            error:
              'invalid json',
          },
          400,
          request,
          env,
        );
      }

      const title = String(
        body?.title || '',
      ).trim();

      const author = String(
        body?.author || '',
      ).trim();

      if (!title) {
        return json(
          {
            error:
              'title required',
          },
          400,
          request,
          env,
        );
      }

      const source =
        await sourceContext(
          title,
          author,
        );

      if (
        !env.OPENAI_API_KEY
      ) {
        return json(
          {
            error:
              'AI synthesis is not configured',
            sourceBacked:
              false,
          },
          503,
          request,
          env,
        );
      }

      if (
        !rateLimit(
          `decision:${
            request.headers.get(
              'cf-connecting-ip',
            ) || 'ip'
          }`,
          30,
        )
      ) {
        return json(
          {
            error:
              'Try again in a minute.',
          },
          429,
          request,
          env,
        );
      }

      try {
        const parsed =
          await openAi(
            env,
            `Write a spoiler-free book-club decision guide for friends.

Book: ${title}
Author: ${author}
Year: ${body?.year || 'unknown'}
Pages: ${body?.pages || 'unknown'}

Subjects:
${[
  ...(body?.subjects || []),
  ...(source.subjects || []),
]
  .slice(0, 24)
  .join(', ')}

Source context:
${String(
  body?.description ||
    source.description ||
    source.wikipedia ||
    '',
).slice(0, 8000)}

Rewrite, never quote closely, never invent plot facts.

Return ONLY JSON:
{"whatItsAbout":"2-3 plain-English sentences","whyItWorks":"1-2 sentences","conversation":["3 specific spoiler-free discussion lanes"],"vibe":["3-5 short tags"],"headsUp":"style/pacing/commitment expectation"}`,
          );

        if (!parsed) {
          return json(
            {
              error:
                'Could not parse synthesis',
            },
            502,
            request,
            env,
          );
        }

        return json(
          {
            ...parsed,
            sourceBacked:
              true,
            sources:
              source.sources,
          },
          200,
          request,
          env,
        );
      } catch (error) {
        console.error(
          'Book decision failed',
          error?.message ||
            error,
        );

        return json(
          {
            error:
              'Synthesis unavailable',
          },
          502,
          request,
          env,
        );
      }
    }

    /* ---------------------------------------------------------------------- */
    /* Recommendations                                                        */
    /* ---------------------------------------------------------------------- */

    if (
      url.pathname ===
        '/api/recommendations' &&
      request.method === 'POST'
    ) {
      const user =
        await authedUser(
          request,
          env,
        );

      if (!user) {
        return json(
          {
            error:
              'Sign in required',
          },
          401,
          request,
          env,
        );
      }

      if (
        !rateLimit(
          `rec:${user.id}`,
          10,
          60000,
        )
      ) {
        return json(
          {
            error:
              'Try recommendations again in a minute.',
          },
          429,
          request,
          env,
        );
      }

      let body;

      try {
        body =
          await request.json();
      } catch {
        return json(
          {
            error:
              'invalid json',
          },
          400,
          request,
          env,
        );
      }

      const clubId =
        String(
          body?.clubId || '',
        );

      if (!clubId) {
        return json(
          {
            error:
              'clubId required',
          },
          400,
          request,
          env,
        );
      }

      if (
        !env.OPENAI_API_KEY
      ) {
        return json(
          {
            error:
              'AI recommendations are not configured.',
          },
          503,
          request,
          env,
        );
      }

      try {
        const profile =
          await userRpc(
            env,
            request.headers.get(
              'authorization',
            ),
            'get_club_taste_profile',
            {
              target_club_id:
                clubId,
            },
          );

        const parsed =
          await openAi(
            env,
            `Recommend 6 book-club books for a private group of friends.

Use this aggregated taste/history JSON:
${JSON.stringify(profile).slice(0, 12000)}

Do not repeat books already in ideas or clubHistory.
Respect avoidances as real negative constraints.
Use moods as current preference signals.
Balance fit with variety.
Avoid all six being the same genre.
Give a concise human reason grounded in supplied taste patterns.
Never use a compatibility percentage or generic AI language.

Return ONLY JSON:
{"suggestions":[{"title":"","author":"","reason":"1-2 sentences","confidence":"high|medium"}]}`,
          );

        const raw = (
          parsed?.suggestions ||
          []
        ).slice(0, 8);

        const suggestions =
          [];

        for (
          const suggestion of raw
        ) {
          const metadata =
            await openLibraryCandidate(
              suggestion.title,
              suggestion.author,
            );

          if (metadata) {
            suggestions.push({
              ...metadata,
              reason: String(
                suggestion.reason ||
                  '',
              ),
              confidence:
                suggestion.confidence ||
                'medium',
            });
          }

          if (
            suggestions.length >=
            6
          ) {
            break;
          }
        }

        return json(
          {
            suggestions,
          },
          200,
          request,
          env,
        );
      } catch (error) {
        return json(
          {
            error:
              error?.message ||
              'Recommendations unavailable',
          },
          502,
          request,
          env,
        );
      }
    }

    /* ---------------------------------------------------------------------- */
    /* Google Calendar OAuth start                                            */
    /* ---------------------------------------------------------------------- */

    if (
      url.pathname ===
        '/api/calendar/start' &&
      request.method === 'POST'
    ) {
      const user =
        await authedUser(
          request,
          env,
        );

      if (!user) {
        return json(
          {
            error:
              'Sign in required',
          },
          401,
          request,
          env,
        );
      }

      if (
        !calendarConfigured(env)
      ) {
        return json(
          {
            error:
              'Google Calendar is not configured yet.',
          },
          503,
          request,
          env,
        );
      }

      const state =
        await stateFor(
          env,
          user.id,
        );

      const params =
        new URLSearchParams({
          client_id:
            env.GOOGLE_CLIENT_ID,
          redirect_uri:
            env.GOOGLE_REDIRECT_URI,
          response_type:
            'code',
          access_type:
            'offline',
          prompt: 'consent',
          include_granted_scopes:
            'true',
          scope:
            'openid email https://www.googleapis.com/auth/calendar.events',
          state,
        });

      return json(
        {
          url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
        },
        200,
        request,
        env,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Google Calendar callback                                               */
    /* ---------------------------------------------------------------------- */

    if (
      url.pathname ===
      '/api/calendar/callback'
    ) {
      if (
        !calendarConfigured(env)
      ) {
        return new Response(
          'Calendar is not configured',
          {
            status: 503,
          },
        );
      }

      const userId =
        await verifyState(
          env,
          url.searchParams.get(
            'state',
          ),
        );

      const code =
        url.searchParams.get(
          'code',
        );

      if (!userId || !code) {
        return new Response(
          'Invalid or expired calendar connection request',
          {
            status: 400,
          },
        );
      }

      try {
        const params =
          new URLSearchParams({
            client_id:
              env.GOOGLE_CLIENT_ID,
            client_secret:
              env.GOOGLE_CLIENT_SECRET,
            redirect_uri:
              env.GOOGLE_REDIRECT_URI,
            grant_type:
              'authorization_code',
            code,
          });

        const tokens =
          await fetchJson(
            'https://oauth2.googleapis.com/token',
            {
              method: 'POST',
              headers: {
                'content-type':
                  'application/x-www-form-urlencoded',
              },
              body: params,
            },
            12000,
          );

        tokens.expires_at =
          Date.now() +
          Number(
            tokens.expires_in ||
              3600,
          ) *
            1000;

        let email = '';

        try {
          const info =
            await fetchJson(
              'https://openidconnect.googleapis.com/v1/userinfo',
              {
                headers: {
                  authorization: `Bearer ${tokens.access_token}`,
                },
              },
              8000,
            );

          email =
            info.email || '';
        } catch {}

        await adminUpsert(
          env,
          'calendar_connections',
          {
            user_id: userId,
            encrypted_tokens:
              await encrypt(
                env,
                tokens,
              ),
            email,
            expires_at:
              new Date(
                tokens.expires_at,
              ).toISOString(),
            scope:
              tokens.scope ||
              '',
            updated_at:
              new Date().toISOString(),
          },
          'user_id',
        );

        return Response.redirect(
          `${env.APP_ORIGIN}/me/settings?calendar=connected`,
          302,
        );
      } catch (error) {
        console.error(
          'Calendar OAuth callback failed',
          error?.message ||
            error,
        );

        return Response.redirect(
          `${env.APP_ORIGIN}/me/settings?calendar=error`,
          302,
        );
      }
    }

    /* ---------------------------------------------------------------------- */
    /* Google Calendar authenticated routes                                   */
    /* ---------------------------------------------------------------------- */

    if (
      url.pathname.startsWith(
        '/api/calendar/',
      )
    ) {
      const user =
        await authedUser(
          request,
          env,
        );

      if (!user) {
        return json(
          {
            error:
              'Sign in required',
          },
          401,
          request,
          env,
        );
      }

      if (
        !calendarConfigured(env)
      ) {
        return json(
          {
            configured: false,
            connected: false,
            error:
              'Google Calendar is not configured yet.',
          },
          url.pathname.endsWith(
            '/status',
          )
            ? 200
            : 503,
          request,
          env,
        );
      }

      if (
        url.pathname ===
        '/api/calendar/status'
      ) {
        const connection =
          await calendarConnection(
            env,
            user.id,
          );

        return json(
          {
            configured: true,
            connected:
              Boolean(
                connection,
              ),
            email:
              connection?.email ||
              undefined,
            lastSyncedAt:
              connection?.updated_at ||
              undefined,
          },
          200,
          request,
          env,
        );
      }

      if (
        url.pathname ===
          '/api/calendar/disconnect' &&
        request.method ===
          'POST'
      ) {
        await adminDelete(
          env,
          'calendar_event_links',
          `user_id=eq.${user.id}`,
        );

        await adminDelete(
          env,
          'calendar_connections',
          `user_id=eq.${user.id}`,
        );

        return json(
          {
            ok: true,
          },
          200,
          request,
          env,
        );
      }

      let body;

      try {
        body =
          await request.json();
      } catch {
        return json(
          {
            error:
              'invalid json',
          },
          400,
          request,
          env,
        );
      }

      const meetingId =
        String(
          body?.meetingId || '',
        );

      if (!meetingId) {
        return json(
          {
            error:
              'meetingId required',
          },
          400,
          request,
          env,
        );
      }

      if (
        url.pathname ===
          '/api/calendar/sync' &&
        request.method ===
          'POST'
      ) {
        try {
          return json(
            await syncCalendarMeeting(
              env,
              user.id,
              meetingId,
            ),
            200,
            request,
            env,
          );
        } catch (error) {
          return json(
            {
              error:
                error?.message ||
                'Calendar sync failed',
            },
            502,
            request,
            env,
          );
        }
      }

      if (
        url.pathname ===
          '/api/calendar/remove-event' &&
        request.method ===
          'POST'
      ) {
        try {
          const connection =
            await calendarConnection(
              env,
              user.id,
            );

          const links =
            await adminSelect(
              env,
              'calendar_event_links',
              `user_id=eq.${user.id}&meeting_id=eq.${meetingId}&select=*`,
            );

          const link =
            links?.[0];

          if (
            connection &&
            link
          ) {
            const tokens =
              await refreshedTokens(
                env,
                connection,
              );

            const response =
              await timedFetch(
                `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(
                  link.google_event_id,
                )}`,
                {
                  method:
                    'DELETE',
                  headers: {
                    authorization: `Bearer ${tokens.access_token}`,
                  },
                },
                12000,
              );

            if (
              !response.ok &&
              response.status !==
                404
            ) {
              throw new Error(
                'Could not remove Google Calendar event',
              );
            }
          }

          await adminDelete(
            env,
            'calendar_event_links',
            `user_id=eq.${user.id}&meeting_id=eq.${meetingId}`,
          );

          return json(
            {
              ok: true,
            },
            200,
            request,
            env,
          );
        } catch (error) {
          return json(
            {
              error:
                error?.message ||
                'Could not remove event',
            },
            502,
            request,
            env,
          );
        }
      }
    }

    return json(
      {
        error: 'not found',
      },
      404,
      request,
      env,
    );
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      processDueReminders(env),
    );
  },
};
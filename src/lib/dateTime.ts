const dateTimeBase: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
};

export function formatMeetingDateTime(value?: string, options: Intl.DateTimeFormatOptions = {}) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-US', { ...dateTimeBase, ...options }).format(new Date(value));
}

export function formatMeetingTime(value?: string) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(value));
}

export function currentTimeZoneShort() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(new Date());
  return parts.find(part => part.type === 'timeZoneName')?.value || '';
}

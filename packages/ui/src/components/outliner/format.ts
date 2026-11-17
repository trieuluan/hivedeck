/**
 * Compact Gmail-style relative time: "just now", "5m ago", "1d ago". Other
 * locales get the platform's wording ("5 phút trước").
 */
export function formatRelativeElapsed(
  iso: string | undefined,
  locale?: string
): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (locale && !locale.toLowerCase().startsWith('en')) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (seconds < 60) return rtf.format(0, 'second');
    if (minutes < 60) return rtf.format(-minutes, 'minute');
    if (hours < 24) return rtf.format(-hours, 'hour');
    return rtf.format(-days, 'day');
  }
  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

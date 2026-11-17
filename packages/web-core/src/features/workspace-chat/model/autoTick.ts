/**
 * Automatic captain ticks (sent by HiveDeck's backend loop, ADR-031) arrive
 * as user messages. They start with this marker; older ticks are recognised
 * by their fixed opening.
 */
export const AUTO_TICK_MARKER = '<!-- hivedeck:auto-tick -->';

const LEGACY_TICK_OPENINGS = [
  'You are the captain of project ',
  'Run one tick as the HiveDeck captain',
];

export function isAutoTickMessage(content: string): boolean {
  const text = content.trimStart();
  return (
    text.startsWith(AUTO_TICK_MARKER) ||
    LEGACY_TICK_OPENINGS.some((opening) => text.startsWith(opening))
  );
}

/** The tick's prompt without the marker, for the expanded view. */
export function autoTickBody(content: string): string {
  return content.replace(AUTO_TICK_MARKER, '').trim();
}

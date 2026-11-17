import { useEffect } from 'react';

const BASE_TITLE = 'HiveDeck';

let currentTitle = BASE_TITLE;
let badge = 0;

function applyTitle() {
  document.title = badge > 0 ? `(${badge}) ${currentTitle}` : currentTitle;
}

/** Number shown in front of the tab title, e.g. "(2) hivedeck | HiveDeck". */
export function setTitleBadge(count: number) {
  badge = count;
  applyTitle();
}

/**
 * Sets the document title based on the given parts.
 * Multiple callers can coexist — the most specific (deepest) component wins
 * because React runs child effects after parent effects.
 *
 * No cleanup is performed on unmount so that a parent-level caller
 * (e.g. the legacy ProjectProvider) provides a stable fallback without
 * competing with page-level callers.
 */
export function usePageTitle(...parts: (string | null | undefined)[]) {
  const filtered = parts.filter(Boolean) as string[];
  const title =
    filtered.length > 0
      ? `${filtered.join(' - ')} | ${BASE_TITLE}`
      : BASE_TITLE;

  useEffect(() => {
    currentTitle = title;
    applyTitle();
  }, [title]);
}

import { useLayoutEffect, useRef, type RefObject } from 'react';

type Point = { x: number; y: number };

const SELECTOR = '[data-dnd-card-issue-id]';
const DURATION_MS = 220;
const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/**
 * How far a card moved since the last layout, or null when it shouldn't
 * animate (new card, no real move, or a jump too large to be a move).
 */
export function flipDelta(
  before: Point | undefined,
  after: Point,
  { min = 1, max = 4000 } = {}
): Point | null {
  if (!before) return null;
  const dx = before.x - after.x;
  const dy = before.y - after.y;
  const dist = Math.hypot(dx, dy);
  if (dist < min || dist > max) return null;
  return { x: dx, y: dy };
}

/**
 * FLIP: when a card changes column or position, slide it from where it was
 * to where it is now instead of jumping. Positions are measured relative to
 * `containerRef`, so scrolling doesn't animate anything. Honors
 * prefers-reduced-motion.
 */
export function useFlipCards(containerRef: RefObject<HTMLElement>) {
  const last = useRef(new Map<string, Point>());

  // No deps on purpose: measure after every render of the board.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const origin = container.getBoundingClientRect();
    const next = new Map<string, Point>();
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    for (const el of container.querySelectorAll<HTMLElement>(SELECTOR)) {
      const id = el.dataset.dndCardIssueId;
      if (!id) continue;
      const rect = el.getBoundingClientRect();
      const point = {
        x: rect.left - origin.left + container.scrollLeft,
        y: rect.top - origin.top + container.scrollTop,
      };
      next.set(id, point);
      const delta = reduce ? null : flipDelta(last.current.get(id), point);
      if (delta && typeof el.animate === 'function') {
        el.animate(
          [
            { transform: `translate(${delta.x}px, ${delta.y}px)` },
            { transform: 'translate(0, 0)' },
          ],
          { duration: DURATION_MS, easing: EASING }
        );
      }
    }
    last.current = next;
  });
}

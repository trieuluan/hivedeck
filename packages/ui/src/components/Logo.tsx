import { cn } from '../lib/cn';

/**
 * Feather Caret — the HiveDeck brand mark.
 *
 * Stacked chevron barbs read as a feather and also as a terminal
 * fast-forward `>>>` caret. Strokes use `currentColor` so the mark
 * inherits whatever accent the surrounding theme provides.
 */
export function FeatherCaret({
  size = 22,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={(size * 100) / 124}
      height={size}
      viewBox="0 0 100 124"
      fill="none"
      aria-hidden="true"
      className={cn('flex-none', className)}
    >
      <g
        stroke="currentColor"
        strokeWidth={8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M50 12 L50 112" />
        <path d="M50 42 L30 25 M50 42 L70 25" />
        <path d="M50 72 L26 51 M50 72 L74 51" />
        <path d="M50 102 L24 80 M50 102 L76 80" />
      </g>
    </svg>
  );
}

/**
 * The HiveDeck wordmark, on a single line. Sizes are fixed in px so the
 * wordmark keeps its size even when the app's root font scale changes.
 */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span
      data-brand-wordmark
      aria-label="HiveDeck"
      className={cn(
        'flex items-baseline gap-2 font-ibm-plex-mono select-none',
        className
      )}
    >
      <span
        aria-hidden="true"
        className="text-xl font-extrabold leading-none tracking-[0.14em] text-high"
      >
        HIVE
      </span>
      <span
        aria-hidden="true"
        className="text-xl font-extrabold leading-none tracking-[0.14em] text-brand"
      >
        DECK
      </span>
    </span>
  );
}

/**
 * Full lockup: feather caret beside the wordmark. Used where both the
 * mark and the wordmark should appear together (e.g. the header rail).
 */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <img
        src="/hivedeck-mark.png"
        alt=""
        aria-hidden="true"
        className="size-7 shrink-0 rounded-md object-cover"
      />
      <BrandWordmark />
    </span>
  );
}

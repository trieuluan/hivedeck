import { useId, type ReactNode } from 'react';
import { CaretRightIcon } from '@phosphor-icons/react';
import { cn } from '../lib/cn';

interface ChatWorkGroupProps {
  /** One-line summary, e.g. "Worked · 12 steps · 3 files". */
  label: string;
  expanded: boolean;
  onToggle: () => void;
  /** The collapsed rows, rendered only while expanded. */
  children: ReactNode;
  className?: string;
}

/**
 * The work an agent did in a finished turn, collapsed into one quiet line
 * above its answer. Expanding shows every step in place.
 */
export function ChatWorkGroup({
  label,
  expanded,
  onToggle,
  children,
  className,
}: ChatWorkGroupProps) {
  const bodyId = useId();
  return (
    <div className={cn('flex flex-col', className)}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={bodyId}
        data-scroll-anchor-target=""
        className="group/work flex min-h-7 w-fit items-center gap-1.5 rounded-sm text-sm text-low hover:text-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <CaretRightIcon
          aria-hidden="true"
          weight="bold"
          className={cn(
            'size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none',
            expanded && 'rotate-90'
          )}
        />
        <span>{label}</span>
      </button>
      {expanded && (
        <div
          id={bodyId}
          className="mt-1 flex flex-col gap-2 border-l border-border pl-3"
        >
          {children}
        </div>
      )}
    </div>
  );
}

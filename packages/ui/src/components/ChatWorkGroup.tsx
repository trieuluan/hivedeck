import { useId, type ReactNode } from 'react';
import { CaretRightIcon, StackSimpleIcon } from '@phosphor-icons/react';
import { cn } from '../lib/cn';

interface ChatWorkGroupProps {
  /** One-line summary, e.g. "Read 3 files, ran 2 commands". */
  label: string;
  expanded: boolean;
  onToggle: () => void;
  /** The collapsed rows, rendered only while expanded. */
  children: ReactNode;
  className?: string;
}

/**
 * A run of steps between two of the agent's messages (reads, searches,
 * commands, edits), folded into one quiet line. Expanding shows each step
 * on a thin rail, in place.
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
        className="group/work -mx-1.5 flex min-h-7 w-fit max-w-full items-center gap-2 rounded-md px-1.5 text-[13px] text-low transition-colors hover:bg-secondary/70 hover:text-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <StackSimpleIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
        <CaretRightIcon
          aria-hidden="true"
          weight="bold"
          className={cn(
            'size-2.5 shrink-0 opacity-0 transition-[transform,opacity] duration-150 group-hover/work:opacity-100 group-focus-visible/work:opacity-100 motion-reduce:transition-none',
            expanded && 'rotate-90 opacity-100'
          )}
        />
      </button>
      {expanded && (
        <div
          id={bodyId}
          className="ship-work-body ml-[6px] mt-0.5 flex flex-col border-l border-border pl-3.5 animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none"
        >
          {children}
        </div>
      )}
    </div>
  );
}

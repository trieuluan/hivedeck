import type { ReactNode } from "react";
import { WarningCircleIcon } from "@phosphor-icons/react";
import { cn } from "../lib/cn";

interface ChatErrorMessageProps {
  content: string;
  className?: string;
  expanded?: boolean;
  onToggle?: () => void;
  /** A readable summary; when set, `content` becomes collapsible details. */
  title?: string;
  /** What to do about it. */
  hint?: string;
  /** Buttons shown under the hint (e.g. "Open Router"). */
  actions?: ReactNode;
  /** Label of the details toggle, e.g. "Details". */
  detailsLabel?: string;
}

export function ChatErrorMessage({
  content,
  className,
  expanded,
  onToggle,
  title,
  hint,
  actions,
  detailsLabel,
}: ChatErrorMessageProps) {
  if (!title) {
    return (
      <div
        className={cn(
          "flex items-start gap-base text-sm text-error cursor-pointer",
          className,
        )}
        onClick={onToggle}
        role="button"
      >
        <WarningCircleIcon className="shrink-0 size-icon-base pt-0.5" />
        <span
          className={cn(
            !expanded && "truncate",
            expanded && "whitespace-pre-wrap break-all",
          )}
        >
          {content}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-start gap-base rounded-md border border-error/30 bg-error/5 p-base text-sm",
        className,
      )}
      role="alert"
    >
      <WarningCircleIcon className="shrink-0 size-icon-base pt-0.5 text-error" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium text-error">{title}</p>
        {hint && <p className="text-low">{hint}</p>}
        {actions && <div className="flex flex-wrap gap-2 pt-1">{actions}</div>}
        <button
          type="button"
          onClick={onToggle}
          className="text-xs text-low underline-offset-2 hover:underline"
        >
          {detailsLabel ?? "Details"} {expanded ? "▴" : "▾"}
        </button>
        {expanded && (
          <pre className="whitespace-pre-wrap break-all font-mono text-xs text-low">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}

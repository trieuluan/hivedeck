import { CheckCircleIcon, InfoIcon } from "@phosphor-icons/react";
import { cn } from "../lib/cn";

interface ChatSystemMessageProps {
  content: string;
  className?: string;
  expanded?: boolean;
  onToggle?: () => void;
}

export function ChatSystemMessage({
  content,
  className,
  expanded,
  onToggle,
}: ChatSystemMessageProps) {
  const isCompact =
    content === "Context compacted" ||
    content.startsWith("Context compacted") ||
    content.startsWith("Đã thu gọn context");

  if (isCompact) {
    const extraDetail =
      content !== "Context compacted" && content !== "Đã thu gọn context"
        ? content
            .replace(/^Context compacted[:\s-]*/, "")
            .replace(/^Đã thu gọn context[:\s-]*/, "")
            .trim()
        : "";

    return (
      <div
        className={cn(
          "flex items-start gap-2.5 border-l-2 border-brand bg-secondary/40 rounded-r-md px-3 py-2 text-sm cursor-pointer",
          className,
        )}
        onClick={onToggle}
        role="button"
      >
        <CheckCircleIcon
          weight="fill"
          className="shrink-0 size-icon-base text-brand mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-normal">Đã thu gọn context</span>
            {extraDetail && !expanded && (
              <span className="text-xs text-low truncate">{extraDetail}</span>
            )}
          </div>
          {extraDetail && expanded && (
            <div className="mt-1 text-xs text-low whitespace-pre-wrap break-all">
              {extraDetail}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-start gap-base text-sm text-low cursor-pointer",
        className,
      )}
      onClick={onToggle}
      role="button"
    >
      <InfoIcon className="shrink-0 size-icon-base pt-0.5" />
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

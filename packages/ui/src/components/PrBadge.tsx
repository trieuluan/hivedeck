import { cn } from "../lib/cn";
import { ArrowSquareOutIcon, GitPullRequestIcon } from "@phosphor-icons/react";

export type PrBadgeStatus = "open" | "merged" | "closed";

export interface PrBadgeProps {
  number: number;
  url: string;
  status: PrBadgeStatus;
  targetBranchName?: string | null;
  showStatus?: boolean;
  className?: string;
}

export function PrBadge({
  number,
  url,
  status,
  targetBranchName,
  showStatus = true,
  className,
}: PrBadgeProps) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-medium transition-colors min-w-0",
        status === "merged"
          ? "border-merged/30 bg-merged/10 text-merged hover:bg-merged/20"
          : status === "closed"
            ? "border-error/30 bg-error/10 text-error hover:bg-error/20"
            : "border-success/30 bg-success/10 text-success hover:bg-success/20",
        className,
      )}
    >
      <GitPullRequestIcon className="size-icon-2xs shrink-0" weight="bold" />
      <span className="truncate">
        PR #{number}
        {showStatus ? ` · ${status}` : ""}
        {targetBranchName ? ` → ${targetBranchName}` : ""}
      </span>
      <ArrowSquareOutIcon
        className="size-3 shrink-0 opacity-75"
        weight="bold"
      />
    </a>
  );
}

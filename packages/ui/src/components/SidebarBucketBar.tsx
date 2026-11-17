import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  attentionReason,
  compareAttention,
  compareWorkspaceDashboardRecency,
  isWorkspaceIdle,
  isWorkspaceNeedsAttention,
  isWorkspaceRunning,
  type AttentionReason,
} from "../lib/workspaceStatus";
import {
  BAR_BUCKETS,
  BAR_BUCKET_ORDER,
  type BarBucketId,
  type BarBucketMeta,
} from "../lib/buckets";
import { cn } from "../lib/cn";
import { SidebarBar } from "./SidebarBar";
import { SidebarBarButton } from "./SidebarBarButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./DropdownMenu";
import { WorkspaceActivityText } from "./WorkspaceActivityText";
import { formatRelativeElapsed } from "./outliner/format";
import type { OutlinerWorkspace } from "./outliner/types";

interface SidebarBucketBarProps {
  /** All active (non-archived) workspaces. */
  workspaces: readonly OutlinerWorkspace[];
  /**
   * Workspaces kept out of the tree (project captains) that should still
   * reach the attention inbox when they're blocked.
   */
  attentionOnlyWorkspaces?: readonly OutlinerWorkspace[];
  activeWorkspaceId: string | null;
  onSelectWorkspace: (id: string) => void;
  /** Clears "finished/failed, not yet looked at" for these workspaces. */
  onMarkSeen?: (ids: string[]) => void;
  className?: string;
}

const BUCKET_PREDICATE: Record<BarBucketId, (w: OutlinerWorkspace) => boolean> =
  {
    attention: isWorkspaceNeedsAttention,
    running: isWorkspaceRunning,
    idle: isWorkspaceIdle,
  };

/**
 * Top-of-sidebar toolbar with one dropdown button per active workspace bucket
 * (ADR-009). Always renders all three buttons; empty buckets open a small
 * "No workspaces" row. Items inside each dropdown are sorted newest-first by
 * `compareWorkspaceDashboardRecency` — the shared prop array is never
 * mutated, so the project tree below keeps its own ordering.
 */
export function SidebarBucketBar({
  workspaces,
  attentionOnlyWorkspaces = [],
  activeWorkspaceId,
  onSelectWorkspace,
  onMarkSeen,
  className,
}: SidebarBucketBarProps) {
  const { t } = useTranslation("common");

  const buckets = useMemo(() => {
    const byBucket: Record<BarBucketId, OutlinerWorkspace[]> = {
      attention: [],
      running: [],
      idle: [],
    };
    for (const ws of workspaces) {
      for (const id of BAR_BUCKET_ORDER) {
        if (BUCKET_PREDICATE[id](ws)) {
          byBucket[id].push(ws);
          break; // buckets are mutually exclusive by construction
        }
      }
    }
    for (const ws of attentionOnlyWorkspaces) {
      if (isWorkspaceNeedsAttention(ws)) byBucket.attention.push(ws);
    }
    byBucket.attention.sort(compareAttention);
    byBucket.running.sort(compareWorkspaceDashboardRecency);
    byBucket.idle.sort(compareWorkspaceDashboardRecency);
    return byBucket;
  }, [workspaces, attentionOnlyWorkspaces]);

  return (
    <SidebarBar
      aria-label={t("workspaces.bucketBarLabel")}
      className={className}
    >
      {BAR_BUCKET_ORDER.map((id) =>
        id === "attention" ? (
          <AttentionInboxButton
            key={id}
            meta={BAR_BUCKETS[id]}
            items={buckets[id]}
            activeWorkspaceId={activeWorkspaceId}
            onSelectWorkspace={onSelectWorkspace}
            onMarkSeen={onMarkSeen}
          />
        ) : (
          <BucketButton
            key={id}
            meta={BAR_BUCKETS[id]}
            items={buckets[id]}
            activeWorkspaceId={activeWorkspaceId}
            onSelectWorkspace={onSelectWorkspace}
            emptyLabel={t("workspaces.bucketEmpty")}
          />
        ),
      )}
    </SidebarBar>
  );
}

interface BucketButtonProps {
  meta: BarBucketMeta;
  items: readonly OutlinerWorkspace[];
  activeWorkspaceId: string | null;
  onSelectWorkspace: (id: string) => void;
  emptyLabel: string;
}

function BucketButton({
  meta,
  items,
  activeWorkspaceId,
  onSelectWorkspace,
  emptyLabel,
}: BucketButtonProps) {
  const { t } = useTranslation("common");
  const count = items.length;
  const label = t(meta.labelKey);
  const showBadge = !meta.hideBadge && count > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarBarButton
          className="flex-1"
          label={label}
          icon={meta.icon}
          iconClass={meta.iconClass}
          badgeCount={showBadge ? count : undefined}
          badgeClass={meta.badgeClass}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        align="start"
        className="min-w-[260px] max-w-[320px]"
      >
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {count === 0 ? (
          <p className="px-2 py-1.5 text-xs text-low">{emptyLabel}</p>
        ) : (
          items.map((ws) => (
            <WorkspaceBucketMenuItem
              key={ws.id}
              workspace={ws}
              active={ws.id === activeWorkspaceId}
              onSelectWorkspace={onSelectWorkspace}
            />
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkspaceBucketMenuItem({
  workspace,
  active,
  onSelectWorkspace,
}: {
  workspace: OutlinerWorkspace;
  active: boolean;
  onSelectWorkspace: (id: string) => void;
}) {
  const elapsed = formatRelativeElapsed(workspace.latestProcessCompletedAt);
  return (
    <DropdownMenuItem
      // Radix closes the menu after onSelect fires by default — gives us
      // close-on-navigate for free.
      onSelect={() => onSelectWorkspace(workspace.id)}
      aria-current={active ? "page" : undefined}
      className="flex flex-col items-stretch gap-0.5 py-1.5"
    >
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className={cn("truncate", active && "font-semibold text-high")}>
          {workspace.name}
        </span>
        {elapsed && (
          <span className="shrink-0 text-xs text-low">{elapsed}</span>
        )}
      </span>
      <WorkspaceActivityText
        filesChanged={workspace.filesChanged}
        linesAdded={workspace.linesAdded}
        linesRemoved={workspace.linesRemoved}
      />
    </DropdownMenuItem>
  );
}

const REASON_STYLE: Record<AttentionReason, string> = {
  approval: "bg-warning/15 text-warning",
  failed: "bg-error/15 text-error",
  finished: "bg-success/15 text-success",
};

/**
 * The attention inbox: everything waiting on you, most urgent first, each
 * with why it's here and what clicking does. Opening an item marks it seen.
 */
function AttentionInboxButton({
  meta,
  items,
  activeWorkspaceId,
  onSelectWorkspace,
  onMarkSeen,
}: {
  meta: BarBucketMeta;
  items: readonly OutlinerWorkspace[];
  activeWorkspaceId: string | null;
  onSelectWorkspace: (id: string) => void;
  onMarkSeen?: (ids: string[]) => void;
}) {
  const { t } = useTranslation("common");
  const count = items.length;
  const label = t(meta.labelKey);
  // Approvals clear only by answering them; the rest can be dismissed.
  const dismissable = items
    .filter((ws) => attentionReason(ws) !== "approval")
    .map((ws) => ws.id);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarBarButton
          className="flex-1"
          label={label}
          icon={meta.icon}
          iconClass={meta.iconClass}
          badgeCount={count > 0 ? count : undefined}
          badgeClass={meta.badgeClass}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        align="start"
        className="w-[320px] max-w-[calc(100vw-16px)]"
      >
        <DropdownMenuLabel>{t("attentionInbox.title")}</DropdownMenuLabel>
        {count === 0 ? (
          <p className="px-2 pb-2 pt-0.5 text-xs text-low">
            {t("attentionInbox.empty")}
          </p>
        ) : (
          items.map((ws) => (
            <AttentionInboxItem
              key={ws.id}
              workspace={ws}
              active={ws.id === activeWorkspaceId}
              onSelectWorkspace={onSelectWorkspace}
            />
          ))
        )}
        {onMarkSeen && dismissable.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => onMarkSeen(dismissable)}
              className="text-xs text-low"
            >
              {t("attentionInbox.markAllSeen", { count: dismissable.length })}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AttentionInboxItem({
  workspace,
  active,
  onSelectWorkspace,
}: {
  workspace: OutlinerWorkspace;
  active: boolean;
  onSelectWorkspace: (id: string) => void;
}) {
  const { t } = useTranslation("common");
  const reason = attentionReason(workspace) ?? "finished";
  const elapsed = formatRelativeElapsed(workspace.latestProcessCompletedAt);
  const name =
    workspace.kind === "orchestrator"
      ? t("attentionInbox.captain", { name: workspace.name })
      : workspace.name;
  return (
    <DropdownMenuItem
      onSelect={() => onSelectWorkspace(workspace.id)}
      aria-current={active ? "page" : undefined}
      className="flex flex-col items-stretch gap-1 py-2"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "shrink-0 rounded-sm px-1.5 py-px text-2xs font-medium",
            REASON_STYLE[reason],
          )}
        >
          {t(`attentionInbox.reason.${reason}`)}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            active && "font-semibold text-high",
          )}
        >
          {name}
        </span>
        {elapsed && (
          <span className="shrink-0 text-xs text-low">{elapsed}</span>
        )}
      </span>
      <span className="flex items-center justify-between gap-2 text-xs text-low">
        {(workspace.filesChanged ?? 0) > 0 ? (
          <WorkspaceActivityText
            filesChanged={workspace.filesChanged}
            linesAdded={workspace.linesAdded}
            linesRemoved={workspace.linesRemoved}
          />
        ) : (
          <span />
        )}
        <span className="shrink-0 font-medium text-normal">
          {t(`attentionInbox.action.${reason}`)} →
        </span>
      </span>
    </DropdownMenuItem>
  );
}

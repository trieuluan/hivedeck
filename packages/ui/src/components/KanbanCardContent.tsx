"use client";

import type { MouseEvent, ReactNode } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowSquareOutIcon,
  CaretRightIcon,
  CircleDashedIcon,
  DotsThreeIcon,
  GitBranchIcon,
  KanbanIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { cn } from "../lib/cn";
import { PriorityIcon, type PriorityLevel } from "./PriorityIcon";
import { KanbanBadge } from "./KanbanBadge";
import { RunningDots } from "./RunningDots";
import { PrBadge, type PrBadgeStatus } from "./PrBadge";
import {
  RelationshipBadge,
  type RelationshipDisplayType,
} from "./RelationshipBadge";

export interface KanbanTag {
  id: string;
  name: string;
  color: string;
}

export interface KanbanRelationship {
  relationshipId: string;
  displayType: RelationshipDisplayType;
  relatedIssueDisplayId: string;
}

export interface KanbanPullRequest {
  id: string;
  number: number;
  url: string;
  status: PrBadgeStatus;
}

export interface TagEditRenderProps<TTag extends KanbanTag = KanbanTag> {
  allTags: TTag[];
  selectedTagIds: string[];
  onTagToggle: (tagId: string) => void;
  onCreateTag: (data: { name: string; color: string }) => string;
  trigger: ReactNode;
}

export interface TagEditProps<TTag extends KanbanTag = KanbanTag> {
  allTags: TTag[];
  selectedTagIds: string[];
  onTagToggle: (tagId: string) => void;
  onCreateTag: (data: { name: string; color: string }) => string;
  renderTagEditor?: (props: TagEditRenderProps<TTag>) => ReactNode;
}

const IMAGE_FILE_EXTENSION_REGEX =
  /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i;

function isImageLikeAttachmentName(name: string): boolean {
  const normalized = name.trim();
  if (!normalized) {
    return false;
  }

  return IMAGE_FILE_EXTENSION_REGEX.test(normalized);
}

function formatKanbanDescriptionPreview(
  markdown: string,
  options: {
    codeBlockLabel: string;
    imageLabel: string;
    imageWithNameLabel: (name: string) => string;
    fileLabel: string;
    fileWithNameLabel: (name: string) => string;
  },
): string {
  return markdown
    .replace(/```[\s\S]*?```/g, options.codeBlockLabel)
    .replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      (_match, altText: string, url: string) => {
        const normalizedAlt = altText.trim();
        const normalizedUrl = url.trim();
        const isImageAttachment =
          normalizedUrl.startsWith("/api/attachments/") &&
          isImageLikeAttachmentName(normalizedAlt);

        if (isImageAttachment) {
          return normalizedAlt
            ? options.imageWithNameLabel(normalizedAlt)
            : options.imageLabel;
        }

        return normalizedAlt
          ? options.fileWithNameLabel(normalizedAlt)
          : options.fileLabel;
      },
    )
    .replace(
      /(?<!!)\[([^\]]*)\]\((\/api\/attachments\/[^)]+\/file|\.vibe-attachments\/[^)]+)\)/g,
      (_match, label: string) => {
        const normalizedLabel = label.trim();
        return normalizedLabel
          ? options.fileWithNameLabel(normalizedLabel)
          : options.fileLabel;
      },
    )
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export type KanbanCardContentProps<TTag extends KanbanTag = KanbanTag> = {
  displayId: string;
  title: string;
  statusName?: string;
  cancelReason?: string | null;
  description?: string | null;
  priority: PriorityLevel | null;
  tags: KanbanTag[];
  pullRequests?: KanbanPullRequest[];
  relationships?: KanbanRelationship[];
  isSubIssue?: boolean;
  /** Number of sub-issues this card has. When > 0, an expandable "↳ N"
   *  badge renders on the card; expanding reveals the children inline
   *  (rendered by the container). */
  subIssueCount?: number;
  /** Whether this card's sub-issues are currently expanded. */
  isSubIssuesExpanded?: boolean;
  /** Toggle the inline sub-issue expansion for this card. */
  onToggleSubIssues?: () => void;
  /** Open the full-page sub-issue board for this parent card. */
  onOpenSubBoard?: () => void;
  isLoading?: boolean;
  className?: string;
  onPriorityClick?: (e: MouseEvent) => void;
  onMoreActionsClick?: () => void;
  moreActions?: ReactNode;
  tagEditProps?: TagEditProps<TTag>;
  isMobile?: boolean;
  /** Optional metadata placed in the top-right header (e.g. artifact count) */
  headerMeta?: ReactNode;
  /** Extra row at the bottom of the card (e.g. the Merge button on an In
   *  Review card). */
  footer?: ReactNode;
  /** Title-only card (e.g. in a done column): no description preview. */
  compact?: boolean;
  /** Retained local workspace/worktree summary shown directly on the card. */
  retainedWorkspace?: {
    count: number;
    linesAdded?: number;
    linesRemoved?: number;
    onOpen?: () => void;
  } | null;
};

export function KanbanCardContent<TTag extends KanbanTag = KanbanTag>({
  displayId,
  title,
  statusName,
  description,
  priority,
  tags,
  pullRequests = [],
  relationships = [],
  isSubIssue,
  subIssueCount,
  isSubIssuesExpanded,
  onToggleSubIssues,
  onOpenSubBoard,
  isLoading = false,
  className,
  onPriorityClick,
  onMoreActionsClick,
  moreActions,
  tagEditProps,
  isMobile,
  headerMeta,
  footer,
  compact = false,
  retainedWorkspace,
  cancelReason,
}: KanbanCardContentProps<TTag>) {
  const normalizedStatus = statusName?.trim().toLowerCase() ?? "";
  const isCancelledStatus =
    normalizedStatus === "cancelled" || normalizedStatus === "canceled";
  const statusPillClass =
    normalizedStatus === "done"
      ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
      : normalizedStatus === "in review" || normalizedStatus === "review"
        ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
        : normalizedStatus === "in progress"
          ? "bg-sky-500/15 text-sky-300 border border-sky-500/30"
          : isCancelledStatus
            ? "bg-rose-500/15 text-rose-300 border border-rose-500/30"
            : "bg-secondary text-normal border border-border/60";
  const { t } = useTranslation("common");
  const previewDescription = useMemo(() => {
    if (!description) {
      return null;
    }

    const formatted = formatKanbanDescriptionPreview(description, {
      codeBlockLabel: t("kanban.previewCodeBlock"),
      imageLabel: t("kanban.previewImage"),
      imageWithNameLabel: (name: string) =>
        t("kanban.previewImageWithName", { name }),
      fileLabel: t("kanban.previewFile"),
      fileWithNameLabel: (name: string) =>
        t("kanban.previewFileWithName", { name }),
    });
    return formatted.length > 0 ? formatted : null;
  }, [description, t]);

  const tagsDisplay = (
    <>
      {tags.slice(0, 2).map((tag) => (
        <KanbanBadge key={tag.id} name={tag.name} color={tag.color} />
      ))}
      {tags.length > 2 && (
        <span className="text-sm text-low">+{tags.length - 2}</span>
      )}
      {tagEditProps && tags.length === 0 && (
        <PlusIcon className="size-icon-xs text-low" weight="bold" />
      )}
    </>
  );
  const tagEditorTrigger = (
    <button
      type="button"
      onClick={(e) => e.stopPropagation()}
      aria-label={t("kanban.tags")}
      title={t("kanban.tags")}
      className="relative after:absolute after:left-1/2 after:top-1/2 after:size-8 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] flex items-center gap-half cursor-pointer hover:bg-secondary rounded-sm transition-colors"
    >
      {tagsDisplay}
    </button>
  );

  return (
    <div className={cn("flex flex-col gap-2.5 min-w-0", className)}>
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          {isSubIssue && (
            <span className="text-xs text-low mr-1">
              {t("kanban.subIssueIndicator")}
            </span>
          )}
          <span className="font-ibm-plex-mono text-xs font-medium text-low">
            {displayId}
          </span>
          <span
            className={cn(
              "mt-1 block text-lg font-semibold leading-snug line-clamp-2 break-words",
              isCancelledStatus ? "line-through text-low" : "text-high",
            )}
            title={title}
          >
            {title}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {headerMeta}
          {moreActions ??
            (onMoreActionsClick && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoreActionsClick();
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="-mr-1 -mt-1 rounded p-1.5 text-low hover:text-high hover:bg-secondary focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand"
                aria-label={t("common:ui.moreActions")}
                title={t("common:ui.moreActions")}
              >
                <DotsThreeIcon className="size-4" weight="bold" />
              </button>
            ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        {onPriorityClick ? (
          <button
            type="button"
            onClick={onPriorityClick}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label={t("kanban.priority")}
            title={t("kanban.priority")}
            className="flex shrink-0 items-center gap-1 rounded bg-secondary px-1.5 py-1 text-xs font-medium text-normal hover:text-high focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand"
          >
            <PriorityIcon priority={priority} />
            {!priority && (
              <CircleDashedIcon
                className="size-icon-xs text-low"
                weight="bold"
              />
            )}
            <span>
              {priority
                ? t(`createIssueDialog.priority.${priority}`)
                : t("kanban.priority")}
            </span>
          </button>
        ) : (
          <PriorityIcon priority={priority} />
        )}
        {statusName && (
          <span
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium",
              statusPillClass,
            )}
            title={statusName}
          >
            {statusName}
          </span>
        )}
        {tags.length > 0 && (
          <div className="flex items-center gap-1 min-w-0 overflow-hidden">
            {tagEditProps ? (
              (tagEditProps.renderTagEditor?.({
                allTags: tagEditProps.allTags,
                selectedTagIds: tagEditProps.selectedTagIds,
                onTagToggle: tagEditProps.onTagToggle,
                onCreateTag: tagEditProps.onCreateTag,
                trigger: tagEditorTrigger,
              }) ?? tagEditorTrigger)
            ) : (
              <>
                {tags.slice(0, 2).map((tag) => (
                  <KanbanBadge key={tag.id} name={tag.name} color={tag.color} />
                ))}
                {tags.length > 2 && (
                  <span className="text-xs text-low shrink-0">
                    +{tags.length - 2}
                  </span>
                )}
              </>
            )}
          </div>
        )}
        {tagEditProps && tags.length === 0 && !isMobile && (
          <div className="opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto transition-opacity shrink-0">
            {tagEditProps.renderTagEditor?.({
              allTags: tagEditProps.allTags,
              selectedTagIds: tagEditProps.selectedTagIds,
              onTagToggle: tagEditProps.onTagToggle,
              onCreateTag: tagEditProps.onCreateTag,
              trigger: tagEditorTrigger,
            }) ?? tagEditorTrigger}
          </div>
        )}
        {isLoading && <RunningDots />}
      </div>

      {/* Row 3: Description (optional, short; full text in the tooltip) */}
      {isCancelledStatus && cancelReason?.trim() && (
        <div className="rounded border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-200/90">
          <span className="font-semibold text-rose-300">Cancelled:</span>{" "}
          <span>{cancelReason.trim()}</span>
        </div>
      )}
      {previewDescription && !compact && (
        <p
          className="text-sm text-low m-0 leading-snug line-clamp-2"
          title={previewDescription}
        >
          {previewDescription}
        </p>
      )}

      {/* Row 4: PRs, Relationships, Retained Workspace */}
      {(pullRequests.length > 0 ||
        relationships.length > 0 ||
        (retainedWorkspace && retainedWorkspace.count > 0)) && (
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {pullRequests.slice(0, 2).map((pr) => (
            <PrBadge
              key={pr.id}
              number={pr.number}
              url={pr.url}
              status={pr.status}
            />
          ))}
          {pullRequests.length > 2 && (
            <span className="text-sm text-low">+{pullRequests.length - 2}</span>
          )}
          {relationships.slice(0, 2).map((rel) => (
            <RelationshipBadge
              key={rel.relationshipId}
              displayType={rel.displayType}
              relatedIssueDisplayId={rel.relatedIssueDisplayId}
              compact
            />
          ))}
          {relationships.length > 2 && (
            <span className="text-sm text-low">
              +{relationships.length - 2}
            </span>
          )}
          {retainedWorkspace && retainedWorkspace.count > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                retainedWorkspace.onOpen?.();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              title="Mở workspace đang giữ"
              className="group/ws inline-flex items-center gap-1 rounded border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-400 transition-colors hover:bg-emerald-500/20"
            >
              <GitBranchIcon className="size-3 shrink-0" weight="bold" />
              <span>
                {retainedWorkspace.count > 1
                  ? `${retainedWorkspace.count} ws`
                  : "Workspace"}
              </span>
              {((retainedWorkspace.linesAdded ?? 0) > 0 ||
                (retainedWorkspace.linesRemoved ?? 0) > 0) && (
                <span className="font-ibm-plex-mono text-[10px] tabular-nums">
                  <span className="text-emerald-300">
                    +{retainedWorkspace.linesAdded ?? 0}
                  </span>{" "}
                  <span className="text-rose-400">
                    -{retainedWorkspace.linesRemoved ?? 0}
                  </span>
                </span>
              )}
              {retainedWorkspace.onOpen && (
                <ArrowSquareOutIcon
                  className="size-3 shrink-0 opacity-70 group-hover/ws:opacity-100"
                  weight="bold"
                />
              )}
            </button>
          )}
        </div>
      )}

      {/* Row 6: Sub-issues expandable badge + sub-board link (parent cards). */}
      {!!subIssueCount &&
        subIssueCount > 0 &&
        (onToggleSubIssues || onOpenSubBoard) && (
          <div className="flex items-center gap-half">
            {onToggleSubIssues && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSubIssues();
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                aria-expanded={isSubIssuesExpanded}
                aria-label={t("kanban.subIssuesCount", {
                  count: subIssueCount,
                })}
                className="flex min-h-8 items-center gap-1 rounded border border-border bg-secondary/60 px-2 text-normal hover:text-high hover:bg-secondary focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand"
              >
                <CaretRightIcon
                  className={cn(
                    "size-3 transition-transform",
                    isSubIssuesExpanded && "rotate-90",
                  )}
                  weight="bold"
                />
                <span className="text-sm font-medium">
                  {t("kanban.subIssuesCount", { count: subIssueCount })}
                </span>
              </button>
            )}
            {onOpenSubBoard && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenSubBoard();
                }}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label={t("kanban.subIssueBoardTitle")}
                title={t("kanban.subIssueBoardTitle")}
                className="relative after:absolute after:left-1/2 after:top-1/2 after:size-8 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] -m-half ml-auto flex items-center p-half rounded-sm text-low hover:text-normal hover:bg-secondary transition-colors"
              >
                <KanbanIcon className="size-icon-xs" weight="bold" />
              </button>
            )}
          </div>
        )}
      {footer && (
        <div className="flex items-center gap-1.5 pt-half min-w-0">
          {footer}
        </div>
      )}
    </div>
  );
}

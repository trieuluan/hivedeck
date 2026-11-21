import { cn } from "../lib/cn";
import { useTranslation } from "react-i18next";
import {
  GitBranchIcon,
  GitPullRequestIcon,
  DotsThreeIcon,
  LinkBreakIcon,
  TrashIcon,
  PlayIcon,
  HandIcon,
  TriangleIcon,
  CircleIcon,
  PaperPlaneTiltIcon,
  ArrowSquareOutIcon,
} from "@phosphor-icons/react";
import { UserAvatar, type UserAvatarUser } from "./UserAvatar";
import { RunningDots } from "./RunningDots";
import { useWorkspaceTime } from "./WorkspaceTime";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./DropdownMenu";

export interface WorkspacePr {
  number: number;
  url: string;
  status: "open" | "merged" | "closed";
}

export interface WorkspaceWithStats {
  id: string;
  localWorkspaceId: string | null;
  name: string | null;
  archived: boolean;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  prs: WorkspacePr[];
  owner: UserAvatarUser | null;
  updatedAt: string;
  isRunning?: boolean;
  hasPendingApproval?: boolean;
  hasRunningDevServer?: boolean;
  hasUnseenActivity?: boolean;
  latestProcessCompletedAt?: string;
  latestProcessStartedAt?: string;
  latestProcessStatus?: "running" | "completed" | "failed" | "killed";
  currentPipelineStage?: number | null;
}

export interface IssueWorkspaceCardProps {
  workspace: WorkspaceWithStats;
  onClick?: () => void;
  onRunIssue?: () => void;
  onUnlink?: () => void;
  onDelete?: () => void;
  showOwner?: boolean;
  showStatusBadge?: boolean;
  showNoPrText?: boolean;
  compact?: boolean;
  /** Current 1-based pipeline stage reported by the running agent. */
  pipelineStage?: number | null;
  /** Total pipeline stages parsed from the card description. */
  pipelineTotal?: number;
  className?: string;
}

export interface IssueWorkspaceCreateCardProps {
  onClick?: () => void;
  className?: string;
  shouldAnimateCreateButton?: boolean;
}

interface IssueWorkspaceCardContainerProps {
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}

function IssueWorkspaceCardContainer({
  onClick,
  className,
  children,
}: IssueWorkspaceCardContainerProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-half p-base bg-panel rounded-sm transition-all duration-150",
        onClick && "cursor-pointer hover:bg-secondary/70",
        className,
      )}
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
      onMouseUp={
        onClick
          ? (e) => {
              // The kanban card opens the issue on mouseup; stop the bubble so
              // clicking this card does not navigate to the issue too.
              e.stopPropagation();
            }
          : undefined
      }
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onClick();
              }
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

export function pipelineProgressPercent(
  stage: number | null | undefined,
  total: number | undefined,
): number | null {
  if (stage == null || !total || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((stage / total) * 100)));
}

export function IssueWorkspaceCard({
  workspace,
  onClick,
  onRunIssue,
  onUnlink,
  onDelete,
  showOwner = true,
  showStatusBadge = true,
  showNoPrText = true,
  compact = false,
  pipelineStage,
  pipelineTotal,
  className,
}: IssueWorkspaceCardProps) {
  const { t } = useTranslation("common");
  const timeAgo = useWorkspaceTime(workspace);
  const isRunning = workspace.isRunning ?? false;
  const hasPendingApproval = workspace.hasPendingApproval ?? false;
  const hasRunningDevServer = workspace.hasRunningDevServer ?? false;
  const hasUnseenActivity = workspace.hasUnseenActivity ?? false;
  const isFailed =
    workspace.latestProcessStatus === "failed" ||
    workspace.latestProcessStatus === "killed";
  const hasLiveStatusIndicator =
    hasRunningDevServer ||
    isFailed ||
    isRunning ||
    (hasUnseenActivity && !isRunning);

  if (compact) {
    const hasStage =
      isRunning &&
      pipelineStage != null &&
      pipelineTotal != null &&
      pipelineTotal > 0;

    return (
      <div
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={(e) => {
          if (!onClick) return;
          e.stopPropagation();
          onClick();
        }}
        onMouseDown={onClick ? (e) => e.stopPropagation() : undefined}
        onKeyDown={(e) => {
          if (onClick && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            e.stopPropagation();
            onClick();
          }
        }}
        title={workspace.name ?? undefined}
        className={cn(
          "group/ws min-w-0 rounded border border-border/70 bg-secondary/45 px-2 py-1 text-xs transition-colors",
          onClick && "cursor-pointer hover:bg-secondary/80",
          className,
        )}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="flex items-center shrink-0 text-low">
            {isRunning ? (
              hasPendingApproval ? (
                <HandIcon className="size-3.5 text-brand" weight="fill" />
              ) : (
                <RunningDots />
              )
            ) : isFailed ? (
              <TriangleIcon className="size-3.5 text-error" weight="fill" />
            ) : (
              <GitBranchIcon className="size-3.5" weight="bold" />
            )}
          </span>
          <span className="h-3 w-px bg-border/80 shrink-0" aria-hidden="true" />
          <span className="min-w-[4rem] flex-1 truncate font-medium text-normal">
            {workspace.name ?? "Workspace"}
          </span>
          {(workspace.linesAdded > 0 || workspace.linesRemoved > 0) && (
            <span className="font-ibm-plex-mono text-[10px] tabular-nums shrink-0">
              <span className="text-success">+{workspace.linesAdded}</span>{" "}
              <span className="text-error">-{workspace.linesRemoved}</span>
            </span>
          )}
          {timeAgo && (
            <span
              title={timeAgo}
              className={cn(
                "max-w-[6.5rem] truncate text-[11px] text-low shrink-0",
                isFailed && "text-error",
              )}
            >
              {timeAgo}
            </span>
          )}
          {onClick && (
            <>
              <span
                className="h-3 w-px bg-border/80 shrink-0"
                aria-hidden="true"
              />
              <ArrowSquareOutIcon
                className="size-3.5 shrink-0 text-low group-hover/ws:text-high transition-colors"
                weight="bold"
              />
            </>
          )}
        </div>
        {hasStage && (
          <div className="mt-1 flex items-center gap-1.5">
            <div
              className="flex min-w-0 flex-1 items-center gap-0.5"
              role="progressbar"
              aria-label={t("cardPipeline.stagePosition", {
                defaultValue: "Stage {{n}} / {{total}}",
                n: pipelineStage,
                total: pipelineTotal,
              })}
              aria-valuemin={1}
              aria-valuemax={pipelineTotal}
              aria-valuenow={pipelineStage}
            >
              {Array.from({ length: pipelineTotal }, (_, index) => (
                <span
                  key={index}
                  className={cn(
                    "h-1 min-w-0 flex-1 rounded-full",
                    index < (pipelineStage ?? 0) ? "bg-brand" : "bg-border",
                  )}
                />
              ))}
            </div>
            <span className="shrink-0 font-ibm-plex-mono text-[10px] tabular-nums text-low">
              {t("cardPipeline.stagePosition", {
                defaultValue: "{{n}} / {{total}}",
                n: pipelineStage,
                total: pipelineTotal,
              })}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <IssueWorkspaceCardContainer onClick={onClick} className={className}>
      {/* Row 1: Status badge + Name (left), Owner avatar + menu (right) */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-half min-w-0">
          {showStatusBadge && (
            <span
              className={cn(
                "px-1.5 py-0.5 rounded text-xs font-medium shrink-0",
                workspace.archived
                  ? "bg-secondary text-low"
                  : "bg-success/10 text-success",
              )}
            >
              {workspace.archived
                ? t("workspaces.archived")
                : t("workspaces.active")}
            </span>
          )}
          {workspace.name && (
            <span className="text-sm text-high truncate">{workspace.name}</span>
          )}
        </div>

        <div className="flex items-center gap-half">
          {showOwner && workspace.owner && (
            <UserAvatar
              user={workspace.owner}
              className="h-5 w-5 text-2xs border-2 border-panel"
            />
          )}
          {(onRunIssue || onUnlink || onDelete) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="p-0.5 rounded hover:bg-secondary transition-colors"
                  aria-label={t("workspaces.more")}
                >
                  <DotsThreeIcon
                    className="size-icon-xs text-low"
                    weight="bold"
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onRunIssue && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onRunIssue();
                    }}
                  >
                    <PaperPlaneTiltIcon className="size-icon-xs" />
                    {t("workspaces.sendIssueHere")}
                  </DropdownMenuItem>
                )}
                {onUnlink && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onUnlink();
                    }}
                  >
                    <LinkBreakIcon className="size-icon-xs" />
                    {t("workspaces.unlinkFromIssue")}
                  </DropdownMenuItem>
                )}
                {onDelete && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                    className="text-destructive focus:text-destructive"
                  >
                    <TrashIcon className="size-icon-xs" />
                    {t("workspaces.deleteWorkspace")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Row 2: Live status + stats (left), PR buttons (right) */}
      <div className="flex items-center justify-between gap-half min-w-0">
        <div className="flex items-center flex-wrap sm:flex-nowrap gap-half text-sm text-low min-w-0 flex-1 overflow-hidden">
          <div className="flex items-center gap-half shrink-0">
            {hasRunningDevServer && (
              <PlayIcon
                className="size-icon-xs text-brand shrink-0"
                weight="fill"
              />
            )}

            {!isRunning && isFailed && (
              <TriangleIcon
                className="size-icon-xs text-error shrink-0"
                weight="fill"
              />
            )}

            {isRunning &&
              (hasPendingApproval ? (
                <HandIcon
                  className="size-icon-xs text-brand shrink-0"
                  weight="fill"
                />
              ) : (
                <RunningDots />
              ))}

            {hasUnseenActivity && !isRunning && !isFailed && (
              <CircleIcon
                className="size-icon-xs text-brand shrink-0"
                weight="fill"
              />
            )}
          </div>

          {hasLiveStatusIndicator && timeAgo && (
            <span className="text-low/50 shrink-0">·</span>
          )}

          {timeAgo && (
            <span
              className={cn(
                "whitespace-nowrap shrink-0",
                isFailed && "text-error",
              )}
            >
              {timeAgo}
            </span>
          )}
          {workspace.filesChanged > 0 && (
            <>
              <span className="text-low/50 shrink-0">·</span>
              <span className="whitespace-nowrap shrink-0">
                {t("workspaces.filesChanged", {
                  count: workspace.filesChanged,
                })}
              </span>
            </>
          )}
          {workspace.linesAdded > 0 && (
            <>
              <span className="text-low/50 shrink-0">·</span>
              <span className="text-success whitespace-nowrap shrink-0">
                +{workspace.linesAdded}
              </span>
            </>
          )}
          {workspace.linesRemoved > 0 && (
            <>
              <span className="text-low/50 shrink-0">·</span>
              <span className="text-error whitespace-nowrap shrink-0">
                -{workspace.linesRemoved}
              </span>
            </>
          )}
        </div>

        <div className="hidden sm:flex items-center gap-half shrink-0">
          {workspace.prs.length > 0 ? (
            workspace.prs.map((pr) => (
              <a
                key={pr.number}
                href={pr.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "flex items-center gap-half px-1.5 py-0.5 rounded text-xs font-medium transition-colors",
                  pr.status === "merged"
                    ? "bg-merged/10 text-merged hover:bg-merged/20"
                    : pr.status === "closed"
                      ? "bg-error/10 text-error hover:bg-error/20"
                      : "bg-success/10 text-success hover:bg-success/20",
                )}
              >
                <GitPullRequestIcon className="size-icon-2xs" weight="bold" />
                <span>#{pr.number}</span>
              </a>
            ))
          ) : showNoPrText ? (
            <span className="text-xs text-low whitespace-nowrap">
              {t("kanban.noPrCreated")}
            </span>
          ) : null}
        </div>
      </div>
    </IssueWorkspaceCardContainer>
  );
}

export function IssueWorkspaceCreateCard({
  onClick,
  className,
  shouldAnimateCreateButton = false,
}: IssueWorkspaceCreateCardProps) {
  const { t } = useTranslation("common");

  return (
    <IssueWorkspaceCardContainer
      className={cn("border border-dashed border-border", className)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-half min-w-0">
          <span className="px-1.5 py-0.5 rounded text-xs font-medium shrink-0 bg-secondary text-low">
            {t("workspaces.draft")}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-base">
        <span className="text-sm text-low truncate">
          {t("workspaces.newWorkspace")}
        </span>
        <button
          type="button"
          onClick={onClick}
          disabled={!onClick}
          className={cn(
            "shrink-0 rounded-sm px-base py-half text-cta h-cta flex items-center bg-brand-secondary text-on-brand hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
            shouldAnimateCreateButton && "create-issue-attention",
          )}
        >
          {t("buttons.create")}
        </button>
      </div>
    </IssueWorkspaceCardContainer>
  );
}

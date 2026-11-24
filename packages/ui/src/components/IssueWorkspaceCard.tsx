import { useEffect, useState } from "react";
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
import { PrBadge } from "./PrBadge";
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
  targetBranchName?: string | null;
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
  executor?: string | null;
  contextPercent?: number | null;
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
  flat?: boolean;
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
  flat?: boolean;
  className?: string;
  children: React.ReactNode;
}

function IssueWorkspaceCardContainer({
  onClick,
  flat = false,
  className,
  children,
}: IssueWorkspaceCardContainerProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-half transition-all duration-150",
        flat ? "px-3 py-2 bg-transparent rounded-none" : "p-base bg-panel rounded-sm",
        onClick &&
          (flat
            ? "cursor-pointer hover:bg-secondary/40"
            : "cursor-pointer hover:bg-secondary/70"),
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

function formatElapsedShort(startedAtIso?: string | null): string | null {
  if (!startedAtIso) return null;
  const startedMs = Date.parse(startedAtIso);
  if (Number.isNaN(startedMs)) return null;
  const sec = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatExecutorShort(executor?: string | null): string | null {
  if (!executor) return null;
  switch (executor.toUpperCase()) {
    case "CLAUDE_CODE":
    case "CLAUDE_CODE_HEADED":
      return "Claude Code";
    case "CODEX":
      return "Codex";
    case "OPENCODE":
    case "OPENCODE_HEADED":
      return "OpenCode";
    case "GEMINI":
      return "Gemini";
    case "CURSOR_AGENT":
      return "Cursor";
    default:
      return executor;
  }
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
  flat = false,
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
    (!flat && hasUnseenActivity && !isRunning);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isRunning || !workspace.latestProcessStartedAt) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [isRunning, workspace.latestProcessStartedAt]);

  if (compact) {
    const hasStage =
      isRunning &&
      pipelineStage != null &&
      pipelineTotal != null &&
      pipelineTotal > 0;
    const elapsedLabel = isRunning
      ? formatElapsedShort(workspace.latestProcessStartedAt)
      : null;
    const executorLabel = formatExecutorShort(workspace.executor);
    const showLiveStrip =
      isRunning &&
      Boolean(
        executorLabel || elapsedLabel || workspace.contextPercent != null,
      );

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
          "group/ws min-w-0 rounded border px-2 py-1.5 text-xs transition-colors",
          workspace.archived
            ? "border-border/60 bg-secondary/35 text-low"
            : workspace.linesAdded > 0 || workspace.linesRemoved > 0
              ? "border-emerald-500/35 bg-emerald-500/5"
              : "border-border/70 bg-secondary/45",
          onClick && "cursor-pointer hover:bg-secondary/80",
          className,
        )}
      >
        {showLiveStrip && (
          <div className="mb-1.5 flex items-center gap-1.5 rounded border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[11px] font-medium text-sky-300">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse shrink-0" />
            <span className="truncate">
              {[
                executorLabel,
                elapsedLabel ? `running ${elapsedLabel}` : "running",
                workspace.contextPercent != null
                  ? `Context ${workspace.contextPercent}%`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        )}
        {workspace.prs.length > 0 && (
          <div className="mb-1.5 flex items-center justify-between gap-2 border-b border-border/60 pb-1.5 min-w-0">
            <div className="flex items-center gap-1 min-w-0 flex-wrap">
              {workspace.prs.slice(0, 1).map((pr) => (
                <PrBadge
                  key={pr.number}
                  number={pr.number}
                  url={pr.url}
                  status={pr.status}
                  targetBranchName={pr.targetBranchName}
                />
              ))}
            </div>
            {(workspace.linesAdded > 0 || workspace.linesRemoved > 0) && (
              <span className="font-ibm-plex-mono text-[10px] tabular-nums shrink-0">
                <span className="text-success">+{workspace.linesAdded}</span>{" "}
                <span className="text-error">-{workspace.linesRemoved}</span>
              </span>
            )}
          </div>
        )}
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
              <GitBranchIcon
                className={cn(
                  "size-3.5",
                  !workspace.archived &&
                    (workspace.linesAdded > 0 || workspace.linesRemoved > 0) &&
                    "text-emerald-400",
                )}
                weight="bold"
              />
            )}
          </span>
          <span className="h-3 w-px bg-border/80 shrink-0" aria-hidden="true" />
          <span className="min-w-[4rem] flex-1 truncate font-medium text-normal">
            {workspace.archived
              ? "Workspace archived"
              : (workspace.name ?? "Workspace")}
          </span>
          {workspace.prs.length === 0 &&
            (workspace.linesAdded > 0 || workspace.linesRemoved > 0) && (
              <span className="font-ibm-plex-mono text-[10px] tabular-nums shrink-0">
                <span className="text-success">+{workspace.linesAdded}</span>{" "}
                <span className="text-error">-{workspace.linesRemoved}</span>
              </span>
            )}
          {!showLiveStrip && timeAgo && (
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
    <IssueWorkspaceCardContainer
      onClick={onClick}
      flat={flat}
      className={className}
    >
      {/* Row 1: Status badge + Name (left), Open action + Owner avatar + menu (right) */}
      <div className="flex items-center justify-between gap-2">
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

        <div className="flex items-center gap-1.5 shrink-0">
          {flat && onClick && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClick();
              }}
              className="inline-flex items-center gap-1 rounded border border-border bg-secondary/60 px-2 py-0.5 text-[11px] font-medium text-high transition-colors hover:bg-secondary shrink-0"
            >
              {t("buttons.open", { defaultValue: "Mở" })}
              <ArrowSquareOutIcon className="size-3" aria-hidden />
            </button>
          )}
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

            {!flat && hasUnseenActivity && !isRunning && !isFailed && (
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

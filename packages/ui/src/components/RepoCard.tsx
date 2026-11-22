import { useMemo, type ReactNode } from "react";
import {
  GitBranchIcon,
  GitPullRequestIcon,
  ArrowsClockwiseIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  CrosshairIcon,
  ArrowSquareOutIcon,
  GitMergeIcon,
  GitCommitIcon,
  CheckCircleIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
  DotsThreeIcon,
  LinkIcon,
  LockSimpleIcon,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuTriggerButton,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./Dropdown";
import { SplitButton, type SplitButtonOption } from "./SplitButton";

export type RepoAction =
  | "commit"
  | "pull-request"
  | "link-pr"
  | "merge"
  | "change-target"
  | "rebase"
  | "push";

const repoActionOptions: SplitButtonOption<RepoAction>[] = [
  { value: "commit", label: "Commit", icon: GitCommitIcon },
  {
    value: "pull-request",
    label: "Open PR",
    icon: GitPullRequestIcon,
  },
  { value: "link-pr", label: "Link PR", icon: LinkIcon },
];

interface RepoCardProps {
  repoId: string;
  name: string;
  targetBranch: string;
  commitsAhead?: number;
  commitsBehind?: number;
  prNumber?: number;
  prUrl?: string;
  prStatus?: "open" | "merged" | "closed" | "unknown";
  showPushButton?: boolean;
  isPushPending?: boolean;
  isPushSuccess?: boolean;
  isPushError?: boolean;
  isTargetRemote?: boolean;
  hasUncommittedChanges?: boolean;
  actionsLocked?: boolean;
  branchDropdownContent?: ReactNode;
  selectedAction?: RepoAction;
  onSelectedActionChange?: (action: RepoAction) => void;
  onChangeTarget?: () => void;
  onRebase?: () => void;
  onActionsClick?: (action: RepoAction) => void;
  onPushClick?: () => void;
  onMoreClick?: () => void;
}

export function RepoCard({
  name,
  targetBranch,
  commitsAhead = 0,
  commitsBehind = 0,
  prNumber,
  prUrl,
  prStatus,
  showPushButton = false,
  isPushPending = false,
  isPushSuccess = false,
  isPushError = false,
  isTargetRemote = false,
  hasUncommittedChanges = false,
  actionsLocked = false,
  branchDropdownContent,
  selectedAction = "pull-request",
  onSelectedActionChange,
  onChangeTarget,
  onRebase,
  onActionsClick,
  onPushClick,
  onMoreClick,
}: RepoCardProps) {
  const { t } = useTranslation("tasks");
  const { t: tCommon } = useTranslation("common");

  // Hide "Commit" when the worktree has no uncommitted changes
  // Hide "Open pull request" and "Link pull request" when PR is already open
  // Hide "Link pull request" when any PR is already linked (open or merged)
  // Hide "merge" option when PR is open, target branch is remote, or no commits ahead
  const hasPrOpen = prStatus === "open";
  const hasPrLinked = !!prNumber;
  const availableActionOptions = useMemo(
    () =>
      repoActionOptions.filter((opt) => {
        if (opt.value === "commit" && !hasUncommittedChanges) return false;
        if (opt.value === "pull-request" && hasPrOpen) return false;
        if (opt.value === "link-pr" && hasPrLinked) return false;
        if (
          opt.value === "merge" &&
          (hasPrOpen || isTargetRemote || commitsAhead === 0)
        )
          return false;
        return true;
      }),
    [
      hasUncommittedChanges,
      hasPrOpen,
      hasPrLinked,
      isTargetRemote,
      commitsAhead,
    ],
  );

  // If current selection is unavailable, fall back to the first available option.
  const effectiveSelectedAction = useMemo(() => {
    const selectedOption = availableActionOptions.find(
      (option) => option.value === selectedAction,
    );
    return (
      selectedOption?.value ??
      availableActionOptions[0]?.value ??
      selectedAction
    );
  }, [availableActionOptions, selectedAction]);

  return (
    <div className="bg-primary rounded-sm my-base p-base space-y-base">
      <div className="font-medium">{name}</div>
      {/* Branch row */}
      <div className="flex items-center gap-base">
        <div className="min-w-0 flex-1">
          <DropdownMenu>
            <DropdownMenuTriggerButton
              icon={GitBranchIcon}
              label={targetBranch}
              className="max-w-full"
            />
            <DropdownMenuContent>
              {branchDropdownContent ?? (
                <>
                  <DropdownMenuItem
                    icon={CrosshairIcon}
                    onClick={onChangeTarget}
                  >
                    {t("git.actions.changeTarget")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    icon={ArrowsClockwiseIcon}
                    onClick={onRebase}
                  >
                    {t("rebase.common.action")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Commits ahead/behind indicators */}
        {commitsAhead > 0 && (
          <span className="inline-flex items-center gap-0.5 text-xs text-success shrink-0">
            <ArrowUpIcon className="size-icon-xs" weight="bold" />
            <span className="font-medium">{commitsAhead}</span>
          </span>
        )}
        {commitsBehind > 0 && (
          <span className="inline-flex items-center gap-0.5 text-xs text-error shrink-0">
            <ArrowDownIcon className="size-icon-xs" weight="bold" />
            <span className="font-medium">{commitsBehind}</span>
          </span>
        )}

        <button
          onClick={onMoreClick}
          className="flex items-center justify-center p-1.5 rounded hover:bg-tertiary text-low hover:text-base transition-colors shrink-0"
          title={tCommon("workspaces.more")}
        >
          <DotsThreeIcon className="size-icon-base" weight="bold" />
        </button>
      </div>

      {/* PR status row */}
      {prNumber && (
        <div className="flex items-center gap-half my-base">
          {prStatus === "merged" ? (
            prUrl ? (
              <button
                onClick={() => window.open(prUrl, "_blank")}
                className="inline-flex items-center gap-half px-base py-half rounded-sm bg-panel text-success hover:bg-tertiary text-sm font-medium transition-colors"
              >
                <CheckCircleIcon className="size-icon-xs" weight="fill" />
                {t("git.pr.merged", { prNumber })}
                <ArrowSquareOutIcon className="size-icon-xs" weight="bold" />
              </button>
            ) : (
              <span className="inline-flex items-center gap-half px-base py-half rounded-sm bg-panel text-success text-sm font-medium">
                <CheckCircleIcon className="size-icon-xs" weight="fill" />
                {t("git.pr.merged", { prNumber })}
              </span>
            )
          ) : prUrl ? (
            <button
              onClick={() => window.open(prUrl, "_blank")}
              className="inline-flex items-center gap-half px-base py-half rounded-sm bg-panel text-normal hover:bg-tertiary text-sm font-medium transition-colors"
            >
              <GitPullRequestIcon className="size-icon-xs" weight="fill" />
              {t("git.pr.open", { number: prNumber })}
              <ArrowSquareOutIcon className="size-icon-xs" weight="bold" />
            </button>
          ) : (
            <span className="inline-flex items-center gap-half px-base py-half rounded-sm bg-panel text-normal text-sm font-medium">
              <GitPullRequestIcon className="size-icon-xs" weight="fill" />
              {t("git.pr.open", { number: prNumber })}
            </span>
          )}
          {/* Push button - shows loading/success/error state */}
          {(showPushButton ||
            isPushPending ||
            isPushSuccess ||
            isPushError) && (
            <button
              onClick={onPushClick}
              disabled={isPushPending || isPushSuccess || isPushError}
              className={`inline-flex items-center gap-half px-base py-half rounded-sm text-sm font-medium transition-colors disabled:cursor-not-allowed ${
                isPushSuccess
                  ? "bg-success/20 text-success"
                  : isPushError
                    ? "bg-error/20 text-error"
                    : "bg-panel text-normal hover:bg-tertiary disabled:opacity-50"
              }`}
            >
              {isPushPending ? (
                <SpinnerGapIcon className="size-icon-xs animate-spin" />
              ) : isPushSuccess ? (
                <CheckCircleIcon className="size-icon-xs" weight="fill" />
              ) : isPushError ? (
                <WarningCircleIcon className="size-icon-xs" weight="fill" />
              ) : (
                <ArrowUpIcon className="size-icon-xs" weight="bold" />
              )}
              {isPushPending
                ? t("git.states.pushing")
                : isPushSuccess
                  ? t("git.states.pushed")
                  : isPushError
                    ? t("git.states.pushFailed")
                    : t("git.states.push")}
            </button>
          )}
        </div>
      )}

      {/* Primary Merge / Push row */}
      <div className="space-y-1.5 pt-0.5">
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => onActionsClick?.("merge")}
            disabled={
              actionsLocked || hasPrOpen || isTargetRemote || commitsAhead === 0
            }
            className={`inline-flex h-8 w-full items-center justify-center gap-1.5 rounded border px-2.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              actionsLocked
                ? "border-border bg-secondary/70 text-low"
                : "border-emerald-500/40 bg-emerald-600 text-white hover:bg-emerald-500"
            }`}
          >
            {actionsLocked ? (
              <LockSimpleIcon className="size-3.5 shrink-0" weight="bold" />
            ) : (
              <GitMergeIcon className="size-3.5 shrink-0" weight="bold" />
            )}
            <span>Merge</span>
          </button>
          <button
            type="button"
            onClick={() =>
              showPushButton && onPushClick
                ? onPushClick()
                : onActionsClick?.("push")
            }
            disabled={actionsLocked || isPushPending}
            className={`inline-flex h-8 w-full items-center justify-center gap-1.5 rounded border px-2.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              actionsLocked
                ? "border-border bg-secondary/70 text-low"
                : "border-sky-500/40 bg-sky-600 text-white hover:bg-sky-500"
            }`}
          >
            {isPushPending ? (
              <SpinnerGapIcon
                className="size-3.5 shrink-0 animate-spin"
                weight="bold"
              />
            ) : actionsLocked ? (
              <LockSimpleIcon className="size-3.5 shrink-0" weight="bold" />
            ) : (
              <ArrowUpIcon className="size-3.5 shrink-0" weight="bold" />
            )}
            <span>
              {isPushPending
                ? t("git.states.pushing")
                : t("git.states.push", { defaultValue: "Push" })}
            </span>
          </button>
        </div>
        {actionsLocked && (
          <p className="text-center text-[11px] text-low">
            Duyệt revision để mở khóa Merge &amp; Push
          </p>
        )}
      </div>

      {/* Secondary Rebase + Open PR dropdown row */}
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={onRebase}
          className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded border border-border bg-panel px-2.5 text-xs font-medium text-normal transition-colors hover:bg-tertiary hover:text-high"
        >
          <ArrowsClockwiseIcon className="size-3.5 shrink-0" weight="bold" />
          <span>{t("rebase.common.action", { defaultValue: "Rebase" })}</span>
        </button>
        {availableActionOptions.length > 0 && (
          <div className="min-w-0">
            <SplitButton
              options={availableActionOptions}
              selectedValue={effectiveSelectedAction}
              onSelectionChange={(action) => onSelectedActionChange?.(action)}
              onAction={(action) => onActionsClick?.(action)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

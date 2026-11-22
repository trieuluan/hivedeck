import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CheckIcon,
  GitMergeIcon,
  LockSimpleIcon,
  PaperPlaneTiltIcon,
  ShieldCheckIcon,
  SpinnerIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@vibe/ui/components/Popover';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import { kanbanApi } from '@/shared/lib/api';
import { useBranchStatus } from '@/shared/hooks/useBranchStatus';
import { useWorkspaceRepo } from '@/shared/hooks/useWorkspaceRepo';
import { useMerge } from '@/shared/hooks/useMerge';
import { usePush } from '@/shared/hooks/usePush';
import { useRebase } from '@/shared/hooks/useRebase';
import { refreshShapeSource } from '@/shared/lib/electric/collections';
import { formatDateShortWithTime } from '@/shared/lib/date';
import { cn } from '@/shared/lib/utils';
import { PROJECT_ISSUES_SHAPE } from 'shared/remote-types';
import type { Issue } from 'shared/remote-types';

const OWNER = 'owner';

export function isRevisionApproved(issue: Issue): boolean {
  return (
    issue.approval_scope === 'revision' &&
    !!issue.approval_revision &&
    !!issue.approval_owner
  );
}

export function revisionApprovalMatchesHead(
  issue: Issue,
  headOid: string | null | undefined
): boolean {
  return (
    isRevisionApproved(issue) &&
    !!headOid &&
    issue.approval_revision === headOid
  );
}

export interface InReviewApprovalPopupProps {
  issue: Issue;
  projectId: string;
  workspaceId: string;
  branch: string;
  hasCodeChanges?: boolean;
  onApprovedWithoutChanges?: () => Promise<void> | void;
  onMerged?: () => Promise<void> | void;
}

export function InReviewApprovalPopup({
  issue,
  projectId,
  workspaceId,
  branch,
  hasCodeChanges = true,
  onApprovedWithoutChanges,
  onMerged,
}: InReviewApprovalPopupProps) {
  const { t } = useTranslation('kanban');
  const queryClient = useQueryClient();

  const { repos, selectedRepoId } = useWorkspaceRepo(workspaceId);
  const repoId = selectedRepoId ?? repos[0]?.id ?? null;
  const { data: branchStatuses } = useBranchStatus(workspaceId);
  const matchingBranchStatus = useMemo(() => {
    if (!branchStatuses || branchStatuses.length === 0) return null;
    const matching = repoId
      ? branchStatuses.find((status) => status.repo_id === repoId)
      : undefined;
    return matching ?? branchStatuses[0] ?? null;
  }, [branchStatuses, repoId]);
  const headOid = matchingBranchStatus?.head_oid ?? null;
  const commitsBehind = matchingBranchStatus?.commits_behind ?? 0;
  const targetBranchName = matchingBranchStatus?.target_branch_name ?? 'target';

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'approve' | 'merge' | 'push' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popoverId = `in-review-approval-${issue.id}`;

  useEffect(() => {
    if (!open) return;
    setError(null);
  }, [open]);

  const invalidateProject = useCallback(async () => {
    await refreshShapeSource(PROJECT_ISSUES_SHAPE, {
      project_id: projectId,
    });
    await queryClient.invalidateQueries();
  }, [projectId, queryClient]);

  const handleGitSuccess = useCallback(() => {
    setOpen(false);
    setError(null);
    void invalidateProject();
  }, [invalidateProject]);

  const handleMergeSuccess = useCallback(async () => {
    setOpen(false);
    setError(null);
    if (onMerged) {
      await onMerged();
    }
    await invalidateProject();
  }, [invalidateProject, onMerged]);

  const handleGitError = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : String(err));
  }, []);

  const mergeMutation = useMerge(
    workspaceId,
    () => void handleMergeSuccess(),
    handleGitError
  );
  const pushMutation = usePush(workspaceId, handleGitSuccess, handleGitError);
  const rebaseMutation = useRebase(
    workspaceId,
    repoId ?? undefined,
    () => {
      setError(null);
      void invalidateProject();
    },
    (err) => {
      const msg = 'message' in err && err.message ? err.message : null;
      setError(msg ?? 'Rebase thất bại.');
    }
  );

  const gitUnlocked = revisionApprovalMatchesHead(issue, headOid);
  const runningAction = mergeMutation.isPending
    ? 'merge'
    : pushMutation.isPending
      ? 'push'
      : rebaseMutation.isPending
        ? 'rebase'
        : busy;

  const approve = async () => {
    if (busy) return;
    if (hasCodeChanges && !headOid) {
      setError(
        t('review.revisionRequired', 'Chưa lấy được commit SHA hiện tại.')
      );
      return;
    }
    setBusy('approve');
    setError(null);
    try {
      await kanbanApi.approveIssue(issue.id, {
        owner: OWNER,
        scope: hasCodeChanges ? 'revision' : 'issue',
        revision: hasCodeChanges ? headOid : null,
      });
      if (!hasCodeChanges && onApprovedWithoutChanges) {
        await onApprovedWithoutChanges();
        setOpen(false);
      }
      await invalidateProject();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const confirmGit = async (action: 'merge' | 'push') => {
    if (!repoId || !headOid) return;
    const title =
      action === 'merge'
        ? t('review.mergeConfirmTitle', 'Merge branch')
        : t('review.pushConfirmTitle', 'Push branch');
    const confirmText =
      action === 'merge'
        ? t('review.merge', 'Merge')
        : t('review.push', 'Push');
    const result = await ConfirmDialog.show({
      title,
      message:
        action === 'merge'
          ? t(
              'review.mergeConfirmMessage',
              'Merge branch vào target. Hành động này sẽ không push.'
            )
          : t('review.pushConfirmMessage', 'Push branch lên remote.'),
      confirmText,
      cancelText: t('common:buttons.cancel'),
      variant: action === 'merge' ? 'merge' : 'info',
      target: {
        label: branch,
        branch: headOid,
      },
    });
    if (result !== 'confirmed') return;

    try {
      if (action === 'merge') {
        await mergeMutation.mutateAsync({ repoId });
      } else {
        await pushMutation.mutateAsync({ repo_id: repoId });
      }
    } catch (err) {
      handleGitError(err);
    }
  };

  const isApproved = hasCodeChanges
    ? gitUnlocked
    : Boolean(issue.approval_scope && issue.approval_owner);

  if (!hasCodeChanges) {
    return (
      <button
        type="button"
        disabled={runningAction !== null}
        aria-busy={runningAction === 'approve'}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          void approve();
        }}
        className={cn(
          'inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded bg-emerald-600 px-2.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500',
          'focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50'
        )}
      >
        {runningAction === 'approve' ? (
          <SpinnerIcon className="size-3.5 animate-spin" weight="bold" />
        ) : (
          <CheckIcon className="size-3.5" weight="bold" />
        )}
        {t('review.approveAndComplete', 'Duyệt & Hoàn thành')}
      </button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          className={cn(
            'inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded px-2.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand',
            isApproved
              ? 'border border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
              : 'bg-brand text-white hover:bg-brand-hover'
          )}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={popoverId}
          aria-label={t('review.openPopup', 'Owner duyệt / merge / push')}
        >
          {isApproved ? (
            <CheckIcon className="size-3.5 shrink-0" weight="bold" />
          ) : (
            <ShieldCheckIcon className="size-3.5 shrink-0" weight="bold" />
          )}
          <span>
            {isApproved
              ? t('review.approvedShort', 'Đã duyệt')
              : t('review.buttonCompact', 'Duyệt & Ship')}
          </span>
          <CaretDownIcon className="size-3 shrink-0 opacity-80" weight="bold" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        id={popoverId}
        align="end"
        sideOffset={6}
        className="z-[10001] flex w-[min(21rem,calc(100vw-2rem))] flex-col gap-2.5"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className={cn(
            'flex items-center justify-between gap-2 rounded border px-2.5 py-2 text-xs',
            gitUnlocked
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
          )}
          aria-live="polite"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {gitUnlocked ? (
              <CheckIcon
                className="size-3.5 shrink-0 text-emerald-400"
                weight="bold"
              />
            ) : (
              <ShieldCheckIcon
                className="size-3.5 shrink-0 text-amber-400"
                weight="bold"
              />
            )}
            <span className="truncate font-medium">
              {gitUnlocked
                ? t('review.approvedInline', 'Đã duyệt · {{owner}}{{time}}', {
                    owner: issue.approval_owner ?? OWNER,
                    time: issue.approval_at
                      ? ` · ${formatDateShortWithTime(issue.approval_at)}`
                      : '',
                  })
                : t('review.unapprovedStatus', 'Chưa duyệt')}
            </span>
          </div>
          {headOid && (
            <span
              title={headOid}
              className={cn(
                'rounded px-1.5 py-0.5 font-ibm-plex-mono text-[11px] shrink-0',
                gitUnlocked
                  ? 'bg-emerald-950/60 text-emerald-300'
                  : 'bg-secondary/80 text-normal'
              )}
            >
              {headOid.slice(0, 8)}
            </span>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-2 text-xs leading-relaxed text-rose-200"
          >
            <WarningIcon
              className="mr-1 inline size-3.5 shrink-0 align-[-2px]"
              weight="bold"
            />
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2">
          {!gitUnlocked && (
            <button
              type="button"
              onClick={approve}
              disabled={runningAction !== null || !headOid}
              aria-busy={runningAction === 'approve'}
              className={cn(
                'inline-flex h-8 w-full items-center justify-center gap-1.5 rounded bg-brand px-3 text-xs font-semibold text-white transition-colors hover:bg-brand-hover',
                'focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              {runningAction === 'approve' ? (
                <SpinnerIcon className="size-3.5 animate-spin" weight="bold" />
              ) : (
                <CheckIcon className="size-3.5" weight="bold" />
              )}
              {t('review.approveThisRevision', 'Duyệt revision này')}
            </button>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => void confirmGit('merge')}
              disabled={
                !gitUnlocked || !repoId || !headOid || runningAction !== null
              }
              aria-busy={runningAction === 'merge'}
              className={cn(
                'inline-flex h-8 w-full items-center justify-center gap-1.5 rounded border px-2.5 text-xs font-semibold transition-colors',
                'focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50',
                gitUnlocked
                  ? 'border-emerald-500/40 bg-emerald-600 text-white hover:bg-emerald-500'
                  : 'border-border bg-secondary/70 text-low'
              )}
            >
              {runningAction === 'merge' ? (
                <SpinnerIcon className="size-3.5 animate-spin" weight="bold" />
              ) : !gitUnlocked ? (
                <LockSimpleIcon className="size-3.5" weight="bold" />
              ) : (
                <GitMergeIcon className="size-3.5" weight="bold" />
              )}
              {t('review.merge', 'Merge')}
            </button>
            <button
              type="button"
              onClick={() => void confirmGit('push')}
              disabled={
                !gitUnlocked || !repoId || !headOid || runningAction !== null
              }
              aria-busy={runningAction === 'push'}
              className={cn(
                'inline-flex h-8 w-full items-center justify-center gap-1.5 rounded border px-2.5 text-xs font-semibold transition-colors',
                'focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50',
                gitUnlocked
                  ? 'border-sky-500/40 bg-sky-600 text-white hover:bg-sky-500'
                  : 'border-border bg-secondary/70 text-low'
              )}
            >
              {runningAction === 'push' ? (
                <SpinnerIcon className="size-3.5 animate-spin" weight="bold" />
              ) : !gitUnlocked ? (
                <LockSimpleIcon className="size-3.5" weight="bold" />
              ) : (
                <PaperPlaneTiltIcon className="size-3.5" weight="bold" />
              )}
              {t('review.push', 'Push')}
            </button>
          </div>
          {commitsBehind > 0 && repoId && (
            <button
              type="button"
              onClick={() => void rebaseMutation.mutateAsync({ repoId })}
              disabled={runningAction !== null}
              aria-busy={runningAction === 'rebase'}
              className={cn(
                'inline-flex h-8 w-full items-center justify-center gap-1.5 rounded border border-border bg-secondary/70 px-3 text-xs font-medium text-normal transition-colors hover:bg-secondary hover:text-high',
                'focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              {runningAction === 'rebase' ? (
                <SpinnerIcon className="size-3.5 animate-spin" weight="bold" />
              ) : (
                <ArrowsClockwiseIcon className="size-3.5" weight="bold" />
              )}
              {t('review.rebaseBehind', 'Rebase lên {{target}} (↓ {{count}})', {
                target: targetBranchName,
                count: commitsBehind,
              })}
            </button>
          )}
          {!gitUnlocked && (
            <p className="flex items-center justify-center gap-1 text-[11px] text-low">
              <span>
                {t(
                  'review.unlockHint',
                  'Duyệt revision để mở khóa Merge & Push'
                )}
              </span>
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

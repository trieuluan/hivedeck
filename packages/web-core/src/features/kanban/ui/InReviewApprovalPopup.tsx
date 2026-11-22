import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
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
import { kanbanApi, type ApproveIssueScope } from '@/shared/lib/api';
import { useBranchStatus } from '@/shared/hooks/useBranchStatus';
import { useWorkspaceRepo } from '@/shared/hooks/useWorkspaceRepo';
import { useMerge } from '@/shared/hooks/useMerge';
import { usePush } from '@/shared/hooks/usePush';
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
}

export function InReviewApprovalPopup({
  issue,
  projectId,
  workspaceId,
  branch,
  hasCodeChanges = true,
  onApprovedWithoutChanges,
}: InReviewApprovalPopupProps) {
  const { t } = useTranslation('kanban');
  const queryClient = useQueryClient();

  const { repos, selectedRepoId } = useWorkspaceRepo(workspaceId);
  const repoId = selectedRepoId ?? repos[0]?.id ?? null;
  const { data: branchStatuses } = useBranchStatus(workspaceId);
  const headOid = useMemo(() => {
    if (!branchStatuses || branchStatuses.length === 0) return null;
    const matching = repoId
      ? branchStatuses.find((status) => status.repo_id === repoId)
      : undefined;
    return matching?.head_oid ?? branchStatuses[0]?.head_oid ?? null;
  }, [branchStatuses, repoId]);

  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<ApproveIssueScope>(
    issue.approval_scope === 'revision' ? 'revision' : 'issue'
  );
  const [revision, setRevision] = useState(issue.approval_revision ?? '');
  const [busy, setBusy] = useState<'approve' | 'merge' | 'push' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popoverId = `in-review-approval-${issue.id}`;

  useEffect(() => {
    if (!open) return;
    setScope(issue.approval_scope === 'revision' ? 'revision' : 'issue');
    setRevision(issue.approval_revision ?? headOid ?? '');
    setError(null);
  }, [open, issue.approval_scope, issue.approval_revision, headOid]);

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

  const handleGitError = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : String(err));
  }, []);

  const mergeMutation = useMerge(workspaceId, handleGitSuccess, handleGitError);
  const pushMutation = usePush(workspaceId, handleGitSuccess, handleGitError);

  const gitUnlocked = revisionApprovalMatchesHead(issue, headOid);
  const runningAction = mergeMutation.isPending
    ? 'merge'
    : pushMutation.isPending
      ? 'push'
      : busy;

  const approve = async () => {
    if (busy) return;
    if (hasCodeChanges && scope === 'revision' && !revision.trim()) {
      setError(t('review.revisionRequired', 'Cần nhập revision SHA.'));
      return;
    }
    setBusy('approve');
    setError(null);
    try {
      await kanbanApi.approveIssue(issue.id, {
        owner: OWNER,
        scope: hasCodeChanges ? scope : 'issue',
        revision:
          hasCodeChanges && scope === 'revision' ? revision.trim() : null,
      });
      if (!hasCodeChanges && onApprovedWithoutChanges) {
        await onApprovedWithoutChanges();
      }
      await invalidateProject();
      setOpen(false);
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

  const approvedStatus = issue.approval_scope
    ? t('review.approvedStatus', 'Đã duyệt bởi {{owner}}{{time}}{{revision}}', {
        owner: issue.approval_owner ?? OWNER,
        time: issue.approval_at
          ? ` @ ${formatDateShortWithTime(issue.approval_at)}`
          : '',
        revision: issue.approval_revision
          ? ` · ${issue.approval_revision}`
          : '',
      })
    : t('review.unapprovedStatus', 'Chưa duyệt');

  const isApproved = Boolean(issue.approval_scope && issue.approval_owner);

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
        className="z-[10001] flex w-[min(21rem,calc(100vw-2rem))] flex-col gap-3"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="flex flex-col gap-1 rounded border border-border/80 bg-secondary/50 px-2.5 py-2"
          aria-live="polite"
        >
          <span className="text-[11px] font-medium uppercase tracking-wide text-low">
            {t('review.approvalStatus', 'Approval status')}
          </span>
          <span className="break-words text-xs leading-relaxed text-normal">
            {approvedStatus}
          </span>
        </div>

        {hasCodeChanges && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="sr-only">
              {t('review.approvalScope', 'Approval scope')}
            </legend>
            <div className="flex gap-2">
              <label className="inline-flex min-h-9 flex-1 cursor-pointer items-center gap-1.5 rounded border border-border bg-secondary/50 px-2.5 text-xs text-normal has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-brand">
                <input
                  type="radio"
                  name={`approval-scope-${issue.id}`}
                  value="issue"
                  checked={scope === 'issue'}
                  onChange={() => setScope('issue')}
                  className="size-3.5 accent-brand"
                />
                {t('review.scopeIssue', 'Issue')}
              </label>
              <label className="inline-flex min-h-9 flex-1 cursor-pointer items-center gap-1.5 rounded border border-border bg-secondary/50 px-2.5 text-xs text-normal has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-brand">
                <input
                  type="radio"
                  name={`approval-scope-${issue.id}`}
                  value="revision"
                  checked={scope === 'revision'}
                  onChange={() => setScope('revision')}
                  className="size-3.5 accent-brand"
                />
                {t('review.scopeRevision', 'Revision')}
              </label>
            </div>
            {scope === 'revision' && (
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-low">
                  {t('review.revisionLabel', 'Revision SHA')}
                </span>
                <input
                  value={revision}
                  onChange={(event) => setRevision(event.target.value)}
                  placeholder={headOid ?? 'commit SHA'}
                  className="min-h-9 rounded border border-border bg-panel px-2.5 font-ibm-plex-mono text-xs text-normal focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand"
                  aria-label={t('review.revisionLabel', 'Revision SHA')}
                />
              </label>
            )}
          </fieldset>
        )}

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
          <button
            type="button"
            onClick={approve}
            disabled={
              runningAction !== null ||
              (scope === 'revision' && !revision.trim())
            }
            aria-busy={runningAction === 'approve'}
            className={cn(
              'inline-flex h-8 w-full items-center justify-center gap-1.5 rounded bg-brand px-3 text-xs font-semibold text-white transition-colors hover:bg-brand-hover',
              'focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {runningAction === 'approve' ? (
              <SpinnerIcon className="size-3.5 animate-spin" weight="bold" />
            ) : (
              <ShieldCheckIcon className="size-3.5" weight="bold" />
            )}
            {t('review.approveChanges', 'Duyệt thay đổi')}
          </button>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => void confirmGit('merge')}
              disabled={
                !gitUnlocked || !repoId || !headOid || runningAction !== null
              }
              aria-busy={runningAction === 'merge'}
              className={cn(
                'inline-flex h-8 w-full items-center justify-center gap-1.5 rounded border px-2.5 text-xs font-medium transition-colors',
                'focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50',
                gitUnlocked
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                  : 'border-border bg-secondary/70 text-normal hover:bg-secondary hover:text-high'
              )}
            >
              {runningAction === 'merge' ? (
                <SpinnerIcon className="size-3.5 animate-spin" weight="bold" />
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
                'inline-flex h-8 w-full items-center justify-center gap-1.5 rounded border px-2.5 text-xs font-medium transition-colors',
                'focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50',
                gitUnlocked
                  ? 'border-sky-500/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25'
                  : 'border-border bg-secondary/70 text-normal hover:bg-secondary hover:text-high'
              )}
            >
              {runningAction === 'push' ? (
                <SpinnerIcon className="size-3.5 animate-spin" weight="bold" />
              ) : (
                <PaperPlaneTiltIcon className="size-3.5" weight="bold" />
              )}
              {t('review.push', 'Push')}
            </button>
          </div>
          {!gitUnlocked && (
            <p className="flex items-center gap-1 text-[11px] text-low">
              <LockSimpleIcon className="size-3 shrink-0" weight="bold" />
              <span>
                {t(
                  'review.unlockHint',
                  'Duyệt (Revision) trước để mở khóa Merge & Push'
                )}
              </span>
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

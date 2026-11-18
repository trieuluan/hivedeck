import { useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckIcon, GitMergeIcon, SpinnerIcon } from '@phosphor-icons/react';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import { ConfirmCheckboxDialog } from '@/shared/dialogs/shared/ConfirmCheckboxDialog';
import { workspacesApi } from '@/shared/lib/api';

export type InReviewAction = 'merge' | 'accept';

export function resolveInReviewAction(
  filesChanged: number | undefined
): InReviewAction | null {
  if (filesChanged === undefined) return null;
  return filesChanged > 0 ? 'merge' : 'accept';
}

export interface AcceptFindingsButtonProps {
  /** Moves the card to Done without running git merge. */
  onAccept: () => void;
}

export function AcceptFindingsButton({ onAccept }: AcceptFindingsButtonProps) {
  const { t } = useTranslation('tasks');

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onAccept();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 rounded-sm border border-brand/60 bg-brand/10 px-2 py-0.5 text-xs font-medium text-high hover:bg-brand/20"
    >
      <CheckIcon className="size-3.5" weight="bold" />
      {t('ship.acceptFindings')}
    </button>
  );
}

export interface ShipIssueButtonProps {
  /** Local workspace (attempt) whose changes get merged. */
  workspaceId: string;
  /** Pinned workspaces are kept instead of deleted after merge. */
  isPinned?: boolean;
  /** Moves the card to Done once the merge succeeded. */
  onShipped: () => void;
  /** Opens the workspace (to resolve conflicts with the agent). */
  onOpenWorkspace: () => void;
  /** Called when the workspace was deleted during ship. */
  onCleanup?: () => void;
}

/**
 * The "Merge" button on an In Review card: commit leftovers, rebase if
 * behind, merge into the target branch, push, archive the workspace and move
 * the card to Done. Conflicts stop it and point at the workspace.
 */
export function ShipIssueButton({
  workspaceId,
  isPinned = false,
  onShipped,
  onOpenWorkspace,
  onCleanup,
}: ShipIssueButtonProps) {
  const { t } = useTranslation('tasks');
  const [busy, setBusy] = useState(false);

  const ship = async (e: MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    const confirmation = await ConfirmCheckboxDialog.show({
      title: t('ship.confirmTitle'),
      message: t('ship.confirmMessage'),
      confirmText: t('ship.confirm'),
      cancelText: t('common:buttons.cancel'),
      checkboxLabel: t('ship.cleanupWorkspaceLabel'),
      checkboxDefaultChecked: !isPinned,
      checkboxDisabled: isPinned,
      checkboxHint: isPinned ? t('ship.pinnedWorkspaceKept') : undefined,
    });
    if (confirmation.action !== 'confirmed') return;

    const shouldCleanup = !isPinned && confirmation.checked;

    setBusy(true);
    try {
      const result = await workspacesApi.ship(workspaceId, {
        push: true,
        cleanup: shouldCleanup,
      });
      if (!result.success) {
        if (result.error?.type === 'merge_conflicts') {
          const open = await ConfirmDialog.show({
            title: t('ship.conflictsTitle'),
            message: t('ship.conflictsMessage', {
              count: result.error.conflicted_files.length,
              branch: result.error.target_branch,
            }),
            confirmText: t('ship.openWorkspace'),
            cancelText: t('common:buttons.close'),
            variant: 'destructive',
          });
          if (open === 'confirmed') onOpenWorkspace();
          return;
        }
        await ConfirmDialog.show({
          title: t('ship.failedTitle'),
          message:
            result.error?.type === 'rebase_in_progress'
              ? t('ship.rebaseInProgress')
              : (result.message ?? t('ship.failedTitle')),
          confirmText: t('common:ok'),
          showCancelButton: false,
          variant: 'destructive',
        });
        return;
      }

      onShipped();
      if (shouldCleanup) {
        onCleanup?.();
      }
      if (result.data.push_error) {
        await ConfirmDialog.show({
          title: t('ship.pushFailedTitle'),
          message: t('ship.pushFailedMessage', {
            error: result.data.push_error,
          }),
          confirmText: t('common:ok'),
          showCancelButton: false,
          variant: 'info',
        });
      }
    } catch (err) {
      await ConfirmDialog.show({
        title: t('ship.failedTitle'),
        message: err instanceof Error ? err.message : String(err),
        confirmText: t('common:ok'),
        showCancelButton: false,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={ship}
      onPointerDown={(e) => e.stopPropagation()}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-sm border border-brand/60 bg-brand/10 px-2 py-0.5 text-xs font-medium text-high hover:bg-brand/20 disabled:opacity-60"
    >
      {busy ? (
        <SpinnerIcon className="size-3.5 animate-spin" />
      ) : (
        <GitMergeIcon className="size-3.5" weight="bold" />
      )}
      {busy ? t('ship.merging') : t('ship.button')}
    </button>
  );
}

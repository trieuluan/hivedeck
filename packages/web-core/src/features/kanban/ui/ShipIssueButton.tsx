import { useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { GitMergeIcon, SpinnerIcon } from '@phosphor-icons/react';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import { workspacesApi } from '@/shared/lib/api';

export interface ShipIssueButtonProps {
  /** Local workspace (attempt) whose changes get merged. */
  workspaceId: string;
  /** Moves the card to Done once the merge succeeded. */
  onShipped: () => void;
  /** Opens the workspace (to resolve conflicts with the agent). */
  onOpenWorkspace: () => void;
}

/**
 * The "Merge" button on an In Review card: commit leftovers, rebase if
 * behind, merge into the target branch, push, archive the workspace and move
 * the card to Done. Conflicts stop it and point at the workspace.
 */
export function ShipIssueButton({
  workspaceId,
  onShipped,
  onOpenWorkspace,
}: ShipIssueButtonProps) {
  const { t } = useTranslation('tasks');
  const [busy, setBusy] = useState(false);

  const ship = async (e: MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    const confirmed = await ConfirmDialog.show({
      title: t('ship.confirmTitle'),
      message: t('ship.confirmMessage'),
      confirmText: t('ship.confirm'),
      cancelText: t('common:buttons.cancel'),
    });
    if (confirmed !== 'confirmed') return;

    setBusy(true);
    try {
      const result = await workspacesApi.ship(workspaceId, { push: true });
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

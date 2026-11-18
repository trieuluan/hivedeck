import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@vibe/ui/components/KeyboardDialog';
import { Button } from '@vibe/ui/components/Button';
import { Checkbox } from '@vibe/ui/components/Checkbox';
import { create, useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/shared/lib/modals';

export interface CancelIssueDialogProps {
  /** e.g. "HIVE-3" or "3 cards". */
  subject: string;
  /** Number of non-pinned workspaces linked to the card(s). */
  cleanableWorkspaceCount?: number;
}

/** `null` when the owner backs out; otherwise the (possibly empty) reason. */
export type CancelIssueResult = {
  reason: string;
  deleteWorkspaces: boolean;
} | null;

const CancelIssueDialogImpl = create<CancelIssueDialogProps>(
  ({ subject, cleanableWorkspaceCount = 0 }) => {
    const modal = useModal();
    const { t } = useTranslation('common');
    const [reason, setReason] = useState('');
    const [deleteWorkspaces, setDeleteWorkspaces] = useState(
      cleanableWorkspaceCount > 0
    );

    const close = (result: CancelIssueResult) => {
      modal.resolve(result);
      modal.hide();
    };

    return (
      <Dialog open={modal.visible} onOpenChange={() => close(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{t('cancelIssue.title', { subject })}</DialogTitle>
            <DialogDescription className="text-left pt-1">
              {t('cancelIssue.body')}
            </DialogDescription>
          </DialogHeader>
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                close({
                  reason: reason.trim(),
                  deleteWorkspaces:
                    cleanableWorkspaceCount > 0 && deleteWorkspaces,
                });
              }
            }}
            rows={3}
            placeholder={t('cancelIssue.reasonPlaceholder')}
            aria-label={t('cancelIssue.reasonLabel')}
            className="w-full resize-none rounded-md border border-border bg-secondary px-3 py-2 text-sm text-normal placeholder:text-low focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
          {cleanableWorkspaceCount > 0 && (
            <label className="flex items-center gap-2.5 text-sm font-medium cursor-pointer select-none">
              <Checkbox
                checked={deleteWorkspaces}
                onCheckedChange={setDeleteWorkspaces}
              />
              <span>
                {t('cancelIssue.deleteWorkspacesLabel', {
                  count: cleanableWorkspaceCount,
                })}
              </span>
            </label>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => close(null)}>
              {t('cancelIssue.keep')}
            </Button>
            <Button
              onClick={() =>
                close({
                  reason: reason.trim(),
                  deleteWorkspaces:
                    cleanableWorkspaceCount > 0 && deleteWorkspaces,
                })
              }
            >
              {t('cancelIssue.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

export const CancelIssueDialog = defineModal<
  CancelIssueDialogProps,
  CancelIssueResult
>(CancelIssueDialogImpl);

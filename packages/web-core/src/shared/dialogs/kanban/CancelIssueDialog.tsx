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
import { create, useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/shared/lib/modals';

export interface CancelIssueDialogProps {
  /** e.g. "HIVE-3" or "3 cards". */
  subject: string;
}

/** `null` when the owner backs out; otherwise the (possibly empty) reason. */
export type CancelIssueResult = { reason: string } | null;

const CancelIssueDialogImpl = create<CancelIssueDialogProps>(({ subject }) => {
  const modal = useModal();
  const { t } = useTranslation('common');
  const [reason, setReason] = useState('');

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
              close({ reason: reason.trim() });
            }
          }}
          rows={3}
          placeholder={t('cancelIssue.reasonPlaceholder')}
          aria-label={t('cancelIssue.reasonLabel')}
          className="w-full resize-none rounded-md border border-border bg-secondary px-3 py-2 text-sm text-normal placeholder:text-low focus:outline-none focus:ring-2 focus:ring-brand/40"
        />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => close(null)}>
            {t('cancelIssue.keep')}
          </Button>
          <Button onClick={() => close({ reason: reason.trim() })}>
            {t('cancelIssue.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

export const CancelIssueDialog = defineModal<
  CancelIssueDialogProps,
  CancelIssueResult
>(CancelIssueDialogImpl);

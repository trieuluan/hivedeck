import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@vibe/ui/components/KeyboardDialog';
import { create, useModal } from '@ebay/nice-modal-react';
import {
  WarningIcon,
  InfoIcon,
  CheckCircleIcon,
  XCircleIcon,
  GitBranchIcon,
} from '@phosphor-icons/react';
import { cn } from '@/shared/lib/utils';
import { defineModal, type ConfirmResult } from '@/shared/lib/modals';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'destructive' | 'info' | 'success';
  icon?: boolean;
  target?: {
    label: string;
    branch?: string | null;
  };
}

const ConfirmDialogImpl = create<ConfirmDialogProps>((props) => {
  const modal = useModal();
  const {
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'default',
    icon = true,
    target,
  } = props;

  const handleConfirm = () => {
    modal.resolve('confirmed' as ConfirmResult);
  };

  const handleCancel = () => {
    modal.resolve('canceled' as ConfirmResult);
  };

  const getIconBadge = () => {
    if (!icon) return null;

    const badgeStyle =
      variant === 'destructive'
        ? 'bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/35 shadow-[0_0_20px_-4px_rgba(244,63,94,0.35)]'
        : variant === 'info'
          ? 'bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/35'
          : variant === 'success'
            ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/35'
            : 'bg-secondary text-normal ring-1 ring-border';

    const IconComponent =
      variant === 'destructive'
        ? WarningIcon
        : variant === 'info'
          ? InfoIcon
          : variant === 'success'
            ? CheckCircleIcon
            : XCircleIcon;

    return (
      <div
        className={cn(
          'mx-auto flex h-12 w-12 items-center justify-center rounded-full',
          badgeStyle
        )}
      >
        <IconComponent className="size-6" weight="duotone" />
      </div>
    );
  };

  const confirmBtnClass =
    variant === 'destructive'
      ? 'bg-rose-600 text-white hover:bg-rose-500'
      : 'bg-brand text-white hover:bg-brand-hover';

  return (
    <Dialog
      open={modal.visible}
      onOpenChange={handleCancel}
      hideCloseButton
      style={{ maxWidth: 420 }}
      className="rounded-2xl p-6"
    >
      <DialogContent className="w-full gap-4">
        <DialogHeader className="w-full items-center space-y-3 text-center sm:text-center">
          {getIconBadge()}
          <DialogTitle className="text-base font-semibold leading-snug text-high">
            {title}
          </DialogTitle>
          {target && (
            <div className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border/80 bg-secondary/60 px-3 py-1.5 text-xs text-normal">
              <GitBranchIcon
                className="size-3.5 shrink-0 text-low"
                weight="bold"
              />
              <span className="truncate font-medium text-high">
                {target.label}
              </span>
              {target.branch && (
                <span className="truncate font-ibm-plex-mono text-[11px] text-low">
                  · {target.branch}
                </span>
              )}
            </div>
          )}
          <DialogDescription className="mx-auto max-w-[330px] text-center text-xs leading-relaxed text-low whitespace-pre-line">
            {message}
          </DialogDescription>
        </DialogHeader>

        <div className="grid w-full grid-cols-2 gap-2.5 pt-1">
          <button
            type="button"
            onClick={handleCancel}
            className="w-full rounded-lg border border-border bg-secondary/70 px-4 py-2 text-xs font-medium text-normal transition-colors hover:bg-secondary hover:text-high"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={cn(
              'w-full rounded-lg px-4 py-2 text-xs font-semibold transition-colors',
              confirmBtnClass
            )}
          >
            {confirmText}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
});

export const ConfirmDialog = defineModal<ConfirmDialogProps, ConfirmResult>(
  ConfirmDialogImpl
);

import { useEffect, useState } from 'react';
import { create, useModal } from '@ebay/nice-modal-react';
import {
  WarningIcon,
  InfoIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
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
import { defineModal } from '@/shared/lib/modals';

export interface ConfirmCheckboxDialogProps {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'destructive' | 'info' | 'success';
  checkboxLabel: string;
  checkboxDefaultChecked?: boolean;
  checkboxDisabled?: boolean;
  checkboxHint?: string;
}

export type ConfirmCheckboxDialogResult = {
  action: 'confirmed' | 'canceled';
  checked: boolean;
};

const ConfirmCheckboxDialogImpl = create<ConfirmCheckboxDialogProps>(
  ({
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'default',
    checkboxLabel,
    checkboxDefaultChecked = false,
    checkboxDisabled = false,
    checkboxHint,
  }) => {
    const modal = useModal();
    const [checked, setChecked] = useState(
      checkboxDisabled ? false : checkboxDefaultChecked
    );

    useEffect(() => {
      setChecked(checkboxDisabled ? false : checkboxDefaultChecked);
    }, [checkboxDefaultChecked, checkboxDisabled, modal.visible]);

    const handleConfirm = () => {
      modal.resolve({
        action: 'confirmed',
        checked: !checkboxDisabled && checked,
      });
      modal.hide();
    };

    const handleCancel = () => {
      modal.resolve({ action: 'canceled', checked: false });
      modal.hide();
    };

    const icon = (() => {
      const cls = 'h-6 w-6 shrink-0';
      switch (variant) {
        case 'destructive':
          return <WarningIcon className={`${cls} text-destructive`} />;
        case 'info':
          return <InfoIcon className={`${cls} text-blue-500`} />;
        case 'success':
          return <CheckCircleIcon className={`${cls} text-green-500`} />;
        default:
          return <XCircleIcon className={`${cls} text-muted-foreground`} />;
      }
    })();

    return (
      <Dialog open={modal.visible} onOpenChange={handleCancel}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <div className="flex items-center gap-3">
              {icon}
              <DialogTitle>{title}</DialogTitle>
            </div>
            <DialogDescription className="text-left pt-2">
              {message}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-1.5">
            <label
              className={`flex items-center gap-2.5 text-sm font-medium select-none ${
                checkboxDisabled
                  ? 'text-muted-foreground cursor-not-allowed'
                  : 'cursor-pointer'
              }`}
            >
              <Checkbox
                checked={checked}
                disabled={checkboxDisabled}
                onCheckedChange={setChecked}
              />
              <span>{checkboxLabel}</span>
            </label>
            {checkboxHint && (
              <p className="text-xs text-muted-foreground pl-6.5">
                {checkboxHint}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleCancel}>
              {cancelText}
            </Button>
            <Button
              variant={variant === 'destructive' ? 'destructive' : 'default'}
              onClick={handleConfirm}
            >
              {confirmText}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

export const ConfirmCheckboxDialog = defineModal<
  ConfirmCheckboxDialogProps,
  ConfirmCheckboxDialogResult
>(ConfirmCheckboxDialogImpl);

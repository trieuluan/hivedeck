import { useTranslation } from 'react-i18next';
import * as React from 'react';
import { X } from 'lucide-react';
import { useHotkeys, useHotkeysContext } from 'react-hotkeys-hook';
import * as DialogPrimitive from '@radix-ui/react-dialog';

import { cn } from '../lib/cn';

const DIALOG_SCOPE = 'dialog';
const KANBAN_SCOPE = 'kanban';
const PROJECTS_SCOPE = 'projects';

function assignRef<T>(ref: React.ForwardedRef<T>, value: T | null) {
  if (typeof ref === 'function') {
    ref(value);
    return;
  }
  if (ref) {
    ref.current = value;
  }
}

const Dialog = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    uncloseable?: boolean;
  }
>(({ className, open, onOpenChange, children, uncloseable, ...props }, ref) => {
  const { t } = useTranslation();
  const { enableScope, disableScope } = useHotkeysContext();
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLElement | null>(null);
  const wasOpenRef = React.useRef(false);
  if (open && !wasOpenRef.current) {
    triggerRef.current = document.activeElement as HTMLElement | null;
  }
  wasOpenRef.current = !!open;

  const setDialogRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      dialogRef.current = node;
      assignRef(ref, node);
    },
    [ref]
  );

  // Manage dialog scope when open/closed
  React.useEffect(() => {
    if (open) {
      enableScope(DIALOG_SCOPE);
      disableScope(KANBAN_SCOPE);
      disableScope(PROJECTS_SCOPE);
    } else {
      disableScope(DIALOG_SCOPE);
      enableScope(KANBAN_SCOPE);
      enableScope(PROJECTS_SCOPE);
    }
    return () => {
      disableScope(DIALOG_SCOPE);
      enableScope(KANBAN_SCOPE);
      enableScope(PROJECTS_SCOPE);
    };
  }, [open, enableScope, disableScope]);

  useHotkeys(
    'enter',
    (e) => {
      if (!open) return;

      const activeElement = document.activeElement as HTMLElement;
      if (activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      const container = dialogRef.current;
      if (!container) {
        return;
      }

      const submitButton = container.querySelector(
        'button[type="submit"]'
      ) as HTMLButtonElement | null;
      if (submitButton && !submitButton.disabled) {
        e?.preventDefault();
        submitButton.click();
        return;
      }

      const buttons = Array.from(
        container.querySelectorAll('button')
      ) as HTMLButtonElement[];
      const primaryButton = buttons.find(
        (btn) =>
          !btn.disabled &&
          !btn.textContent?.toLowerCase().includes('cancel') &&
          !btn.textContent?.toLowerCase().includes('close') &&
          btn.type !== 'button'
      );

      if (primaryButton) {
        e?.preventDefault();
        primaryButton.click();
      }
    },
    {
      enabled: !!open,
      scopes: [DIALOG_SCOPE],
    },
    [open]
  );

  if (!open) return null;

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(next) => {
        if (!next && !uncloseable) onOpenChange?.(false);
      }}
    >
      <DialogPrimitive.Portal>
        <div className="fixed inset-0 z-[10000] flex items-start justify-center p-4 overflow-y-auto">
          <DialogPrimitive.Overlay
            data-tauri-drag-region
            className="fixed inset-0 bg-black/50"
          />
          <DialogPrimitive.Content
            ref={setDialogRef}
            aria-modal="true"
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              triggerRef.current?.focus();
            }}
            onEscapeKeyDown={(event) => {
              if (uncloseable) event.preventDefault();
            }}
            className={cn(
              'relative z-[10000] flex flex-col w-full max-w-xl gap-4 bg-overlay border border-border rounded-lg p-6 shadow-xl duration-200 my-8 focus:outline-none',
              className
            )}
            {...props}
          >
            {!uncloseable && (
              <button
                className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 z-10"
                onClick={() => onOpenChange?.(false)}
              >
                <X className="h-4 w-4" />
                <span className="sr-only">{t('common:ui.close')}</span>
              </button>
            )}
            {children}
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
});
Dialog.displayName = 'Dialog';

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col space-y-1.5 text-center sm:text-left',
      className
    )}
    {...props}
  />
);
DialogHeader.displayName = 'DialogHeader';

const DialogTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'text-xl font-semibold leading-tight tracking-tight',
      className
    )}
    {...props}
  />
));
DialogTitle.displayName = 'DialogTitle';

const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-muted', className)} {...props} />
));
DialogDescription.displayName = 'DialogDescription';

const DialogContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex flex-col gap-4', className)} {...props} />
));
DialogContent.displayName = 'DialogContent';

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:space-x-2',
      className
    )}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
};

import { useState } from 'react';
import { Button } from '@vibe/ui/components/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@vibe/ui/components/KeyboardDialog';
import { Alert, AlertDescription } from '@vibe/ui/components/Alert';
import { Loader2 } from 'lucide-react';
import { create, useModal } from '@ebay/nice-modal-react';
import { useTranslation } from 'react-i18next';
import { defineModal } from '@/shared/lib/modals';

export interface DeleteRemoteProjectDialogProps {
  projectName: string;
  /** Number of child boards; deletion is refused while any exist. */
  childBoardCount?: number;
  /** Performs the deletion; a rejection is shown in the dialog. */
  onConfirm?: () => Promise<void>;
}

export type DeleteRemoteProjectResult = 'deleted' | 'canceled';

const DeleteRemoteProjectDialogImpl = create<DeleteRemoteProjectDialogProps>(
  ({ projectName, childBoardCount = 0, onConfirm }) => {
    const modal = useModal();
    const { t } = useTranslation(['projects', 'common']);
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleDelete = async () => {
      setIsDeleting(true);
      setError(null);

      try {
        await onConfirm?.();
        modal.resolve('deleted' as DeleteRemoteProjectResult);
        modal.hide();
      } catch (e) {
        setError(
          e instanceof Error && e.message
            ? e.message
            : t(
                'deleteProjectDialog.error',
                'Failed to delete project. Please try again.'
              )
        );
      } finally {
        setIsDeleting(false);
      }
    };

    const handleCancel = () => {
      modal.resolve('canceled' as DeleteRemoteProjectResult);
      modal.hide();
    };

    const handleOpenChange = (open: boolean) => {
      if (!open) {
        handleCancel();
      }
    };

    return (
      <Dialog open={modal.visible} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t('deleteProjectDialog.title', 'Delete Project?')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'deleteProjectDialog.description',
                'This will permanently delete "{{name}}" and all its issues. This action cannot be undone.',
                { name: projectName }
              )}
            </DialogDescription>
          </DialogHeader>

          {childBoardCount > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                {t(
                  'deleteProjectDialog.hasChildren',
                  'This project has {{count}} board(s). Delete those first.',
                  { count: childBoardCount }
                )}
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={isDeleting}
            >
              {t('common:buttons.cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting || childBoardCount > 0}
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('common:buttons.delete', 'Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

export const DeleteRemoteProjectDialog = defineModal<
  DeleteRemoteProjectDialogProps,
  DeleteRemoteProjectResult
>(DeleteRemoteProjectDialogImpl);

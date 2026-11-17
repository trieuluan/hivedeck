import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { Button } from '@vibe/ui/components/Button';
import { Input } from '@vibe/ui/components/Input';
import { Label } from '@vibe/ui/components/Label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@vibe/ui/components/KeyboardDialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@vibe/ui/components/Select';
import { Alert, AlertDescription } from '@vibe/ui/components/Alert';
import { create, useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/shared/lib/modals';

export interface CreateConfigurationDialogProps {
  executorType: string;
  existingConfigs: string[];
}

export type CreateConfigurationResult = {
  action: 'created' | 'canceled';
  configName?: string;
  cloneFrom?: string | null;
};

const CreateConfigurationDialogImpl = create<CreateConfigurationDialogProps>(
  ({ executorType, existingConfigs }) => {
    const { t } = useTranslation();
    const modal = useModal();
    const [configName, setConfigName] = useState('');
    const [cloneFrom, setCloneFrom] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      // Reset form when dialog opens
      if (modal.visible) {
        setConfigName('');
        setCloneFrom(null);
        setError(null);
      }
    }, [modal.visible]);

    const validateConfigName = (name: string): string | null => {
      const trimmedName = name.trim();
      if (!trimmedName) return 'Configuration name cannot be empty';
      if (trimmedName.length > 40)
        return 'Configuration name must be 40 characters or less';
      if (!/^[a-zA-Z0-9_-]+$/.test(trimmedName)) {
        return 'Configuration name can only contain letters, numbers, underscores, and hyphens';
      }
      if (existingConfigs.includes(trimmedName)) {
        return 'A configuration with this name already exists';
      }
      return null;
    };

    const handleCreate = () => {
      const validationError = validateConfigName(configName);
      if (validationError) {
        setError(validationError);
        return;
      }

      modal.resolve({
        action: 'created',
        configName: configName.trim(),
        cloneFrom,
      } as CreateConfigurationResult);
      modal.hide();
    };

    const handleCancel = () => {
      modal.resolve({ action: 'canceled' } as CreateConfigurationResult);
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
            <DialogTitle>{t('common:ui.createNewConfiguration')}</DialogTitle>
            <DialogDescription>
              {t('common:ui.addANewConfigurationForThe')} {executorType}{' '}
              executor.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="config-name">
                {t('common:ui.configurationName')}
              </Label>
              <Input
                id="config-name"
                value={configName}
                onChange={(e) => {
                  setConfigName(e.target.value);
                  setError(null);
                }}
                placeholder={t('common:ui.eGProductionDevelopment')}
                maxLength={40}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="clone-from">
                {t('common:ui.cloneFromOptional')}
              </Label>
              <Select
                value={cloneFrom || '__blank__'}
                onValueChange={(value) =>
                  setCloneFrom(value === '__blank__' ? null : value)
                }
              >
                <SelectTrigger id="clone-from">
                  <SelectValue
                    placeholder={t('common:ui.startBlankOrCloneExisting')}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__blank__">
                    {t('common:ui.startBlank')}
                  </SelectItem>
                  {existingConfigs.map((configuration) => (
                    <SelectItem key={configuration} value={configuration}>
                      {t('common:ui.cloneFrom')} {configuration}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCancel}>
              {t('common:ui.cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={!configName.trim()}>
              {t('common:ui.createConfiguration')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

export const CreateConfigurationDialog = defineModal<
  CreateConfigurationDialogProps,
  CreateConfigurationResult
>(CreateConfigurationDialogImpl);

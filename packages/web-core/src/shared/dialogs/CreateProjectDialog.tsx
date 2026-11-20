import { useState, useEffect, useMemo } from 'react';
import { FolderIcon, GitBranchIcon } from '@phosphor-icons/react';
import { Input } from '@vibe/ui/components/Input';
import { Label } from '@vibe/ui/components/Label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@vibe/ui/components/KeyboardDialog';
import { Alert, AlertDescription } from '@vibe/ui/components/Alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@vibe/ui/components/Select';
import { useQuery } from '@tanstack/react-query';
import { projectsApi, repoApi } from '@/shared/lib/api';
import { create, useModal } from '@ebay/nice-modal-react';
import { useTranslation } from 'react-i18next';
import { defineModal } from '@/shared/lib/modals';
import { useShape } from '@/shared/integrations/electric/hooks';
import {
  PROJECTS_SHAPE,
  PROJECT_MUTATION,
  type Project,
} from 'shared/remote-types';
import { getRandomPresetColor, PRESET_COLORS } from '@/shared/lib/colors';
import { ColorPicker } from '@/shared/components/ui-new/containers/ColorPickerContainer';

export type CreateProjectDialogProps = {
  /** ADR-015: when set, the new project is created as a child board of the
   * given parent id (parent_id = parentId). Omit for a top-level project. */
  parentId?: string;
};

export type CreateProjectResult = {
  action: 'created' | 'canceled';
  project?: Project;
};

const CreateProjectDialogImpl = create<CreateProjectDialogProps>(
  ({ parentId }) => {
    const modal = useModal();
    const { t } = useTranslation('projects');
    const [name, setName] = useState('');
    const [color, setColor] = useState<string>(() => getRandomPresetColor());
    const [error, setError] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    // ADR-032: a top-level project works in one repo; its captain dispatches
    // there. Child boards inherit the parent's.
    const NO_REPO = '__later__';
    const [repoId, setRepoId] = useState<string>(NO_REPO);
    const { data: repos = [] } = useQuery({
      queryKey: ['repos', 'list'],
      queryFn: () => repoApi.list(),
      enabled: modal.visible && !parentId,
    });

    // ADR-018 — projects are tenant-less; subscribe PROJECTS_SHAPE with
    // empty params (single global cache key).
    const params = useMemo(() => ({}), []);

    const { insert, error: syncError } = useShape(PROJECTS_SHAPE, params, {
      mutation: PROJECT_MUTATION,
    });

    useEffect(() => {
      // Reset form when dialog opens
      if (modal.visible) {
        setName('');
        setColor(getRandomPresetColor());
        setError(null);
        setIsCreating(false);
        setRepoId(NO_REPO);
      }
    }, [modal.visible]);

    useEffect(() => {
      if (syncError) {
        setError(syncError.message || 'Failed to create project');
        setIsCreating(false);
      }
    }, [syncError]);

    const validateName = (value: string): string | null => {
      const trimmedValue = value.trim();
      if (!trimmedValue) return 'Project name is required';
      if (trimmedValue.length < 2)
        return 'Project name must be at least 2 characters';
      if (trimmedValue.length > 100)
        return 'Project name must be 100 characters or less';
      return null;
    };

    const handleCreate = async () => {
      const nameError = validateName(name);
      if (nameError) {
        setError(nameError);
        return;
      }

      setError(null);
      setIsCreating(true);

      try {
        const { data: project, persisted } = insert({
          name: name.trim(),
          color: color,
          ...(parentId ? { parent_id: parentId } : {}),
        });

        const persistedProject = await persisted;
        const createdId = (persistedProject ?? project)?.id;
        if (!parentId && repoId !== NO_REPO && createdId) {
          await projectsApi.linkRepo(createdId, repoId);
        }

        modal.resolve({
          action: 'created',
          project: persistedProject ?? project,
        } as CreateProjectResult);
        modal.hide();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to create project'
        );
        setIsCreating(false);
      }
    };

    const handleCancel = () => {
      modal.resolve({ action: 'canceled' } as CreateProjectResult);
      modal.hide();
    };

    const handleOpenChange = (open: boolean) => {
      if (isCreating) return;

      if (!open) {
        handleCancel();
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && name.trim() && !isCreating) {
        e.preventDefault();
        void handleCreate();
      }
    };

    return (
      <Dialog
        open={modal.visible}
        onOpenChange={handleOpenChange}
        hideCloseButton
        style={{ maxWidth: 420 }}
        className="rounded-2xl p-6"
      >
        <DialogContent className="w-full gap-5">
          <DialogHeader className="w-full items-center space-y-2.5 text-center sm:text-center">
            <div
              className="mx-auto flex h-12 w-12 items-center justify-center rounded-full transition-colors"
              style={{
                backgroundColor: `hsl(${color} / 0.14)`,
                color: `hsl(${color})`,
                boxShadow: `inset 0 0 0 1px hsl(${color} / 0.35), 0 0 22px -4px hsl(${color} / 0.38)`,
              }}
            >
              <FolderIcon className="size-6" weight="duotone" />
            </div>
            <DialogTitle className="text-base font-semibold leading-snug text-high">
              {parentId
                ? t('createProjectDialog.titleChildBoard', 'Create child board')
                : t('createProjectDialog.title', 'Create new project')}
            </DialogTitle>
            <DialogDescription className="mx-auto max-w-[330px] text-center text-xs leading-relaxed text-low">
              {parentId
                ? t(
                    'createProjectDialog.descriptionChildBoard',
                    'Create a new child board under this project.'
                  )
                : t(
                    'createProjectDialog.description',
                    'Set up a name, accent color, and repository.'
                  )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label
                htmlFor="project-name"
                className="text-xs font-medium text-normal"
              >
                {t('createProjectDialog.nameLabel', 'Project name')}
              </Label>
              <div className="relative">
                <Input
                  id="project-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={t(
                    'createProjectDialog.namePlaceholder',
                    'Enter project name...'
                  )}
                  maxLength={100}
                  autoFocus
                  disabled={isCreating}
                  className="h-10 rounded-xl border-border/80 bg-secondary/40 pl-3.5 pr-11 text-sm"
                />
                <ColorPicker
                  value={color}
                  onChange={setColor}
                  colors={PRESET_COLORS}
                  disabled={isCreating}
                  align="end"
                  side="bottom"
                >
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 cursor-pointer rounded-full ring-1 ring-white/20 transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ backgroundColor: `hsl(${color})` }}
                    disabled={isCreating}
                    aria-label={t(
                      'createProjectDialog.selectColor',
                      'Select project color'
                    )}
                    title={t(
                      'createProjectDialog.selectColor',
                      'Select project color'
                    )}
                  />
                </ColorPicker>
              </div>
            </div>

            {!parentId && (
              <Select
                value={repoId}
                onValueChange={setRepoId}
                disabled={isCreating}
              >
                <SelectTrigger
                  id="project-repo"
                  className="h-auto w-full rounded-xl border border-border/80 bg-secondary/40 px-3.5 py-2.5 text-left transition-colors hover:bg-secondary/60"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-normal ring-1 ring-border/70">
                      <GitBranchIcon className="size-4" weight="bold" />
                    </div>
                    <div className="min-w-0 text-left">
                      <div className="text-xs font-semibold text-high">
                        {t('createProjectDialog.repoLabel', 'Repository')}
                      </div>
                      <span className="block truncate text-xs text-normal">
                        <SelectValue />
                      </span>
                      <div className="mt-0.5 truncate text-[11px] text-low">
                        {repos.length === 0
                          ? t('createProjectDialog.repoNone')
                          : t('createProjectDialog.repoHelper')}
                      </div>
                    </div>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_REPO}>
                    {t('createProjectDialog.repoLater')}
                  </SelectItem>
                  {repos.map((repo) => (
                    <SelectItem key={repo.id} value={repo.id}>
                      {repo.display_name || repo.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <div className="grid w-full grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isCreating}
              className="w-full rounded-lg border border-border bg-secondary/70 px-4 py-2 text-xs font-medium text-normal transition-colors hover:bg-secondary hover:text-high disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('common:buttons.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!name.trim() || isCreating}
              className="w-full rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreating
                ? t('createProjectDialog.creating', 'Creating...')
                : t('createProjectDialog.createButton', 'Create Project')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
);

export const CreateProjectDialog = defineModal<
  CreateProjectDialogProps,
  CreateProjectResult
>(CreateProjectDialogImpl);

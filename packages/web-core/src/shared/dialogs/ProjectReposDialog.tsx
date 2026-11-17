import { useCallback, useEffect, useState } from 'react';
import { create, useModal } from '@ebay/nice-modal-react';
import { useTranslation } from 'react-i18next';
import type { Repo } from 'shared/types';
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
import { defineModal } from '@/shared/lib/modals';
import { projectsApi, repoApi } from '@/shared/lib/api';
import { SettingsDialog } from '@/shared/dialogs/settings/SettingsDialog';

export interface ProjectReposDialogProps {
  projectId: string;
  projectName: string;
}

/**
 * Link registered repositories to a project. The captain and card-launched
 * workspaces start work in the project's first linked repo. Each toggle
 * saves immediately; unlinking keeps the repo, its worktrees and workspaces.
 */
const ProjectReposDialogImpl = create<ProjectReposDialogProps>(
  ({ projectId, projectName }) => {
    const modal = useModal();
    const { t } = useTranslation('projects');
    const [repos, setRepos] = useState<Repo[] | null>(null);
    const [linked, setLinked] = useState<string[]>([]);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
      try {
        const [all, mine] = await Promise.all([
          repoApi.list(),
          projectsApi.listRepos(projectId),
        ]);
        setRepos(all);
        setLinked(mine.map((r) => r.id));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setRepos([]);
      }
    }, [projectId]);

    useEffect(() => {
      void load();
    }, [load]);

    const toggle = async (repoId: string, link: boolean) => {
      setBusyId(repoId);
      setError(null);
      try {
        if (link) await projectsApi.linkRepo(projectId, repoId);
        else await projectsApi.unlinkRepo(projectId, repoId);
        setLinked((prev) =>
          link ? [...prev, repoId] : prev.filter((id) => id !== repoId)
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId(null);
      }
    };

    const close = () => {
      modal.resolve();
      modal.hide();
    };

    return (
      <Dialog open={modal.visible} onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t('projectRepos.title', 'Repositories for {{name}}', {
                name: projectName,
              })}
            </DialogTitle>
            <DialogDescription>
              {t(
                'projectRepos.description',
                "The captain and card-launched workspaces start work in the project's first linked repository."
              )}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {repos === null ? (
            <p className="text-sm text-low">
              {t('projectRepos.loading', 'Loading…')}
            </p>
          ) : repos.length === 0 ? (
            <div className="space-y-2 text-sm text-low">
              <p>
                {t('projectRepos.none', 'No repositories are registered yet.')}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  close();
                  SettingsDialog.show({ initialSection: 'repos' });
                }}
              >
                {t('projectRepos.openSettings', 'Add one in Settings')}
              </Button>
            </div>
          ) : (
            <ul className="max-h-80 divide-y divide-border/60 overflow-auto rounded-sm border border-border">
              {repos.map((repo) => {
                const isLinked = linked.includes(repo.id);
                const order = linked.indexOf(repo.id);
                return (
                  <li key={repo.id}>
                    <label className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-secondary/40">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4"
                        checked={isLinked}
                        disabled={busyId !== null}
                        onChange={(e) => void toggle(repo.id, e.target.checked)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="text-sm font-medium text-high">
                            {repo.display_name || repo.name}
                          </span>
                          {order === 0 && (
                            <span className="text-xs text-brand">
                              {t('projectRepos.primary', 'primary')}
                            </span>
                          )}
                        </span>
                        <span className="block truncate font-mono text-xs text-low">
                          {repo.path}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          <DialogFooter>
            <Button onClick={close}>{t('projectRepos.done', 'Done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

export const ProjectReposDialog = defineModal<ProjectReposDialogProps, void>(
  ProjectReposDialogImpl
);

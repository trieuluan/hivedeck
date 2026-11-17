import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  CaretDoubleLeftIcon,
  GitBranchIcon,
  LighthouseIcon,
} from '@phosphor-icons/react';
import { BaseCodingAgent } from 'shared/types';
import { cn } from '@/shared/lib/utils';
import { projectsApi, workspacesApi } from '@/shared/lib/api';
import {
  SpawnOrchestratorDialog,
  orchestratorStatusKey,
} from '@/shared/dialogs/orchestrator/SpawnOrchestratorDialog';
import { ProjectReposDialog } from '@/shared/dialogs/ProjectReposDialog';
import { WorkspaceSessionPanel } from './ProjectRightSidebarContainer';

const STORAGE_PREFIX = 'hivedeck.captainColumn.';

function loadOpen(projectId: string): boolean {
  try {
    return localStorage.getItem(STORAGE_PREFIX + projectId) !== 'closed';
  } catch {
    return true;
  }
}

function saveOpen(projectId: string, open: boolean) {
  try {
    localStorage.setItem(STORAGE_PREFIX + projectId, open ? 'open' : 'closed');
  } catch {
    // not persisted; fine
  }
}

const AGENT_LABEL: Partial<Record<BaseCodingAgent, string>> = {
  [BaseCodingAgent.CLAUDE_CODE]: 'Claude Code',
  [BaseCodingAgent.CLAUDE_CODE_HEADED]: 'Claude Code (terminal)',
  [BaseCodingAgent.CODEX]: 'Codex',
};

/**
 * ADR-032: the project's captain beside its board. Chat with the captain
 * here; it plans cards, dispatches them and moves them along the board.
 */
export function ProjectCaptainColumn({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(() => loadOpen(projectId));
  const toggle = (next: boolean) => {
    setOpen(next);
    saveOpen(projectId, next);
  };

  const { data: status } = useQuery({
    queryKey: orchestratorStatusKey(projectId),
    queryFn: () => workspacesApi.orchestratorStatus(projectId),
    refetchInterval: 5000,
  });
  const { data: repos } = useQuery({
    queryKey: ['projects', projectId, 'repos'],
    queryFn: () => projectsApi.listRepos(projectId),
    refetchInterval: open ? 15000 : false,
  });

  const openDialog = () =>
    void SpawnOrchestratorDialog.show({ projectId, projectName });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => toggle(true)}
        className="flex h-full w-9 shrink-0 flex-col items-center gap-2 border-r border-border bg-secondary pt-3 text-low hover:text-high"
        aria-label={t('captain.show')}
        title={t('captain.show')}
      >
        <LighthouseIcon className="size-icon-base" weight="fill" />
        {status?.active && (
          <span className="size-2 rounded-full bg-success" aria-hidden />
        )}
      </button>
    );
  }

  const agent = status?.executor ? AGENT_LABEL[status.executor] : undefined;
  const hasRepo = (repos?.length ?? 0) > 0;

  return (
    <aside
      className="ship-chat flex h-full w-[420px] max-w-full shrink-0 flex-col border-r border-border bg-secondary"
      aria-label={t('captain.title')}
    >
      <header className="flex items-center gap-2 border-b border-border px-base py-half">
        <LighthouseIcon className="size-icon-base text-brand" weight="fill" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-high">{t('captain.title')}</p>
          <p className="flex items-center gap-1 text-xs text-low">
            <span
              className={cn(
                'size-1.5 rounded-full',
                status?.active ? 'bg-success' : 'bg-border'
              )}
              aria-hidden
            />
            {status?.active
              ? agent
                ? t('captain.runningOn', { agent })
                : t('captain.running')
              : status?.workspace_id
                ? t('captain.stopped')
                : t('captain.none')}
          </p>
        </div>
        <button
          type="button"
          onClick={openDialog}
          className="min-h-9 rounded-lg border border-border px-3 text-xs text-normal hover:border-brand hover:bg-primary"
        >
          {status?.active ? t('captain.manage') : t('captain.start')}
        </button>
        <button
          type="button"
          onClick={() => toggle(false)}
          className="rounded-sm p-half text-low hover:bg-primary hover:text-high"
          aria-label={t('captain.hide')}
          title={t('captain.hide')}
        >
          <CaretDoubleLeftIcon className="size-icon-sm" weight="bold" />
        </button>
      </header>

      {repos && !hasRepo && (
        <div className="flex items-center gap-2 border-b border-border bg-warning/10 px-base py-half text-xs text-normal">
          <GitBranchIcon className="size-icon-sm shrink-0" />
          <span className="flex-1">{t('captain.noRepo')}</span>
          <button
            type="button"
            onClick={() =>
              void ProjectReposDialog.show({ projectId, projectName })
            }
            className="rounded-sm border border-border px-2 py-0.5 hover:bg-primary"
          >
            {t('captain.linkRepo')}
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {status?.workspace_id ? (
          <WorkspaceSessionPanel
            workspaceId={status.workspace_id}
            onClose={() => toggle(false)}
            hideHeader
          />
        ) : (
          <div className="flex flex-1 flex-col items-start justify-center gap-3 px-double text-sm text-low">
            <p className="text-base font-medium text-high">
              {t('captain.emptyTitle')}
            </p>
            <p>{t('captain.emptyBody')}</p>
            <button
              type="button"
              onClick={openDialog}
              className="rounded-sm bg-brand px-3 py-1 text-sm font-medium text-on-brand hover:bg-brand/90"
            >
              {t('captain.start')}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  CaretDoubleLeftIcon,
  CaretDoubleRightIcon,
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
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';

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

const MIN_WIDTH = 320;
const MAX_WIDTH = 800;
const DEFAULT_WIDTH = 420;
const KEY_STEP = 24;

const clampWidth = (width: number) =>
  Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));

function loadWidth(projectId: string): number {
  try {
    const raw = Number(localStorage.getItem(`${STORAGE_PREFIX}${projectId}.w`));
    return raw ? clampWidth(raw) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function saveWidth(projectId: string, width: number) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${projectId}.w`, String(width));
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
 * What waits on the owner, pinned above the captain chat: cards in review
 * (one click opens them) and a captain blocked on an approval.
 */
function NeedsYouStrip({
  projectId,
  captainWorkspaceId,
}: {
  projectId: string;
  captainWorkspaceId: string | null | undefined;
}) {
  const { t } = useTranslation('tasks');
  const appNavigation = useAppNavigation();
  const { issues, statuses } = useProjectContext();
  const { activeWorkspaces } = useWorkspaceContext();

  const inReview = useMemo(() => {
    const reviewIds = new Set(
      statuses.filter((s) => /review/i.test(s.name)).map((s) => s.id)
    );
    return issues
      .filter((issue) => reviewIds.has(issue.status_id))
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [issues, statuses]);
  const captainBlocked = activeWorkspaces.some(
    (ws) => ws.id === captainWorkspaceId && ws.hasPendingApproval
  );

  if (inReview.length === 0 && !captainBlocked) return null;
  return (
    <section
      aria-label={t('captain.needsYou')}
      className="flex flex-col gap-1 border-b border-border bg-warning/5 px-base py-half animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none"
    >
      <p className="text-xs font-medium text-warning">
        {t('captain.needsYou')}
      </p>
      {captainBlocked && (
        <p className="text-xs text-normal">{t('captain.waitingApproval')}</p>
      )}
      {inReview.slice(0, 3).map((issue) => (
        <button
          key={issue.id}
          type="button"
          onClick={() => appNavigation.goToProjectIssue(projectId, issue.id)}
          className="group flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 -mx-1 text-left text-xs text-normal hover:bg-secondary"
        >
          <span className="shrink-0 font-ibm-plex-mono text-low">
            {issue.simple_id}
          </span>
          <span className="truncate">{issue.title}</span>
          <span className="ml-auto shrink-0 text-low group-hover:text-normal">
            {t('captain.review')} →
          </span>
        </button>
      ))}
      {inReview.length > 3 && (
        <p className="text-xs text-low">
          {t('captain.moreInReview', { count: inReview.length - 3 })}
        </p>
      )}
    </section>
  );
}

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

  const [width, setWidth] = useState(() => loadWidth(projectId));
  const drag = useRef<{
    startX: number;
    startWidth: number;
    latest: number;
  } | null>(null);
  const commitWidth = (next: number) => {
    const clamped = clampWidth(next);
    setWidth(clamped);
    saveWidth(projectId, clamped);
  };
  const onResizeStart = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      startX: event.clientX,
      startWidth: width,
      latest: width,
    };
  };
  const onResizeMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current.latest = clampWidth(
      drag.current.startWidth + event.clientX - drag.current.startX
    );
    setWidth(drag.current.latest);
  };
  const onResizeEnd = () => {
    if (!drag.current) return;
    saveWidth(projectId, drag.current.latest);
    drag.current = null;
  };
  const onResizeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') commitWidth(width - KEY_STEP);
    else if (event.key === 'ArrowRight') commitWidth(width + KEY_STEP);
    else if (event.key === 'Home') commitWidth(DEFAULT_WIDTH);
    else return;
    event.preventDefault();
  };

  const { data: status } = useQuery({
    queryKey: orchestratorStatusKey(projectId),
    queryFn: () => workspacesApi.orchestratorStatus(projectId),
    // Same query as the sidebar's captain row; starting or stopping the
    // captain invalidates it, so a slow poll is enough.
    refetchInterval: 10_000,
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
        <LighthouseIcon className="size-icon-base text-brand" weight="fill" />
        <CaretDoubleRightIcon className="size-icon-sm" weight="bold" />
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
      className="ship-chat relative flex h-full max-w-[60%] shrink-0 flex-col border-r border-border bg-secondary"
      style={{ width }}
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

      <NeedsYouStrip
        projectId={projectId}
        captainWorkspaceId={status?.workspace_id}
      />

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
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('captain.resize')}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onKeyDown={onResizeKey}
        onDoubleClick={() => commitWidth(DEFAULT_WIDTH)}
        className="absolute inset-y-0 right-0 w-1 cursor-col-resize touch-none hover:bg-brand/50 focus-visible:bg-brand/50 active:bg-brand/50"
      />
    </aside>
  );
}

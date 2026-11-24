import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  CaretDownIcon,
  CaretUpIcon,
  DotsSixVerticalIcon,
  GitBranchIcon,
  LighthouseIcon,
  PushPinIcon,
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

export type CaptainMode = 'dock' | 'slideup' | 'pinned';

const STORAGE_PREFIX = 'hivedeck.captainColumn.';

export function loadCaptainMode(projectId: string): CaptainMode {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${projectId}.mode`);
    if (raw === 'dock' || raw === 'slideup' || raw === 'pinned') return raw;
    // Migrate legacy open/closed preference if present
    const legacy = localStorage.getItem(STORAGE_PREFIX + projectId);
    if (legacy === 'closed') return 'dock';
    if (legacy === 'open') return 'pinned';
    return 'dock';
  } catch {
    return 'dock';
  }
}

export function saveCaptainMode(projectId: string, mode: CaptainMode) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${projectId}.mode`, mode);
  } catch {
    // not persisted; fine
  }
}

function loadDockX(projectId: string): number {
  try {
    const raw = Number(localStorage.getItem(`${STORAGE_PREFIX}${projectId}.x`));
    return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : 0;
  } catch {
    return 0;
  }
}

function saveDockX(projectId: string, x: number) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${projectId}.x`, String(Math.round(x)));
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
  mode,
  onModeChange,
}: {
  projectId: string;
  projectName: string;
  mode: CaptainMode;
  onModeChange: (next: CaptainMode) => void;
}) {
  const { t } = useTranslation('tasks');
  const { issues, statuses } = useProjectContext();
  const { activeWorkspaces } = useWorkspaceContext();

  const [width, setWidth] = useState(() => loadWidth(projectId));
  const [dockX, setDockX] = useState(() => loadDockX(projectId));
  const dockRef = useRef<HTMLDivElement | null>(null);
  const dockDrag = useRef<{
    startClientX: number;
    startDockX: number;
    maxDockX: number;
    latest: number;
    moved: boolean;
  } | null>(null);

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
    refetchInterval: mode !== 'dock' ? 15000 : false,
  });

  const openDialog = () =>
    void SpawnOrchestratorDialog.show({ projectId, projectName });

  const inReviewCount = useMemo(() => {
    const reviewIds = new Set(
      statuses.filter((s) => /review/i.test(s.name)).map((s) => s.id)
    );
    return issues.filter((issue) => reviewIds.has(issue.status_id)).length;
  }, [issues, statuses]);

  const captainBlocked = activeWorkspaces.some(
    (ws) => ws.id === status?.workspace_id && ws.hasPendingApproval
  );
  const needsAttentionCount = inReviewCount + (captainBlocked ? 1 : 0);

  const onDockDragStart = (event: PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) {
      return;
    }
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.userSelect = 'none';
    const parentWidth = dockRef.current?.parentElement?.clientWidth ?? 900;
    const selfWidth = dockRef.current?.offsetWidth ?? 360;
    const maxDockX = Math.max(0, parentWidth - selfWidth);
    const currentX = Math.min(dockX, maxDockX);
    dockDrag.current = {
      startClientX: event.clientX,
      startDockX: currentX,
      maxDockX,
      latest: currentX,
      moved: false,
    };
  };

  const onDockDragMove = (event: PointerEvent<HTMLElement>) => {
    if (!dockDrag.current) return;
    const delta = event.clientX - dockDrag.current.startClientX;
    if (Math.abs(delta) > 3) dockDrag.current.moved = true;
    const next = Math.min(
      dockDrag.current.maxDockX,
      Math.max(0, Math.round(dockDrag.current.startDockX + delta))
    );
    dockDrag.current.latest = next;
    if (dockRef.current) {
      const offset = next - dockDrag.current.startDockX;
      dockRef.current.style.transform = `translate3d(${offset}px, 0, 0)`;
    }
  };

  const onDockDragEnd = () => {
    if (!dockDrag.current) return;
    document.body.style.userSelect = '';
    if (dockRef.current) {
      dockRef.current.style.transform = '';
    }
    let finalX = dockDrag.current.latest;
    if (finalX <= 8) finalX = 0;
    else if (dockDrag.current.maxDockX - finalX <= 8) {
      finalX = dockDrag.current.maxDockX;
    }
    setDockX(finalX);
    saveDockX(projectId, finalX);
    dockDrag.current = null;
  };

  const agent = status?.executor ? AGENT_LABEL[status.executor] : undefined;
  const hasRepo = (repos?.length ?? 0) > 0;

  if (mode === 'dock') {
    return (
      <div
        ref={dockRef}
        style={{ left: dockX }}
        className={cn(
          'absolute bottom-0 z-20 flex w-[min(360px,100%)] items-center gap-2 rounded-t-xl border border-b-0 bg-secondary/95 px-2.5 py-2 shadow-[0_-6px_24px_rgba(0,0,0,0.55)] backdrop-blur-md transition-colors will-change-transform',
          needsAttentionCount > 0
            ? 'border-brand/60'
            : status?.active
              ? 'border-success/45'
              : 'border-border'
        )}
      >
        <div
          role="slider"
          aria-label="Kéo vị trí thanh Thuyền trưởng"
          aria-valuenow={dockX}
          tabIndex={0}
          onPointerDown={onDockDragStart}
          onPointerMove={onDockDragMove}
          onPointerUp={onDockDragEnd}
          onPointerCancel={onDockDragEnd}
          title="Kéo ngang để đổi vị trí"
          className="flex cursor-grab items-center self-stretch px-0.5 text-low/70 hover:text-high active:cursor-grabbing touch-none"
        >
          <DotsSixVerticalIcon className="size-3.5" weight="bold" />
        </div>
        <button
          type="button"
          onClick={() => onModeChange('slideup')}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand ring-1 ring-brand/25">
            <LighthouseIcon className="size-4" weight="duotone" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs font-semibold text-high">
                {t('captain.title')}
              </span>
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  needsAttentionCount > 0
                    ? 'bg-warning'
                    : status?.active
                      ? 'bg-success'
                      : 'bg-low/50'
                )}
                aria-hidden
              />
              {needsAttentionCount > 0 && (
                <span className="rounded-full bg-brand px-1.5 text-[10px] font-bold leading-4 text-on-brand">
                  {needsAttentionCount}
                </span>
              )}
            </div>
            <p className="truncate text-[11px] text-low">
              {captainBlocked
                ? t('captain.waitingApproval')
                : status?.active
                  ? agent
                    ? t('captain.runningOn', { agent })
                    : t('captain.running')
                  : status?.workspace_id
                    ? t('captain.stopped')
                    : t('captain.none')}
            </p>
          </div>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openDialog();
          }}
          className={cn(
            'shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
            status?.active
              ? 'border-border text-normal hover:border-brand hover:bg-primary'
              : 'border-brand/50 bg-brand/10 text-brand hover:bg-brand/20'
          )}
        >
          {status?.active ? t('captain.manage') : t('captain.start')}
        </button>
        <button
          type="button"
          onClick={() => onModeChange('slideup')}
          className="shrink-0 rounded-md border border-border bg-primary/60 p-1 text-low transition-colors hover:bg-primary hover:text-high"
          aria-label={t('captain.show')}
          title={t('captain.show')}
        >
          <CaretUpIcon className="size-3.5" weight="bold" />
        </button>
      </div>
    );
  }

  const isPinned = mode === 'pinned';

  return (
    <aside
      ref={isPinned ? undefined : dockRef}
      className={cn(
        'ship-chat flex flex-col bg-secondary',
        isPinned
          ? 'relative h-full max-w-[60%] shrink-0 border-r border-border'
          : 'absolute inset-y-0 z-20 max-w-[min(60%,100%)] overflow-hidden border-x border-border shadow-[0_0_40px_rgba(0,0,0,0.72)] will-change-transform animate-in slide-in-from-bottom-4 fade-in-0 duration-150 motion-reduce:animate-none'
      )}
      style={isPinned ? { width } : { left: dockX, width }}
      aria-label={t('captain.title')}
    >
      <header
        onPointerDown={!isPinned ? onDockDragStart : undefined}
        onPointerMove={!isPinned ? onDockDragMove : undefined}
        onPointerUp={!isPinned ? onDockDragEnd : undefined}
        onPointerCancel={!isPinned ? onDockDragEnd : undefined}
        className={cn(
          'flex items-center gap-2 border-b border-border px-3 py-2',
          !isPinned && 'cursor-grab active:cursor-grabbing touch-none'
        )}
      >
        {!isPinned && (
          <div
            role="slider"
            aria-label="Kéo vị trí khung Thuyền trưởng"
            aria-valuenow={dockX}
            tabIndex={0}
            title="Kéo ngang để đổi vị trí"
            className="flex items-center self-stretch px-0.5 text-low/70"
          >
            <DotsSixVerticalIcon className="size-3.5" weight="bold" />
          </div>
        )}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand ring-1 ring-brand/25">
          <LighthouseIcon className="size-icon-base" weight="duotone" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-high">
            {t('captain.title')}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-low">
            <span
              className={cn(
                'size-1.5 rounded-full',
                status?.active ? 'bg-success' : 'bg-low/50'
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
          className={cn(
            'min-h-7 rounded-md border px-2.5 text-xs font-medium transition-colors',
            status?.active
              ? 'border-border text-normal hover:border-brand hover:bg-primary'
              : 'border-brand/50 bg-brand/10 text-brand hover:bg-brand/20'
          )}
        >
          {status?.active ? t('captain.manage') : t('captain.start')}
        </button>
        <button
          type="button"
          onClick={() => onModeChange(isPinned ? 'slideup' : 'pinned')}
          className={cn(
            'rounded-md border p-1.5 transition-colors',
            isPinned
              ? 'border-brand/50 bg-brand/15 text-brand hover:bg-brand/25'
              : 'border-border text-low hover:bg-primary hover:text-high'
          )}
          aria-label={isPinned ? 'Bỏ ghim (chuyển về dạng nổi)' : 'Ghim thành cột cố định'}
          title={isPinned ? 'Bỏ ghim (chuyển về dạng nổi)' : 'Ghim thành cột cố định'}
        >
          <PushPinIcon
            className="size-icon-sm"
            weight={isPinned ? 'fill' : 'regular'}
          />
        </button>
        <button
          type="button"
          onClick={() => onModeChange('dock')}
          className="rounded-md border border-border p-1.5 text-low transition-colors hover:bg-primary hover:text-high"
          aria-label={t('captain.hide')}
          title={t('captain.hide')}
        >
          <CaretDownIcon className="size-icon-sm" weight="bold" />
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
            onClose={() => onModeChange('dock')}
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

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  ArrowSquareOutIcon,
  GitBranchIcon,
  MagnifyingGlassIcon,
  PushPinIcon,
  TrashIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import type { SidebarWorkspace } from '@/shared/hooks/useWorkspaces';
import { useWorkspaceProjectMembership } from '@/shared/hooks/useWorkspaceProjectMembership';
import { useProjects } from '@/shared/hooks/useProjects';
import { useUiPreferencesStore } from '@/shared/stores/useUiPreferencesStore';
import { workspaceSummaryKeys } from '@/shared/hooks/workspaceSummaryKeys';
import { workspacesApi } from '@/shared/lib/api';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import { cn } from '@/shared/lib/utils';

type StatusTab = 'all' | 'active' | 'attention' | 'archived';

function formatRelativeTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return 'vừa xong';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} giờ trước`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays} ngày trước`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths} tháng trước`;
}

export function WorkspacesDashboard() {
  const { t } = useTranslation('common');
  const { activeWorkspaces, archivedWorkspaces } = useWorkspaceContext();
  const appNavigation = useAppNavigation();
  const membership = useWorkspaceProjectMembership();
  const { data: projects = [] } = useProjects();
  const projectId = useUiPreferencesStore(
    (s) => s.workspacesDashboardProjectId
  );
  const setProjectId = useUiPreferencesStore(
    (s) => s.setWorkspacesDashboardProjectId
  );
  const queryClient = useQueryClient();

  const [statusTab, setStatusTab] = useState<StatusTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyWithDiff, setOnlyWithDiff] = useState(false);
  const [isCleaningFinished, setIsCleaningFinished] = useState(false);
  const [busyWorkspaceId, setBusyWorkspaceId] = useState<string | null>(null);

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects]
  );

  const { data: cleanupPreview, refetch: refetchCleanupPreview } = useQuery({
    queryKey: ['workspaces', 'cleanup-finished-preview', projectId ?? 'all'],
    queryFn: () =>
      workspacesApi.cleanupFinished({
        project_id: projectId ?? null,
        dry_run: true,
      }),
  });
  const cleanableFinishedCount = cleanupPreview?.deleted_count ?? 0;

  const invalidateWorkspaces = async () => {
    await Promise.all([
      refetchCleanupPreview(),
      queryClient.invalidateQueries({ queryKey: workspaceSummaryKeys.all }),
    ]);
  };

  const handleCleanupFinished = async () => {
    if (cleanableFinishedCount === 0 || isCleaningFinished) return;
    const confirmed = await ConfirmDialog.show({
      title: t('kanban.cleanupFinishedConfirmTitle', {
        count: cleanableFinishedCount,
        defaultValue: 'Clean up {{count}} finished workspace(s)?',
      }),
      message: t('kanban.cleanupFinishedConfirmMessage', {
        count: cleanableFinishedCount,
        defaultValue:
          'This deletes {{count}} non-pinned workspace(s) linked to Done or Cancelled cards, including their worktrees and git branches. Pinned workspaces are kept.',
      }),
      confirmText: t('kanban.cleanupFinishedConfirmButton', {
        defaultValue: 'Clean up',
      }),
      cancelText: t('buttons.cancel'),
      variant: 'destructive',
    });
    if (confirmed !== 'confirmed') return;

    setIsCleaningFinished(true);
    try {
      const res = await workspacesApi.cleanupFinished({
        project_id: projectId ?? null,
        dry_run: false,
      });
      await invalidateWorkspaces();
      if (res.skipped_running_count > 0) {
        await ConfirmDialog.show({
          title: t('kanban.cleanupFinishedPartialTitle', {
            defaultValue: 'Cleanup completed with skipped workspaces',
          }),
          message: t('kanban.cleanupFinishedPartialMessage', {
            deleted: res.deleted_count,
            skipped: res.skipped_running_count,
            defaultValue:
              'Deleted {{deleted}} workspace(s). Skipped {{skipped}} workspace(s) with running processes.',
          }),
          confirmText: t('ok'),
          showCancelButton: false,
          variant: 'info',
        });
      }
    } catch (error) {
      await ConfirmDialog.show({
        title: t('error'),
        message: error instanceof Error ? error.message : String(error),
        confirmText: t('ok'),
        showCancelButton: false,
        variant: 'destructive',
      });
    } finally {
      setIsCleaningFinished(false);
    }
  };

  const handleToggleArchive = async (ws: SidebarWorkspace) => {
    if (busyWorkspaceId) return;
    setBusyWorkspaceId(ws.id);
    try {
      await workspacesApi.update(ws.id, { archived: !ws.isArchived });
      await invalidateWorkspaces();
    } finally {
      setBusyWorkspaceId(null);
    }
  };

  const handleDeleteWorkspace = async (ws: SidebarWorkspace) => {
    if (busyWorkspaceId || ws.isRunning) return;
    const confirmed = await ConfirmDialog.show({
      title: 'Xác nhận xóa workspace',
      target: {
        label: ws.name,
        branch: ws.branch,
      },
      message:
        'Sẽ xóa workspace, thư mục worktree và git branch tương ứng khỏi máy.',
      confirmText: 'Xóa workspace',
      cancelText: t('buttons.cancel'),
      variant: 'destructive',
    });
    if (confirmed !== 'confirmed') return;

    setBusyWorkspaceId(ws.id);
    try {
      await workspacesApi.delete(ws.id, true);
      await invalidateWorkspaces();
    } finally {
      setBusyWorkspaceId(null);
    }
  };

  const allCombined = useMemo(() => {
    const merged = [
      ...activeWorkspaces.map((w) => ({ ...w, isArchived: false })),
      ...archivedWorkspaces.map((w) => ({ ...w, isArchived: true })),
    ];
    return merged.sort(
      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    );
  }, [activeWorkspaces, archivedWorkspaces]);

  const projectFiltered = useMemo(() => {
    if (!projectId) return allCombined;
    return allCombined.filter((ws) => membership.get(ws.id)?.has(projectId));
  }, [allCombined, membership, projectId]);

  const counts = useMemo(() => {
    let activeCount = 0;
    let attentionCount = 0;
    let archivedCount = 0;
    for (const ws of projectFiltered) {
      if (ws.isArchived) {
        archivedCount += 1;
      } else {
        activeCount += 1;
        if (ws.isRunning || ws.hasPendingApproval) {
          attentionCount += 1;
        }
      }
    }
    return {
      all: projectFiltered.length,
      active: activeCount,
      attention: attentionCount,
      archived: archivedCount,
    };
  }, [projectFiltered]);

  const visibleWorkspaces = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return projectFiltered.filter((ws) => {
      if (statusTab === 'active' && ws.isArchived) return false;
      if (
        statusTab === 'attention' &&
        (ws.isArchived || (!ws.isRunning && !ws.hasPendingApproval))
      ) {
        return false;
      }
      if (statusTab === 'archived' && !ws.isArchived) return false;
      if (
        onlyWithDiff &&
        (ws.filesChanged ?? 0) === 0 &&
        (ws.linesAdded ?? 0) === 0 &&
        (ws.linesRemoved ?? 0) === 0
      ) {
        return false;
      }
      if (q) {
        const wsProjectNames = Array.from(membership.get(ws.id) ?? [])
          .map((pid) => projectMap.get(pid) ?? '')
          .join(' ')
          .toLowerCase();
        const haystack =
          `${ws.name} ${ws.branch} ${ws.description} ${wsProjectNames}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [
    membership,
    onlyWithDiff,
    projectFiltered,
    projectMap,
    searchQuery,
    statusTab,
  ]);

  const statusTabs: Array<{ id: StatusTab; label: string; count: number }> = [
    { id: 'all', label: 'Tất cả', count: counts.all },
    { id: 'active', label: 'Đang giữ', count: counts.active },
    {
      id: 'attention',
      label: 'Đang chạy / Cần chú ý',
      count: counts.attention,
    },
    { id: 'archived', label: 'Đã lưu trữ', count: counts.archived },
  ];

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto bg-primary p-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold leading-tight text-high">
              Workspaces
            </h1>
            <div className="flex flex-wrap items-center gap-1.5">
              {statusTabs.map((tab) => {
                const isActive = statusTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStatusTab(tab.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                      isActive
                        ? 'border-brand/60 bg-brand/15 text-brand'
                        : 'border-border bg-overlay text-low hover:border-border-strong hover:text-normal'
                    )}
                  >
                    <span>{tab.label}</span>
                    <span className="tabular-nums text-[11px] opacity-80">
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            disabled={cleanableFinishedCount === 0 || isCleaningFinished}
            onClick={() => void handleCleanupFinished()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-overlay px-2.5 py-1.5 text-xs font-medium text-normal transition-colors hover:border-border-strong hover:bg-surface/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <TrashIcon className="size-3.5" />
            <span>
              {t('workspaces.dashboard.cleanupFinished', {
                count: cleanableFinishedCount,
                defaultValue: 'Clean up finished ({{count}})',
              })}
            </span>
          </button>
        </div>

        {/* Search & Filter bar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex min-w-[220px] flex-1 items-center">
            <MagnifyingGlassIcon
              className="pointer-events-none absolute left-2.5 size-3.5 text-low"
              weight="bold"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo tên workspace, branch, mô tả hoặc project..."
              className="w-full rounded-md border border-border bg-overlay py-1.5 pl-8 pr-8 text-xs text-high placeholder:text-low focus:border-brand focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 rounded p-0.5 text-low hover:bg-secondary hover:text-normal"
                aria-label="Xóa tìm kiếm"
              >
                <XIcon className="size-3" weight="bold" />
              </button>
            )}
          </div>

          <select
            value={projectId ?? ''}
            onChange={(e) => setProjectId(e.target.value || null)}
            className="rounded-md border border-border bg-overlay px-2.5 py-1.5 text-xs text-normal focus:border-brand focus:outline-none"
            aria-label="Lọc theo project"
          >
            <option value="">Tất cả project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setOnlyWithDiff((prev) => !prev)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
              onlyWithDiff
                ? 'border-brand/60 bg-brand/15 text-brand'
                : 'border-border bg-overlay text-low hover:border-border-strong hover:text-normal'
            )}
          >
            <span>Có thay đổi code</span>
          </button>
        </div>
      </header>

      {visibleWorkspaces.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border/80 bg-overlay/40 py-12 text-center">
          <p className="text-sm font-medium text-normal">
            Không có workspace nào khớp bộ lọc
          </p>
          <p className="mt-1 text-xs text-low">
            Thử đổi tab trạng thái, bỏ từ khóa tìm kiếm hoặc chọn Tất cả
            project.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-overlay">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[minmax(240px,1fr)_124px_124px_96px_96px_132px] items-center gap-3 border-b border-border bg-secondary/40 px-3.5 py-2 text-[11px] font-medium uppercase tracking-wide text-low">
              <span>Workspace</span>
              <span>Project</span>
              <span>Trạng thái</span>
              <span className="text-right">Diff</span>
              <span className="text-right">Cập nhật</span>
              <span className="text-right">Thao tác</span>
            </div>
            <div className="divide-y divide-border/70">
              {visibleWorkspaces.map((ws) => {
                const wsProjects = Array.from(membership.get(ws.id) ?? [])
                  .map((pid) => projectMap.get(pid))
                  .filter((name): name is string => Boolean(name));
                const isCaptain = ws.kind === 'orchestrator';
                const hasDiff =
                  (ws.filesChanged ?? 0) > 0 ||
                  (ws.linesAdded ?? 0) > 0 ||
                  (ws.linesRemoved ?? 0) > 0;
                const isBusy = busyWorkspaceId === ws.id;

                return (
                  <div
                    key={ws.id}
                    onClick={() => appNavigation.goToWorkspace(ws.id)}
                    className={cn(
                      'group grid cursor-pointer grid-cols-[minmax(240px,1fr)_124px_124px_96px_96px_132px] items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface/60',
                      ws.isArchived && 'opacity-75 hover:opacity-100'
                    )}
                  >
                    {/* Col 1: Workspace name + branch */}
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={cn(
                          'h-2 w-2 shrink-0 rounded-full',
                          ws.hasPendingApproval
                            ? 'bg-amber-400'
                            : ws.isRunning
                              ? 'bg-emerald-400 animate-pulse'
                              : ws.isArchived
                                ? 'bg-low/40'
                                : 'bg-emerald-500/70'
                        )}
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium text-high">
                            {ws.name}
                          </span>
                          {isCaptain && (
                            <span className="shrink-0 rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-medium text-brand">
                              Captain
                            </span>
                          )}
                          {ws.isPinned && (
                            <PushPinIcon
                              className="size-3 shrink-0 text-brand"
                              weight="fill"
                            />
                          )}
                        </div>
                        {ws.branch && (
                          <span className="inline-flex min-w-0 items-center gap-1 font-ibm-plex-mono text-[11px] text-low">
                            <GitBranchIcon className="size-3 shrink-0" />
                            <span className="truncate">{ws.branch}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Col 2: Project */}
                    <div className="flex min-w-0 items-center">
                      {wsProjects.length > 0 ? (
                        <span className="truncate rounded border border-border/80 bg-secondary/50 px-1.5 py-0.5 text-[11px] text-normal">
                          {wsProjects[0]}
                        </span>
                      ) : (
                        <span className="truncate rounded border border-border/60 bg-secondary/30 px-1.5 py-0.5 text-[11px] text-low">
                          Khác
                        </span>
                      )}
                    </div>

                    {/* Col 3: Status */}
                    <div className="flex items-center">
                      <span
                        className={cn(
                          'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
                          ws.hasPendingApproval
                            ? 'bg-amber-500/15 text-amber-400'
                            : ws.isRunning
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : ws.isArchived
                                ? 'bg-secondary text-low'
                                : 'bg-emerald-500/10 text-emerald-400'
                        )}
                      >
                        {ws.hasPendingApproval
                          ? 'Cần chú ý'
                          : ws.isRunning
                            ? 'Đang chạy'
                            : ws.isArchived
                              ? 'Đã lưu trữ'
                              : 'Đang giữ'}
                      </span>
                    </div>

                    {/* Col 4: Diff */}
                    <div className="text-right font-ibm-plex-mono text-[11px] tabular-nums">
                      {hasDiff ? (
                        <>
                          <span className="text-emerald-400">
                            +{ws.linesAdded ?? 0}
                          </span>{' '}
                          <span className="text-rose-400">
                            -{ws.linesRemoved ?? 0}
                          </span>
                        </>
                      ) : (
                        <span className="text-low/50">—</span>
                      )}
                    </div>

                    {/* Col 5: Relative updated time */}
                    <div className="text-right text-[11px] tabular-nums text-low">
                      {formatRelativeTime(ws.updatedAt)}
                    </div>

                    {/* Col 6: Actions */}
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          appNavigation.goToWorkspace(ws.id);
                        }}
                        className="inline-flex items-center gap-1 rounded border border-border bg-secondary/50 px-2 py-1 text-xs text-normal transition-colors hover:border-brand/60 hover:text-brand"
                        title="Mở workspace"
                      >
                        <ArrowSquareOutIcon className="size-3.5" />
                        <span>Mở</span>
                      </button>

                      {!isCaptain && (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleToggleArchive(ws);
                            }}
                            className="inline-flex items-center rounded border border-border bg-secondary/40 p-1 text-low transition-colors hover:bg-secondary hover:text-normal disabled:opacity-50"
                            title={
                              ws.isArchived
                                ? 'Khôi phục workspace'
                                : 'Lưu trữ (Archive)'
                            }
                          >
                            {ws.isArchived ? (
                              <ArrowCounterClockwiseIcon className="size-3.5" />
                            ) : (
                              <ArchiveIcon className="size-3.5" />
                            )}
                          </button>

                          <button
                            type="button"
                            disabled={isBusy || ws.isRunning}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteWorkspace(ws);
                            }}
                            className="inline-flex items-center rounded border border-border bg-secondary/40 p-1 text-low transition-colors hover:border-rose-500/50 hover:bg-rose-500/10 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
                            title={
                              ws.isRunning
                                ? 'Không thể xóa workspace đang chạy'
                                : 'Xóa workspace, worktree & branch'
                            }
                          >
                            <TrashIcon className="size-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

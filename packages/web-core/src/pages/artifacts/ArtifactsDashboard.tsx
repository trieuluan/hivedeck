import {
  Children,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import type { Issue } from 'shared/remote-types';
import { useProjects } from '@/shared/hooks/useProjects';
import { makeRequest } from '@/shared/lib/remoteApi';
import {
  fileUrl,
  ArtifactLightbox,
  type Artifact,
  previewKind,
  size,
  useArtifacts,
} from '@/pages/kanban/IssueArtifacts';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import { artifactGroups, executionGroups, type ArtifactFile } from './groups';

function ExecutionFiles({
  children,
  view,
  label,
  headerLeft,
}: {
  children: ReactNode;
  view: 'grid' | 'list';
  label: string;
  headerLeft?: ReactNode;
}) {
  const { t } = useTranslation('common');
  const rail = useRef<HTMLDivElement>(null);
  const savedPosition = useRef(0);
  const fileCount = Children.count(children);
  const [expanded, setExpanded] = useState(false);
  const [edges, setEdges] = useState({
    overflow: false,
    start: true,
    end: true,
  });

  useLayoutEffect(() => {
    const element = rail.current;
    if (!element || view !== 'grid' || expanded) return;
    element.scrollLeft = savedPosition.current;
    const update = () =>
      setEdges({
        overflow: element.scrollWidth > element.clientWidth + 1,
        start: element.scrollLeft <= 1,
        end:
          element.scrollLeft + element.clientWidth >= element.scrollWidth - 1,
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener('scroll', update);
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', update);
    };
  }, [view, expanded, fileCount]);

  if (view === 'list') {
    return (
      <div className="space-y-2.5">
        {headerLeft && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {headerLeft}
          </div>
        )}
        <div className="-mx-base divide-y divide-border/70 border-t border-border/70 sm:-mx-double">
          {children}
        </div>
      </div>
    );
  }

  const scroll = (direction: number) => {
    const element = rail.current;
    if (!element) return;
    element.scrollBy({
      left: direction * element.clientWidth,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  };

  return (
    <div className="min-w-0 space-y-base">
      {(headerLeft || edges.overflow || expanded) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
          <div className="min-w-0 flex-1">{headerLeft}</div>
          {(edges.overflow || expanded) && (
            <div className="flex shrink-0 items-center gap-half">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => {
                  if (!expanded)
                    savedPosition.current = rail.current?.scrollLeft ?? 0;
                  setExpanded(!expanded);
                }}
                className="rounded px-half py-half text-xs text-low hover:text-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                {t(expanded ? 'artifactRail.collapse' : 'artifactRail.showAll')}
              </button>
              {!expanded && (
                <div className="hidden gap-half sm:flex">
                  <button
                    type="button"
                    aria-label={t('artifactRail.previous')}
                    disabled={edges.start}
                    onClick={() => scroll(-1)}
                    className="rounded border border-border bg-secondary/50 p-1 text-high disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    <CaretLeft className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('artifactRail.next')}
                    disabled={edges.end}
                    onClick={() => scroll(1)}
                    className="rounded border border-border bg-secondary/50 p-1 text-high disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    <CaretRight className="size-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <div
        ref={rail}
        aria-label={`${t('artifactRail.files')} · ${label}`}
        tabIndex={expanded ? undefined : 0}
        className={
          expanded
            ? 'grid grid-cols-2 gap-base md:grid-cols-4'
            : 'grid auto-cols-[69%] grid-flow-col snap-x snap-mandatory gap-base overflow-x-auto sm:auto-cols-[calc((100%-2.25rem)/4)] [&>div]:snap-start'
        }
      >
        {children}
      </div>
    </div>
  );
}

function IssueArtifactCard({
  issueId,
  files,
  issue,
  projectName,
  label,
  view,
  busy,
  onRemove,
  onOpenFile,
}: {
  issueId: string;
  files: ArtifactFile[];
  issue: Issue | undefined;
  projectName?: string;
  label: string;
  view: 'grid' | 'list';
  busy: string | null;
  onRemove: (issueId: string, label: string) => void;
  onOpenFile: (
    issueId: string,
    file: Artifact,
    trigger: HTMLElement
  ) => void;
}) {
  const executions = Array.from(executionGroups(files));
  const [selectedExec, setSelectedExec] = useState<string>(
    () => executions[0]?.[0] ?? 'all'
  );

  const activeExec =
    selectedExec === 'all' || executions.some(([id]) => id === selectedExec)
      ? selectedExec
      : (executions[0]?.[0] ?? 'all');

  const visibleFiles =
    activeExec === 'all'
      ? files
      : (executions.find(([id]) => id === activeExec)?.[1] ?? files);

  const latestTime = (list: ArtifactFile[]) =>
    new Date(
      list.reduce(
        (latest, f) =>
          Date.parse(f.created_at) > Date.parse(latest) ? f.created_at : latest,
        list[0].created_at
      )
    ).toLocaleString();

  const shortTime = (list: ArtifactFile[]) =>
    new Date(
      list.reduce(
        (latest, f) =>
          Date.parse(f.created_at) > Date.parse(latest) ? f.created_at : latest,
        list[0].created_at
      )
    ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const executionHeader =
    executions.length > 1 ? (
      <div className="flex flex-wrap items-center gap-1.5">
        {executions.map(([execId, execFiles], idx) => {
          const isSelected = activeExec === execId;
          return (
            <button
              key={execId}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setSelectedExec(execId)}
              title={`${execId} · ${latestTime(execFiles)}`}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                isSelected
                  ? 'border-brand/60 bg-brand/15 font-medium text-brand'
                  : 'border-border bg-secondary/50 text-low hover:text-high'
              }`}
            >
              {idx === 0 && (
                <span
                  className="size-1.5 rounded-full bg-success"
                  aria-hidden
                />
              )}
              <span>
                {idx === 0 ? 'Mới nhất · ' : ''}
                {execId.slice(0, 8)} ({execFiles.length}) ·{' '}
                {shortTime(execFiles)}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={activeExec === 'all'}
          onClick={() => setSelectedExec('all')}
          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
            activeExec === 'all'
              ? 'border-brand/60 bg-brand/15 font-medium text-brand'
              : 'border-border bg-secondary/50 text-low hover:text-high'
          }`}
        >
          Tất cả ({files.length})
        </button>
      </div>
    ) : (
      executions[0] && (
        <p className="text-xs text-low" title={executions[0][0]}>
          Execution {executions[0][0].slice(0, 8)} · {executions[0][1].length}{' '}
          {executions[0][1].length === 1 ? 'file' : 'files'} ·{' '}
          {latestTime(executions[0][1])}
        </p>
      )
    );

  return (
    <article className="space-y-base rounded-lg border border-border/70 bg-panel p-base sm:p-double">
      <header className="flex flex-wrap items-start justify-between gap-base">
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold text-brand">
            {issue?.simple_id ?? 'Orphan'}
            {projectName && (
              <span className="ml-1.5 font-sans font-normal text-low">
                · {projectName}
              </span>
            )}
          </p>
          <h2 className="break-words text-lg font-semibold text-high">
            {issue?.title ?? label}
          </h2>
        </div>
        <div className="flex items-center gap-base">
          {issue && (
            <a
              className="rounded-md border border-border bg-secondary/60 px-2.5 py-1 text-xs font-medium text-high hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              href={`/projects/${issue.project_id}/issues/${issue.id}?tab=artifacts`}
            >
              Mở card ↗
            </a>
          )}
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => onRemove(issueId, label)}
            className="px-half py-half text-xs text-low hover:text-error disabled:opacity-50"
          >
            {busy === issueId ? 'Deleting…' : 'Xóa card artifacts'}
          </button>
        </div>
      </header>

      <ExecutionFiles view={view} label={label} headerLeft={executionHeader}>
        {visibleFiles.map((file) => {
          const kind = previewKind(file);
          return (
            <div
              key={file.path}
              className={
                view === 'list'
                  ? 'flex items-center justify-between gap-base px-base py-2.5 transition-colors hover:bg-secondary/30 sm:px-double'
                  : 'flex min-w-0 flex-col overflow-hidden rounded-lg border border-border/70 bg-primary/50 transition-colors hover:border-border'
              }
            >
              <button
                type="button"
                aria-label={`Open ${file.name}`}
                onClick={(event) =>
                  onOpenFile(issueId, file, event.currentTarget)
                }
                className={
                  view === 'list'
                    ? 'flex min-w-0 flex-1 items-center gap-base text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'
                    : 'block w-full min-w-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'
                }
              >
                <span
                  className={`flex shrink-0 items-center justify-center overflow-hidden bg-secondary text-low ${view === 'list' ? 'h-10 w-14 rounded' : 'h-32 w-full border-b border-border/50 sm:h-36'}`}
                >
                  {kind === 'image' ? (
                    <img
                      src={fileUrl(issueId, file.path)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span
                      className={
                        view === 'list'
                          ? 'text-xs font-semibold'
                          : 'text-lg font-semibold'
                      }
                    >
                      {kind === 'markdown'
                        ? 'MD'
                        : kind === 'html'
                          ? 'HTML'
                          : kind === 'video'
                            ? 'VIDEO'
                            : 'FILE'}
                    </span>
                  )}
                </span>
                <span
                  className={
                    view === 'list' ? 'block min-w-0' : 'block min-w-0 px-2.5 pt-2'
                  }
                >
                  <span
                    title={file.name}
                    className={
                      view === 'list'
                        ? 'block truncate text-sm font-medium text-high'
                        : 'block truncate text-xs font-semibold text-high'
                    }
                  >
                    {file.name}
                  </span>
                  <span className="block truncate text-xs text-low">
                    {kind.toUpperCase()} · {size(file.size)}
                    {file.execution_id
                      ? ` · ${file.execution_id.slice(0, 8)}`
                      : ''}
                  </span>
                </span>
              </button>
              <div
                className={
                  view === 'list'
                    ? 'flex shrink-0 items-center gap-2'
                    : 'flex shrink-0 items-center justify-between gap-base px-2.5 pb-2.5 pt-1'
                }
              >
                {view === 'list' && (
                  <>
                    <span className="hidden rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-low sm:inline-block">
                      {kind.toUpperCase()}
                    </span>
                    <button
                      type="button"
                      onClick={(event) =>
                        onOpenFile(issueId, file, event.currentTarget)
                      }
                      className="rounded border border-border bg-secondary/60 px-2 py-0.5 text-xs text-normal hover:bg-secondary hover:text-high"
                    >
                      Xem
                    </button>
                  </>
                )}
                <a
                  href={fileUrl(issueId, file.path)}
                  download={file.name}
                  aria-label={`Download ${file.name}`}
                  className="text-xs text-low hover:text-high"
                >
                  Tải xuống
                </a>
              </div>
            </div>
          );
        })}
      </ExecutionFiles>
    </article>
  );
}

export function ArtifactsDashboard() {
  const { data: artifacts, isLoading, error } = useArtifacts();
  const projects = useProjects();
  const client = useQueryClient();
  const [sort, setSort] = useState<'date' | 'size'>('date');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [selection, setSelection] = useState<{
    issueId: string;
    file: Artifact;
  } | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const selectPreview = useCallback((file: Artifact | null) => {
    setSelection((current) => (current && file ? { ...current, file } : null));
  }, []);
  const issueQueries = useQueries({
    queries: (projects.data ?? []).map((project) => ({
      queryKey: ['artifact-issues', project.id],
      refetchInterval: 5000,
      queryFn: async (): Promise<Issue[]> => {
        const response = await makeRequest(
          `/v1/fallback/issues?${new URLSearchParams({ project_id: project.id })}`
        );
        if (!response.ok) throw new Error('Could not load cards');
        const body = await response.json();
        if (!Array.isArray(body.issues))
          throw new Error('Could not load cards');
        return body.issues;
      },
    })),
  });
  const issues = new Map(
    issueQueries
      .flatMap((query) => query.data ?? [])
      .map((issue) => [issue.id, issue])
  );
  const metadataLoading =
    projects.isLoading || issueQueries.some((query) => query.isLoading);
  const metadataError =
    projects.isError || issueQueries.some((query) => query.isError);
  const projectNames = new Map(
    (projects.data ?? []).map((p) => [p.id, p.name])
  );
  const groups = artifactGroups(
    (artifacts ?? {}) as Record<string, ArtifactFile[]>,
    sort
  );
  const filteredGroups =
    selectedProjectId === 'all'
      ? groups
      : groups.filter(
          (g) => issues.get(g.issueId)?.project_id === selectedProjectId
        );
  const total = filteredGroups.reduce((sum, group) => sum + group.total, 0);
  const totalFiles = filteredGroups.reduce(
    (sum, group) => sum + group.files.length,
    0
  );

  async function remove(issueId: string, label: string) {
    const confirmed = await ConfirmDialog.show({
      title: `Delete artifacts for ${label}?`,
      message: 'All artifact files for this card will be permanently deleted.',
      confirmText: 'Delete artifacts',
      cancelText: 'Cancel',
      variant: 'destructive',
    });
    if (confirmed !== 'confirmed') return;
    setBusy(issueId);
    setDeleteError('');
    try {
      const response = await fetch(`/api/issues/${issueId}/artifacts`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Delete failed');
      const body = await response.json();
      if (!body.success) throw new Error('Delete failed');
      await client.invalidateQueries({ queryKey: ['artifacts'] });
    } catch {
      setDeleteError('Could not delete artifacts. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="h-full overflow-y-auto p-double text-normal">
      <div className="mx-auto max-w-5xl space-y-double">
        <header className="flex flex-wrap items-end justify-between gap-base">
          <div>
            <h1 className="text-xl font-semibold text-high">Artifacts</h1>
            <p className="text-low">
              {filteredGroups.length} card · {totalFiles} file từ các lần chạy ·{' '}
              {size(total)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {(projects.data?.length ?? 0) > 1 && (
              <label className="flex items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 py-1 text-xs text-low">
                <span>Project:</span>
                <select
                  value={selectedProjectId}
                  onChange={(event) => setSelectedProjectId(event.target.value)}
                  className="bg-transparent font-medium text-high focus:outline-none"
                >
                  <option value="all">Tất cả</option>
                  {(projects.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div
              role="group"
              aria-label="Kiểu hiển thị"
              className="inline-flex rounded-md border border-border bg-panel p-0.5"
            >
              {(['grid', 'list'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={view === mode}
                  onClick={() => setView(mode)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${view === mode ? 'bg-brand font-semibold text-white' : 'text-low hover:text-high'}`}
                >
                  {mode === 'grid' ? 'Grid' : 'List'}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 py-1 text-xs text-low">
              <span>Sort by:</span>
              <select
                value={sort}
                onChange={(event) =>
                  setSort(event.target.value as 'date' | 'size')
                }
                className="bg-transparent font-medium text-high focus:outline-none"
              >
                <option value="date">Newest</option>
                <option value="size">Size</option>
              </select>
            </label>
          </div>
        </header>
        {isLoading && <p>Loading artifacts…</p>}
        {error && (
          <p role="alert" className="text-error">
            Could not load artifacts.
          </p>
        )}
        {metadataError && (
          <p role="alert" className="text-error">
            Could not load card details. Retry by refreshing this page.
          </p>
        )}
        {deleteError && (
          <p role="alert" className="text-error">
            {deleteError}
          </p>
        )}
        {!isLoading && !error && filteredGroups.length === 0 && (
          <p className="text-low">No artifacts yet.</p>
        )}
        <ul className="space-y-base">
          {filteredGroups.map((group) => {
            const issue = issues.get(group.issueId);
            const label = issue
              ? `${issue.simple_id} ${issue.title}`
              : metadataLoading || metadataError
                ? group.issueId
                : `Orphan · ${group.issueId}`;
            return (
              <li key={group.issueId}>
                <IssueArtifactCard
                  issueId={group.issueId}
                  files={group.files}
                  issue={issue}
                  projectName={
                    issue ? projectNames.get(issue.project_id) : undefined
                  }
                  label={label}
                  view={view}
                  busy={busy}
                  onRemove={(id, lbl) => void remove(id, lbl)}
                  onOpenFile={(id, file, trigger) => {
                    returnFocus.current = trigger;
                    setSelection({ issueId: id, file });
                  }}
                />
              </li>
            );
          })}
        </ul>
        <ArtifactLightbox
          issueId={selection?.issueId ?? ''}
          selected={selection?.file ?? null}
          navigableFiles={
            selection ? ((artifacts ?? {})[selection.issueId] ?? []) : []
          }
          returnFocus={returnFocus}
          setSelected={selectPreview}
        />
      </div>
    </main>
  );
}

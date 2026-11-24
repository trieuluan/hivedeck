import { useCallback, useRef, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
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

export function ArtifactsDashboard() {
  const { data: artifacts, isLoading, error } = useArtifacts();
  const projects = useProjects();
  const client = useQueryClient();
  const [sort, setSort] = useState<'date' | 'size'>('date');
  const [view, setView] = useState<'grid' | 'list'>('grid');
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
  const groups = artifactGroups(
    (artifacts ?? {}) as Record<string, ArtifactFile[]>,
    sort
  );
  const total = groups.reduce((sum, group) => sum + group.total, 0);

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
              File từ các card và lần chạy · {size(total)}
            </p>
          </div>
          <div
            role="group"
            aria-label="Kiểu hiển thị"
            className="flex gap-half"
          >
            {(['grid', 'list'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={view === mode}
                onClick={() => setView(mode)}
                className={`rounded px-base py-half focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${view === mode ? 'bg-brand text-white' : 'bg-secondary text-normal'}`}
              >
                {mode === 'grid' ? 'Grid' : 'List'}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-half">
            Sort by{' '}
            <select
              value={sort}
              onChange={(event) =>
                setSort(event.target.value as 'date' | 'size')
              }
              className="rounded border bg-secondary p-half"
            >
              <option value="date">Newest</option>
              <option value="size">Size</option>
            </select>
          </label>
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
        {!isLoading && !error && groups.length === 0 && (
          <p className="text-low">No artifacts yet.</p>
        )}
        <ul className="space-y-base">
          {groups.map((group) => {
            const issue = issues.get(group.issueId);
            const label = issue
              ? `${issue.simple_id} ${issue.title}`
              : metadataLoading || metadataError
                ? group.issueId
                : `Orphan · ${group.issueId}`;
            const executions = executionGroups(group.files);
            return (
              <li key={group.issueId}>
                <div className="space-y-base">
                  {Array.from(executions, ([execution, files]) => (
                    <article
                      key={execution}
                      className="space-y-base rounded-lg bg-panel p-base sm:p-double"
                    >
                      <header className="flex flex-wrap items-start justify-between gap-base">
                        <div className="min-w-0">
                          <p className="font-semibold text-brand">
                            {issue?.simple_id ?? 'Orphan'}
                          </p>
                          <h2 className="break-words text-lg font-semibold text-high">
                            {issue?.title ?? label}
                          </h2>
                          <p className="text-low" title={execution}>
                            Execution {execution.slice(0, 8)} · {files.length}{' '}
                            {files.length === 1 ? 'file' : 'files'} ·{' '}
                            {new Date(
                              files.reduce(
                                (latest, file) =>
                                  Date.parse(file.created_at) >
                                  Date.parse(latest)
                                    ? file.created_at
                                    : latest,
                                files[0].created_at
                              )
                            ).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-base">
                          {issue && (
                            <a
                              className="rounded border border-border px-base py-half text-high hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                              href={`/projects/${issue.project_id}/issues/${issue.id}?tab=artifacts`}
                            >
                              Mở card ↗
                            </a>
                          )}
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void remove(group.issueId, label)}
                            className="px-half py-half text-low hover:text-error disabled:opacity-50"
                          >
                            {busy === group.issueId
                              ? 'Deleting…'
                              : 'Xóa card artifacts'}
                          </button>
                        </div>
                      </header>
                      <div
                        className={
                          view === 'grid'
                            ? 'grid grid-cols-2 gap-base md:grid-cols-3'
                            : 'max-w-3xl divide-y divide-border'
                        }
                      >
                        {files.map((file) => {
                          const kind = previewKind(file);
                          return (
                            <div
                              key={file.path}
                              className={
                                view === 'list'
                                  ? 'flex items-center gap-base py-half'
                                  : 'min-w-0'
                              }
                            >
                              <button
                                type="button"
                                aria-label={`Open ${file.name}`}
                                onClick={(event) => (
                                  (returnFocus.current = event.currentTarget),
                                  setSelection({ issueId: group.issueId, file })
                                )}
                                className={
                                  view === 'list'
                                    ? 'flex min-w-0 flex-1 items-center gap-base text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'
                                    : 'block w-full min-w-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'
                                }
                              >
                                <span
                                  className={`flex shrink-0 items-center justify-center overflow-hidden rounded bg-secondary text-low ${view === 'list' ? 'h-14 w-20' : 'h-36 w-full sm:h-44'}`}
                                >
                                  {kind === 'image' ? (
                                    <img
                                      src={fileUrl(group.issueId, file.path)}
                                      alt=""
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <span className="text-lg font-semibold">
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
                                <span className="block min-w-0 py-half">
                                  <span className="block break-all font-medium text-high">
                                    {file.name}
                                  </span>
                                  <span className="block text-low">
                                    {kind.toUpperCase()} · {size(file.size)}
                                  </span>
                                </span>
                              </button>
                              <a
                                href={fileUrl(group.issueId, file.path)}
                                download={file.name}
                                aria-label={`Download ${file.name}`}
                                className="text-low hover:text-high"
                              >
                                Tải xuống
                              </a>
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  ))}
                </div>
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

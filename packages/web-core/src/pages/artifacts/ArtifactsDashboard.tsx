import { useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import type { Issue } from 'shared/remote-types';
import { useProjects } from '@/shared/hooks/useProjects';
import { makeRequest } from '@/shared/lib/remoteApi';
import { fileUrl, size, useArtifacts } from '@/pages/kanban/IssueArtifacts';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import { artifactGroups, type ArtifactFile } from './groups';

export function ArtifactsDashboard() {
  const { data: artifacts, isLoading, error } = useArtifacts();
  const projects = useProjects();
  const client = useQueryClient();
  const [sort, setSort] = useState<'date' | 'size'>('date');
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
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
            <p className="text-low">Total storage: {size(total)}</p>
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
        <ul className="divide-y rounded border border-border">
          {groups.map((group) => {
            const issue = issues.get(group.issueId);
            const label = issue
              ? `${issue.simple_id} ${issue.title}`
              : metadataLoading || metadataError
                ? group.issueId
                : `Orphan · ${group.issueId}`;
            return (
              <li
                key={group.issueId}
                className="flex items-center gap-base p-base"
              >
                {group.image ? (
                  <img
                    className="size-14 shrink-0 rounded object-cover"
                    src={fileUrl(group.issueId, group.image.path)}
                    alt=""
                  />
                ) : (
                  <div className="size-14 shrink-0 rounded bg-secondary" />
                )}
                <div className="min-w-0 flex-1">
                  {issue ? (
                    <a
                      className="block truncate font-medium text-high hover:underline"
                      href={`/projects/${issue.project_id}/issues/${issue.id}?tab=artifacts`}
                    >
                      {label}
                    </a>
                  ) : (
                    <p className="break-all font-medium text-high">{label}</p>
                  )}
                  <p className="text-low">
                    {group.files.length}{' '}
                    {group.files.length === 1 ? 'file' : 'files'} ·{' '}
                    {size(group.total)} ·{' '}
                    {group.latest
                      ? new Date(group.latest).toLocaleString()
                      : 'Unknown date'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void remove(group.issueId, label)}
                  className="rounded border px-base py-half text-error disabled:opacity-50"
                >
                  {busy === group.issueId ? 'Deleting…' : 'Delete'}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}

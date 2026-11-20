import type { Workspace } from 'shared/remote-types';

/**
 * Deterministically pick the "current run" workspace out of all workspaces
 * linked to a card, for rendering that run's live pipeline progress.
 *
 * An issue can have many linked workspaces (re-runs, experiments). The
 * linked-workspace API shape (`shared/remote-types.ts` `Workspace`) has no
 * `is_running` flag, so "newest linked, non-archived run" is the
 * deterministic proxy for "the active run": newest by `created_at` desc,
 * tie-broken by `updated_at` desc then `id` desc — matching the API's own
 * `ORDER BY created_at DESC`.
 *
 * Returns `null` when there is no non-archived workspace to pick.
 */
export function selectActiveWorkspace(
  workspaces: readonly Workspace[]
): Workspace | null {
  let best: Workspace | null = null;
  for (const ws of workspaces) {
    if (ws.archived) continue;
    if (best === null || compareWorkspaceRecency(ws, best) > 0) {
      best = ws;
    }
  }
  return best;
}

/** Positive when `a` is more recent (should sort first) than `b`. */
export function compareWorkspaceRecency(a: Workspace, b: Workspace): number {
  const createdDiff = Date.parse(a.created_at) - Date.parse(b.created_at);
  if (createdDiff !== 0) return createdDiff;
  const updatedDiff = Date.parse(a.updated_at) - Date.parse(b.updated_at);
  if (updatedDiff !== 0) return updatedDiff;
  return a.id.localeCompare(b.id);
}

type WorkspaceWithCodeChanges = Workspace & {
  commits_ahead?: number | null;
};

/**
 * Pick the workspace that should drive a card's code-based action (Merge vs
 * Accept). Prefer the newest linked, non-archived workspace with code changes
 * (`files_changed > 0` or `commits_ahead > 0`). If no workspace has code
 * changes, fall back to the newest linked, non-archived workspace so
 * research/debug cards still get an action.
 *
 * The linked-workspace list is ordered newest-first by the API, but callers
 * must not rely on array order; recency is compared explicitly here.
 */
export function selectCardActionWorkspace(
  workspaces: readonly WorkspaceWithCodeChanges[],
  getCodeChanges?: (workspace: WorkspaceWithCodeChanges) => number
): WorkspaceWithCodeChanges | null {
  let best: WorkspaceWithCodeChanges | null = null;
  let bestHasCode = false;

  for (const ws of workspaces) {
    if (ws.archived) continue;
    const hasCode =
      (getCodeChanges?.(ws) ??
        (ws.files_changed ?? 0) + (ws.commits_ahead ?? 0)) > 0;
    if (
      best === null ||
      (hasCode && !bestHasCode) ||
      (hasCode === bestHasCode && compareWorkspaceRecency(ws, best) > 0)
    ) {
      best = ws;
      bestHasCode = hasCode;
    }
  }

  return best;
}

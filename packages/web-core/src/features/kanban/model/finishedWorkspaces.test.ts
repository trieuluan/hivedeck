import { describe, expect, it } from 'vitest';
import type { Workspace as RemoteWorkspace } from 'shared/remote-types';
import {
  collectLinkedWorkspaceCleanups,
  findFinishedCleanableWorkspaceIds,
} from './finishedWorkspaces';

function makeLink(issueId: string, localId: string): RemoteWorkspace {
  return {
    id: `rw-${localId}`,
    project_id: 'proj-1',
    owner_user_id: 'local',
    issue_id: issueId,
    local_workspace_id: localId,
    name: localId,
    archived: false,
    files_changed: 0,
    lines_added: 0,
    lines_removed: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

describe('findFinishedCleanableWorkspaceIds', () => {
  const statuses = [
    { id: 's-todo', name: 'Todo', is_terminal: false },
    { id: 's-done', name: 'Done', is_terminal: true },
    { id: 's-cancel', name: 'Cancelled', is_terminal: true },
  ];

  const issues = [
    { id: 'i-todo', status_id: 's-todo' },
    { id: 'i-done', status_id: 's-done' },
    { id: 'i-cancel', status_id: 's-cancel' },
  ];

  const remoteWorkspaces = [
    makeLink('i-todo', 'ws-todo'),
    makeLink('i-done', 'ws-done-free'),
    makeLink('i-done', 'ws-done-pinned'),
    makeLink('i-cancel', 'ws-cancel-free'),
    makeLink('i-cancel', 'ws-orch'),
  ];

  const localWorkspaces = [
    { id: 'ws-todo', isPinned: false, kind: null },
    { id: 'ws-done-free', isPinned: false, kind: null },
    { id: 'ws-done-pinned', isPinned: true, kind: null },
    { id: 'ws-cancel-free', isPinned: false, kind: null },
    { id: 'ws-orch', isPinned: false, kind: 'orchestrator' as const },
  ];

  it('returns only non-pinned default workspaces on Done or Cancelled cards', () => {
    expect(
      findFinishedCleanableWorkspaceIds({
        issues,
        statuses,
        remoteWorkspaces,
        localWorkspaces,
      })
    ).toEqual(['ws-done-free', 'ws-cancel-free']);
  });

  it('counts pinned separately in collectLinkedWorkspaceCleanups', () => {
    const localById = new Map(localWorkspaces.map((w) => [w.id, w]));
    expect(
      collectLinkedWorkspaceCleanups({
        issueIds: ['i-done'],
        remoteWorkspaces,
        localWorkspacesById: localById,
      })
    ).toEqual({
      cleanableIds: ['ws-done-free'],
      pinnedCount: 1,
    });
  });
});

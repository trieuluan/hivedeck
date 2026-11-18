import type {
  Issue,
  ProjectStatus,
  Workspace as RemoteWorkspace,
} from 'shared/remote-types';
import type { SidebarWorkspace } from '@/shared/hooks/useWorkspaces';
import { isCancelledStatusName, isDoneStatus } from './useCollapsedStatuses';

export function isFinishedStatus(status: {
  name: string;
  is_terminal?: boolean;
}): boolean {
  return isDoneStatus(status) || isCancelledStatusName(status.name);
}

export function collectLinkedWorkspaceCleanups(args: {
  issueIds: readonly string[];
  remoteWorkspaces: readonly RemoteWorkspace[];
  localWorkspacesById: ReadonlyMap<
    string,
    Pick<SidebarWorkspace, 'id' | 'isPinned' | 'kind'>
  >;
}): { cleanableIds: string[]; pinnedCount: number } {
  const issueIdSet = new Set(args.issueIds);
  const seen = new Set<string>();
  const cleanableIds: string[] = [];
  let pinnedCount = 0;

  for (const link of args.remoteWorkspaces) {
    if (
      !link.issue_id ||
      !issueIdSet.has(link.issue_id) ||
      !link.local_workspace_id
    ) {
      continue;
    }
    if (seen.has(link.local_workspace_id)) continue;
    seen.add(link.local_workspace_id);

    const local = args.localWorkspacesById.get(link.local_workspace_id);
    if (!local) continue;
    if (local.kind === 'orchestrator' || local.kind === 'recurrent') continue;

    if (local.isPinned) {
      pinnedCount += 1;
    } else {
      cleanableIds.push(local.id);
    }
  }

  return { cleanableIds, pinnedCount };
}

export function findFinishedCleanableWorkspaceIds(args: {
  issues: readonly Pick<Issue, 'id' | 'status_id'>[];
  statuses: readonly Pick<ProjectStatus, 'id' | 'name' | 'is_terminal'>[];
  remoteWorkspaces: readonly RemoteWorkspace[];
  localWorkspaces: readonly Pick<
    SidebarWorkspace,
    'id' | 'isPinned' | 'kind'
  >[];
  statusIdFilter?: string;
}): string[] {
  const finishedStatusIds = new Set<string>();
  for (const status of args.statuses) {
    if (args.statusIdFilter && status.id !== args.statusIdFilter) continue;
    if (isFinishedStatus(status)) {
      finishedStatusIds.add(status.id);
    }
  }
  if (finishedStatusIds.size === 0) return [];

  const finishedIssueIds = args.issues
    .filter((issue) => finishedStatusIds.has(issue.status_id))
    .map((issue) => issue.id);
  if (finishedIssueIds.length === 0) return [];

  const localById = new Map(args.localWorkspaces.map((w) => [w.id, w]));
  return collectLinkedWorkspaceCleanups({
    issueIds: finishedIssueIds,
    remoteWorkspaces: args.remoteWorkspaces,
    localWorkspacesById: localById,
  }).cleanableIds;
}

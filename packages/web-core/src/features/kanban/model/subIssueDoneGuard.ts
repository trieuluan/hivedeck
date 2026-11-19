import type { TFunction } from 'i18next';
import type { Issue, ProjectStatus } from 'shared/remote-types';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import { isCancelledStatusName, isDoneStatus } from './useCollapsedStatuses';
import { isFinishedStatus } from './finishedWorkspaces';

export interface OpenSubIssueSummary {
  id: string;
  simpleId: string;
  title: string;
  statusName: string;
}

export function isDoneMoveTargetStatus(
  status: Pick<ProjectStatus, 'name' | 'is_terminal'> | undefined
): boolean {
  if (!status) return false;
  return isDoneStatus(status) && !isCancelledStatusName(status.name);
}

export function getOpenSubIssuesForDoneMove(
  issueId: string,
  targetStatusId: string,
  issues: ReadonlyArray<
    Pick<Issue, 'id' | 'simple_id' | 'title' | 'status_id' | 'parent_issue_id'>
  >,
  statuses: ReadonlyArray<Pick<ProjectStatus, 'id' | 'name' | 'is_terminal'>>
): OpenSubIssueSummary[] {
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const targetStatus = statusById.get(targetStatusId);
  if (!isDoneMoveTargetStatus(targetStatus)) return [];

  const open: OpenSubIssueSummary[] = [];
  for (const issue of issues) {
    if (issue.parent_issue_id !== issueId) continue;
    const status = statusById.get(issue.status_id);
    if (status && isFinishedStatus(status)) continue;
    open.push({
      id: issue.id,
      simpleId: issue.simple_id,
      title: issue.title,
      statusName: status?.name ?? 'Open',
    });
  }
  return open;
}

export async function showOpenSubIssuesBlockedDialog(
  openSubIssues: ReadonlyArray<OpenSubIssueSummary>,
  t: TFunction
): Promise<void> {
  const list = openSubIssues
    .map((sub) => `• ${sub.simpleId} (${sub.statusName}) — ${sub.title}`)
    .join('\n');
  await ConfirmDialog.show({
    title: t('tasks:ship.openSubIssuesTitle', {
      defaultValue: 'Cannot move to Done while sub-issues are open',
    }),
    message: t('tasks:ship.openSubIssuesMessage', {
      defaultValue: 'Finish or cancel these sub-issues first:\n{{list}}',
      list,
    }),
    confirmText: t('common:ok'),
    showCancelButton: false,
    variant: 'destructive',
  });
}

import { describe, expect, it, vi } from 'vitest';

vi.mock('@vibe/ui/components/ConfirmDialog', () => ({
  ConfirmDialog: { show: vi.fn() },
}));

import {
  getOpenSubIssuesForDoneMove,
  isDoneMoveTargetStatus,
} from './subIssueDoneGuard';

const STATUSES = [
  { id: 'todo', name: 'Todo', is_terminal: false },
  { id: 'prog', name: 'In Progress', is_terminal: false },
  { id: 'rev', name: 'In Review', is_terminal: false },
  { id: 'done', name: 'Done', is_terminal: true },
  { id: 'cancel', name: 'Cancelled', is_terminal: true },
];

describe('isDoneMoveTargetStatus', () => {
  it('matches Done but excludes Cancelled and open statuses', () => {
    expect(isDoneMoveTargetStatus(STATUSES[3])).toBe(true);
    expect(isDoneMoveTargetStatus(STATUSES[4])).toBe(false);
    expect(isDoneMoveTargetStatus(STATUSES[0])).toBe(false);
    expect(isDoneMoveTargetStatus(undefined)).toBe(false);
  });
});

describe('getOpenSubIssuesForDoneMove', () => {
  const issues = [
    {
      id: 'parent',
      simple_id: 'HIVE-1',
      title: 'Parent',
      status_id: 'rev',
      parent_issue_id: null,
    },
    {
      id: 'c1',
      simple_id: 'HIVE-2',
      title: 'Sub Todo',
      status_id: 'todo',
      parent_issue_id: 'parent',
    },
    {
      id: 'c2',
      simple_id: 'HIVE-3',
      title: 'Sub Done',
      status_id: 'done',
      parent_issue_id: 'parent',
    },
    {
      id: 'c3',
      simple_id: 'HIVE-4',
      title: 'Sub Cancelled',
      status_id: 'cancel',
      parent_issue_id: 'parent',
    },
  ];

  it('returns only unfinished sub-issues when moving to Done', () => {
    expect(
      getOpenSubIssuesForDoneMove('parent', 'done', issues, STATUSES)
    ).toEqual([
      {
        id: 'c1',
        simpleId: 'HIVE-2',
        title: 'Sub Todo',
        statusName: 'Todo',
      },
    ]);
  });

  it('allows moving parent to Cancelled or In Progress even with open sub-issues', () => {
    expect(
      getOpenSubIssuesForDoneMove('parent', 'cancel', issues, STATUSES)
    ).toEqual([]);
    expect(
      getOpenSubIssuesForDoneMove('parent', 'prog', issues, STATUSES)
    ).toEqual([]);
  });

  it('returns empty once all sub-issues are Done or Cancelled', () => {
    const closed = issues.map((i) =>
      i.id === 'c1' ? { ...i, status_id: 'done' } : i
    );
    expect(
      getOpenSubIssuesForDoneMove('parent', 'done', closed, STATUSES)
    ).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import type { Issue } from 'shared/remote-types';

import {
  isRevisionApproved,
  revisionApprovalMatchesHead,
} from './InReviewApprovalPopup';

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1',
    project_id: 'project-1',
    issue_number: 1,
    simple_id: 'PROJ-1',
    status_id: 'status-review',
    title: 'Test',
    description: null,
    priority: null,
    start_date: null,
    target_date: null,
    completed_at: null,
    sort_order: 1,
    parent_issue_id: null,
    parent_issue_sort_order: null,
    extension_metadata: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('revision approval gating', () => {
  it('requires revision scope, owner and SHA', () => {
    expect(
      isRevisionApproved(
        issue({
          approval_scope: 'issue',
          approval_owner: 'owner',
          approval_revision: 'abc',
        })
      )
    ).toBe(false);

    expect(
      isRevisionApproved(
        issue({
          approval_scope: 'revision',
          approval_owner: 'owner',
          approval_revision: 'abc',
        })
      )
    ).toBe(true);
  });

  it('only unlocks git actions when the approved SHA matches the workspace head', () => {
    const approved = issue({
      approval_scope: 'revision',
      approval_owner: 'owner',
      approval_revision: 'abc123',
    });

    expect(revisionApprovalMatchesHead(approved, 'abc123')).toBe(true);
    expect(revisionApprovalMatchesHead(approved, 'def456')).toBe(false);
    expect(revisionApprovalMatchesHead(approved, null)).toBe(false);
  });
});

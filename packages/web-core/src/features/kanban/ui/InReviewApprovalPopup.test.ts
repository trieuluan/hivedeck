import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Issue } from 'shared/remote-types';
import { kanbanApi } from '@/shared/lib/api';
import * as transport from '@/shared/lib/localApiTransport';

import {
  isRevisionApproved,
  revisionApprovalMatchesHead,
  revisionProposal,
  RevisionProposalPanel,
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
  it('keeps direct UI approval and proposal confirmation separate from git', async () => {
    const request = vi
      .spyOn(transport, 'makeLocalApiRequest')
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ success: true, data: { data: issue(), txid: 1 } }),
            { status: 200 }
          )
      );
    try {
      await kanbanApi.approveIssue('issue-1', {
        owner: 'owner',
        scope: 'revision',
        revision: 'abc123',
      });
      await kanbanApi.confirmRevisionProposal('issue-1', {
        owner: 'owner',
        proposal_id: 'p1',
        revision: 'abc123',
      });
      expect(request.mock.calls.map(([url]) => url)).toEqual([
        '/api/issues/issue-1/approve',
        '/api/issues/issue-1/approval-proposal/confirm',
      ]);
      expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({
        owner: 'owner',
        scope: 'revision',
        revision: 'abc123',
      });
    } finally {
      request.mockRestore();
    }
  });
  it('renders pending proposal and disables confirmation for a changed head', () => {
    const pending = issue({
      extension_metadata: {
        hivedeck_approval_proposal: {
          id: 'p1',
          revision: 'abc123',
          reason: 'Ready for review',
        },
      },
    });
    const proposal = revisionProposal(pending)!;
    expect(revisionApprovalMatchesHead(pending, 'abc123')).toBe(false);
    expect(
      revisionApprovalMatchesHead(
        {
          ...pending,
          approval_owner: 'owner',
          approval_scope: 'revision',
          approval_revision: 'abc123',
        },
        'abc123'
      )
    ).toBe(false);
    const render = (headOid: string) =>
      renderToStaticMarkup(
        createElement(RevisionProposalPanel, {
          proposal,
          headOid,
          busy: false,
          onConfirm: () => {},
        })
      );
    const matching = render('abc123');
    expect(matching).toContain('Ready for review');
    expect(matching).toContain('abc123');
    expect(matching).not.toContain('disabled=""');
    expect(render('def456')).toContain('disabled=""');
  });
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

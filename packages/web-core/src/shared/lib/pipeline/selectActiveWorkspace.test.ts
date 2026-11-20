import { describe, expect, it } from 'vitest';
import type { Workspace } from 'shared/remote-types';
import {
  selectActiveWorkspace,
  selectCardActionWorkspace,
} from './selectActiveWorkspace';

function ws(
  overrides: Partial<Workspace> & { id: string; commits_ahead?: number | null }
): Workspace & { commits_ahead?: number | null } {
  return {
    id: overrides.id,
    project_id: 'project-1',
    issue_id: 'issue-1',
    local_workspace_id: overrides.id,
    name: null,
    archived: false,
    files_changed: null,
    commits_ahead: null,
    lines_added: null,
    lines_removed: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('selectActiveWorkspace', () => {
  it('returns null for an empty list', () => {
    expect(selectActiveWorkspace([])).toBeNull();
  });

  it('picks the newest non-archived workspace by created_at desc', () => {
    const older = ws({ id: 'a', created_at: '2026-01-01T00:00:00Z' });
    const newer = ws({ id: 'b', created_at: '2026-01-02T00:00:00Z' });
    expect(selectActiveWorkspace([older, newer])).toBe(newer);
    expect(selectActiveWorkspace([newer, older])).toBe(newer);
  });

  it('excludes archived workspaces even if newer', () => {
    const active = ws({ id: 'a', created_at: '2026-01-01T00:00:00Z' });
    const archivedNewer = ws({
      id: 'b',
      created_at: '2026-01-02T00:00:00Z',
      archived: true,
    });
    expect(selectActiveWorkspace([active, archivedNewer])).toBe(active);
  });

  it('returns null when every workspace is archived', () => {
    const a = ws({ id: 'a', archived: true });
    const b = ws({ id: 'b', archived: true });
    expect(selectActiveWorkspace([a, b])).toBeNull();
  });

  it('ties on created_at are broken by updated_at desc', () => {
    const staler = ws({
      id: 'a',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
    const fresher = ws({
      id: 'b',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    });
    expect(selectActiveWorkspace([staler, fresher])).toBe(fresher);
  });

  it('ties on created_at and updated_at are broken by id', () => {
    const same = '2026-01-01T00:00:00Z';
    const first = ws({ id: 'aaa', created_at: same, updated_at: same });
    const second = ws({ id: 'bbb', created_at: same, updated_at: same });
    // Deterministic regardless of input order.
    expect(selectActiveWorkspace([first, second])).toBe(second);
    expect(selectActiveWorkspace([second, first])).toBe(second);
  });
});

describe('selectCardActionWorkspace', () => {
  it('picks the newest workspace with code changes when others are empty', () => {
    const emptyOlder = ws({
      id: 'a',
      created_at: '2026-01-01T00:00:00Z',
      files_changed: 0,
    });
    const emptyNewer = ws({
      id: 'b',
      created_at: '2026-01-03T00:00:00Z',
      files_changed: 0,
    });
    const code = ws({
      id: 'c',
      created_at: '2026-01-02T00:00:00Z',
      files_changed: 3,
    });
    expect(selectCardActionWorkspace([emptyOlder, emptyNewer, code])).toBe(
      code
    );
  });

  it('falls back to the newest workspace when none have code changes', () => {
    const emptyOlder = ws({
      id: 'a',
      created_at: '2026-01-01T00:00:00Z',
      files_changed: 0,
    });
    const emptyNewer = ws({
      id: 'b',
      created_at: '2026-01-02T00:00:00Z',
      files_changed: 0,
    });
    expect(selectCardActionWorkspace([emptyOlder, emptyNewer])).toBe(
      emptyNewer
    );
  });

  it('returns the only workspace unchanged', () => {
    const only = ws({ id: 'only', files_changed: 0 });
    expect(selectCardActionWorkspace([only])).toBe(only);
  });

  it('picks an older workspace with diff over a newer empty workspace', () => {
    const newerEmpty = ws({
      id: 'newer',
      created_at: '2026-01-02T00:00:00Z',
      files_changed: 0,
    });
    const olderCode = ws({
      id: 'older',
      created_at: '2026-01-01T00:00:00Z',
      files_changed: 1,
    });
    expect(selectCardActionWorkspace([newerEmpty, olderCode])).toBe(olderCode);
  });

  it('picks the newest when several workspaces have diffs', () => {
    const olderCode = ws({
      id: 'older',
      created_at: '2026-01-01T00:00:00Z',
      files_changed: 2,
    });
    const newerCode = ws({
      id: 'newer',
      created_at: '2026-01-02T00:00:00Z',
      files_changed: 5,
    });
    expect(selectCardActionWorkspace([olderCode, newerCode])).toBe(newerCode);
    expect(selectCardActionWorkspace([newerCode, olderCode])).toBe(newerCode);
  });

  it('treats commits_ahead as code changes', () => {
    const emptyNewer = ws({
      id: 'newer',
      created_at: '2026-01-02T00:00:00Z',
      files_changed: 0,
      commits_ahead: 0,
    });
    const committedOlder = ws({
      id: 'older',
      created_at: '2026-01-01T00:00:00Z',
      files_changed: 0,
      commits_ahead: 1,
    });
    expect(selectCardActionWorkspace([emptyNewer, committedOlder])).toBe(
      committedOlder
    );
  });
});

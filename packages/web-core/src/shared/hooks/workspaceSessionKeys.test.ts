import { describe, expect, it } from 'vitest';
import { workspaceSessionKeys } from './workspaceSessionKeys';

describe('workspaceSessionKeys', () => {
  // Starting a captain invalidates `all` so every workspace's session list
  // (keyed by byWorkspace) refetches and the chat switches to the new session.
  it('all is a prefix of every per-workspace key', () => {
    const key = workspaceSessionKeys.byWorkspace('ws-1', 'host-1');
    expect(key.slice(0, workspaceSessionKeys.all.length)).toEqual([
      ...workspaceSessionKeys.all,
    ]);
  });
});

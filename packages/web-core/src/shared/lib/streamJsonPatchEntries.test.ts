import { describe, it, expect } from 'vitest';
import type { Operation } from 'rfc6902';
import { applyUpsertPatch } from './jsonPatch';
import { dedupeOps } from './streamJsonPatchEntries';

describe('dedupeOps', () => {
  it('preserves first-seen path order and keeps op: add when a new entry is updated in the same batch', () => {
    const ops: Operation[] = [
      { op: 'add', path: '/entries/1', value: 'tool-1-created' },
      { op: 'add', path: '/entries/2', value: 'tool-2-created' },
      { op: 'replace', path: '/entries/1', value: 'tool-1-completed' },
    ];

    const deduped = dedupeOps(ops);
    expect(deduped).toEqual([
      { op: 'add', path: '/entries/1', value: 'tool-1-completed' },
      { op: 'add', path: '/entries/2', value: 'tool-2-created' },
    ]);

    const state = { entries: ['entry-0'] };
    applyUpsertPatch(state, deduped);
    expect(state.entries).toEqual([
      'entry-0',
      'tool-1-completed',
      'tool-2-created',
    ]);
  });

  it('does not duplicate streaming assistant messages across subsequent batches after interleaved tool updates', () => {
    const state = { entries: ['entry-0'] };

    // Frame 1: two entries added and the first one updated in the same rAF batch
    applyUpsertPatch(
      state,
      dedupeOps([
        { op: 'add', path: '/entries/1', value: 'tool-1-created' },
        { op: 'add', path: '/entries/2', value: 'tool-2-created' },
        { op: 'replace', path: '/entries/1', value: 'tool-1-completed' },
      ])
    );

    // Frame 2: assistant message starts streaming at /entries/3
    applyUpsertPatch(
      state,
      dedupeOps([
        { op: 'add', path: '/entries/3', value: 'Đúng:' },
        { op: 'replace', path: '/entries/3', value: 'Đúng: routing' },
      ])
    );

    // Frame 3: assistant message continues streaming at /entries/3
    applyUpsertPatch(
      state,
      dedupeOps([
        {
          op: 'replace',
          path: '/entries/3',
          value: 'Đúng: routing hiện chỉ áp dụng',
        },
      ])
    );

    // Frame 4: assistant message finishes at /entries/3
    applyUpsertPatch(
      state,
      dedupeOps([
        {
          op: 'replace',
          path: '/entries/3',
          value: 'Đúng: routing hiện chỉ áp dụng Claude Code.',
        },
      ])
    );

    expect(state.entries).toEqual([
      'entry-0',
      'tool-1-completed',
      'tool-2-created',
      'Đúng: routing hiện chỉ áp dụng Claude Code.',
    ]);
  });

  it('does not collapse consecutive remove operations', () => {
    const ops: Operation[] = [
      { op: 'remove', path: '/entries/0' },
      { op: 'remove', path: '/entries/0' },
      { op: 'add', path: '/entries/0', value: 'replayed' },
    ];

    expect(dedupeOps(ops)).toEqual(ops);
  });
});

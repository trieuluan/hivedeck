import { describe, expect, it } from 'vitest';
import type { AggregatedWorkGroup } from '@/shared/hooks/useConversationHistory/types';
import { summarizeWork } from './summarizeWork';

type Item = AggregatedWorkGroup['entries'][number];
const normalized = (entry_type: unknown): Item =>
  ({
    type: 'NORMALIZED_ENTRY',
    content: { timestamp: null, entry_type, content: '' },
    patchKey: 'k',
    executionProcessId: 'p',
  }) as unknown as Item;
const tool = (action_type: unknown) =>
  normalized({
    type: 'tool_use',
    tool_name: 'x',
    action_type,
    status: { status: 'success' },
  });

describe('summarizeWork', () => {
  it('counts steps by kind, edits by distinct file', () => {
    const counts = summarizeWork([
      normalized({ type: 'thinking' }),
      tool({ action: 'file_read', path: 'a' }),
      {
        type: 'AGGREGATED_GROUP',
        aggregationType: 'file_read',
        entries: [{}, {}],
        patchKey: 'g',
        executionProcessId: 'p',
      } as unknown as Item,
      tool({ action: 'command_run', command: 'ls' }),
      tool({ action: 'file_edit', path: 'a.ts', changes: [] }),
      tool({ action: 'file_edit', path: 'a.ts', changes: [] }),
      {
        type: 'AGGREGATED_DIFF_GROUP',
        filePath: 'b.ts',
        entries: [{}],
        patchKey: 'd',
        executionProcessId: 'p',
      } as unknown as Item,
      normalized({ type: 'thinking' }),
    ]);
    expect(counts).toEqual({ thinking: 1, read: 3, command: 1, edit: 2 });
  });
});

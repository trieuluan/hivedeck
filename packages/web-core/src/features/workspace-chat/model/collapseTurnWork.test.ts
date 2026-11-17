import { describe, expect, it } from 'vitest';
import type {
  AggregatedWorkGroup,
  DisplayEntry,
} from '@/shared/hooks/useConversationHistory/types';
import { collapseTurnWork } from './collapseTurnWork';

let n = 0;
function entry(entry_type: unknown, content = ''): DisplayEntry {
  n += 1;
  return {
    type: 'NORMALIZED_ENTRY',
    content: { timestamp: null, entry_type, content },
    patchKey: `k${n}`,
    executionProcessId: 'p1',
  } as unknown as DisplayEntry;
}
const user = (text = 'do it') => entry({ type: 'user_message' }, text);
const answer = (text = 'done') => entry({ type: 'assistant_message' }, text);
const thinking = () => entry({ type: 'thinking' }, 'hmm');
const tool = (status: unknown = { status: 'success' }) =>
  entry({
    type: 'tool_use',
    tool_name: 'Bash',
    action_type: { action: 'command_run', command: 'ls' },
    status,
  });
const edit = (path: string) =>
  entry({
    type: 'tool_use',
    tool_name: 'Edit',
    action_type: { action: 'file_edit', path, changes: [] },
    status: { status: 'success' },
  });
const types = (entries: DisplayEntry[]) =>
  entries.map((e) =>
    e.type === 'NORMALIZED_ENTRY' ? e.content.entry_type.type : e.type
  );

describe('collapseTurnWork', () => {
  it('collapses a finished turn to message, work, answer', () => {
    const turn = [user(), thinking(), tool(), edit('a.ts'), edit('b.ts')];
    const out = collapseTurnWork([...turn, answer()], {
      collapseLastTurn: true,
    });
    expect(types(out)).toEqual([
      'user_message',
      'AGGREGATED_WORK_GROUP',
      'assistant_message',
    ]);
    const group = out[1] as AggregatedWorkGroup;
    expect(group.toolCount).toBe(3);
    expect(group.editedFiles).toBe(2);
  });

  it('keeps the running turn expanded', () => {
    const entries = [user(), tool(), tool(), answer('first'), user(), tool()];
    const later = [...entries, tool()];
    const out = collapseTurnWork(later, { collapseLastTurn: false });
    expect(types(out)).toEqual([
      'user_message',
      'AGGREGATED_WORK_GROUP',
      'assistant_message',
      'user_message',
      'tool_use',
      'tool_use',
    ]);
  });

  it('treats earlier answers in a turn as progress notes', () => {
    const out = collapseTurnWork(
      [user(), answer('looking'), tool(), answer('final')],
      { collapseLastTurn: true }
    );
    expect(types(out)).toEqual([
      'user_message',
      'AGGREGATED_WORK_GROUP',
      'assistant_message',
    ]);
  });

  it('leaves approvals, errors and provider errors visible', () => {
    const out = collapseTurnWork(
      [
        user(),
        tool(),
        tool({ status: 'pending_approval', approval_id: 'x' }),
        tool(),
        answer('API Error: 503 usage limit'),
      ],
      { collapseLastTurn: true }
    );
    expect(types(out)).toEqual([
      'user_message',
      'tool_use',
      'tool_use',
      'tool_use',
      'assistant_message',
    ]);
  });

  it('does not wrap a single step', () => {
    const out = collapseTurnWork([user(), tool(), answer()], {
      collapseLastTurn: true,
    });
    expect(types(out)).toEqual([
      'user_message',
      'tool_use',
      'assistant_message',
    ]);
  });

  it('reuses an unchanged group object', () => {
    const entries = [user(), tool(), tool(), answer()];
    const first = collapseTurnWork(entries, { collapseLastTurn: true });
    const second = collapseTurnWork(entries, {
      collapseLastTurn: true,
      previous: first,
    });
    expect(second[1]).toBe(first[1]);
  });
});

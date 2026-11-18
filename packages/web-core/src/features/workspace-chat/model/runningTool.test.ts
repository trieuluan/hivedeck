import { describe, expect, it } from 'vitest';
import type { DisplayEntry } from '@/shared/hooks/useConversationHistory/types';
import { hasRunningTool } from './runningTool';

const tool = (status: string) =>
  ({
    type: 'NORMALIZED_ENTRY',
    content: {
      timestamp: null,
      content: '',
      entry_type: {
        type: 'tool_use',
        tool_name: 'Bash',
        action_type: { action: 'command_run', command: 'sleep 60' },
        status: { status },
      },
    },
    patchKey: 'k',
    executionProcessId: 'p',
  }) as unknown as DisplayEntry;
const text = {
  type: 'NORMALIZED_ENTRY',
  content: {
    timestamp: null,
    content: 'hi',
    entry_type: { type: 'assistant_message' },
  },
  patchKey: 't',
  executionProcessId: 'p',
} as unknown as DisplayEntry;

describe('hasRunningTool', () => {
  it('is true while the newest step is an unfinished tool call', () => {
    expect(hasRunningTool([text, tool('created')])).toBe(true);
  });
  it('is false once it finished, or when the newest entry is text', () => {
    expect(hasRunningTool([tool('success')])).toBe(false);
    expect(hasRunningTool([tool('created'), text])).toBe(false);
    expect(hasRunningTool([])).toBe(false);
  });
  it('looks inside grouped rows', () => {
    const group = {
      type: 'AGGREGATED_WORK_GROUP',
      entries: [tool('success'), tool('created')],
      patchKey: 'g',
      executionProcessId: 'p',
    } as unknown as DisplayEntry;
    expect(hasRunningTool([text, group])).toBe(true);
  });
});

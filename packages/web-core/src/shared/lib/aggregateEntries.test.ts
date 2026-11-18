import { describe, expect, it } from 'vitest';
import { aggregateConsecutiveEntries } from './aggregateEntries';
import type { PatchTypeWithKey } from '@/shared/hooks/useConversationHistory/types';

function makeFileReadEntry(
  patchKey: string,
  path: string,
  toolName = 'default.read'
): PatchTypeWithKey {
  return {
    type: 'NORMALIZED_ENTRY',
    patchKey,
    executionProcessId: 'proc-1',
    content: {
      timestamp: null,
      entry_type: {
        type: 'tool_use',
        tool_name: toolName,
        action_type: { action: 'file_read', path },
        status: { status: 'success' },
      },
      content: path,
    },
  } as PatchTypeWithKey;
}

describe('aggregateConsecutiveEntries', () => {
  it('keeps Claude image reads separate', () => {
    const image = makeFileReadEntry('image', '/tmp/a.png', 'Read');
    expect(
      aggregateConsecutiveEntries([
        makeFileReadEntry('read', 'a.ts', 'Read'),
        image,
        makeFileReadEntry('last', 'b.ts', 'Read'),
      ])
    ).toContain(image);
  });
  it('keeps view_image entries separate from regular file_read groups', () => {
    const entries = [
      makeFileReadEntry('read-1', 'src/app.ts'),
      makeFileReadEntry('img-1', 'assets/logo.png', 'view_image'),
      makeFileReadEntry('img-2', 'assets/icon.png', 'view_image'),
      makeFileReadEntry('read-2', 'src/index.ts'),
    ];

    const result = aggregateConsecutiveEntries(entries);

    expect(result).toHaveLength(4);
    expect(result[0].type).toBe('NORMALIZED_ENTRY');
    expect(result[1].type).toBe('NORMALIZED_ENTRY');
    expect(result[2].type).toBe('NORMALIZED_ENTRY');
    expect(result[3].type).toBe('NORMALIZED_ENTRY');
  });

  it('still groups consecutive non-view_image file reads', () => {
    const entries = [
      makeFileReadEntry('read-1', 'src/app.ts'),
      makeFileReadEntry('read-2', 'src/index.ts'),
    ];

    const result = aggregateConsecutiveEntries(entries);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('AGGREGATED_GROUP');
    expect((result[0] as { aggregationType: string }).aggregationType).toBe(
      'file_read'
    );
  });
});

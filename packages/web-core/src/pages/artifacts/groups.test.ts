import { describe, expect, it } from 'vitest';
import { artifactGroups, executionGroups, type ArtifactFile } from './groups';

describe('artifactGroups', () => {
  it('totals files, finds the first image, and sorts by date or size', () => {
    const file = (
      size: number,
      created_at: string,
      mime: string
    ): ArtifactFile => ({
      path: `${size}`,
      name: `${size}`,
      size,
      created_at,
      mime,
      execution_id: 'run',
    });
    const artifacts = {
      older: [
        file(8, '2026-01-01', 'text/plain'),
        file(4, '2026-01-02', 'image/png'),
      ],
      newer: [file(1, '2026-02-01', 'image/png')],
    };
    expect(
      artifactGroups(artifacts, 'date').map((group) => group.issueId)
    ).toEqual(['newer', 'older']);
    const bySize = artifactGroups(artifacts, 'size');
    expect(bySize.map((group) => group.issueId)).toEqual(['older', 'newer']);
    expect(bySize[0]).toMatchObject({
      total: 12,
      latest: '2026-01-02',
      image: { path: '4' },
    });
    expect(artifactGroups({}, 'size')).toEqual([]);
    expect(
      artifactGroups(
        {
          test: [
            file(1, '2026-01-01T00:00:00Z', 'text/plain'),
            file(2, '2026-01-01T00:00:00.100Z', 'text/plain'),
          ],
        },
        'date'
      )[0]?.latest
    ).toBe('2026-01-01T00:00:00.100Z');
  });
});

describe('executionGroups', () => {
  it('keeps files from different executions separate and preserves order', () => {
    const file = (execution_id: string, name: string): ArtifactFile => ({
      execution_id,
      name,
      path: name,
      mime: 'text/plain',
      size: 1,
      created_at: '',
    });
    const groups = executionGroups([
      file('run-1', 'a'),
      file('run-2', 'b'),
      file('run-1', 'c'),
      file('', 'd'),
    ]);
    expect([...groups.keys()]).toEqual(['run-1', 'run-2', 'Unknown']);
    expect(groups.get('run-1')?.map((item) => item.name)).toEqual(['a', 'c']);
  });
});

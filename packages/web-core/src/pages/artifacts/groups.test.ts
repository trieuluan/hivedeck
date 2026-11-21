import { describe, expect, it } from 'vitest';
import { artifactGroups, type ArtifactFile } from './groups';

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

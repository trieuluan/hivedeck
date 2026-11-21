import { describe, expect, it } from 'vitest';
import { fileUrl, outputs, size } from './IssueArtifacts';

describe('artifacts', () => {
  it('compares declared outputs with file extensions', () => {
    expect(outputs(null, [])).toEqual([]);
    expect(outputs('No outputs here', [])).toEqual([]);
    expect(
      outputs('Outputs: 3 × PNG (1024px), 1 x MP4', [
        { name: 'one.png' },
        { name: 'two.PNG' },
        { name: 'png.txt' },
      ])
    ).toEqual([
      { extension: 'PNG', expected: 3, actual: 2 },
      { extension: 'MP4', expected: 1, actual: 0 },
    ]);
  });
  it('encodes paths without changing their meaning', () => {
    const url = new URL(
      fileUrl('issue', 'run/a & b#c.png'),
      'http://localhost'
    );
    expect(url.pathname).toBe('/api/issues/issue/artifacts/file');
    expect(url.searchParams.get('path')).toBe('run/a & b#c.png');
  });

  it('formats file sizes', () => {
    expect(size(0)).toBe('0 B');
    expect(size(1024)).toBe('1.0 KB');
    expect(size(1048576)).toBe('1.0 MB');
  });
});

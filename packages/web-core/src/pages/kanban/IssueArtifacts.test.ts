import { describe, expect, it } from 'vitest';
import { fileUrl, size } from './IssueArtifacts';

describe('artifacts', () => {
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

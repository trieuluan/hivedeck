import { describe, expect, it } from 'vitest';
import {
  fileUrl,
  formatJsonContent,
  outputs,
  previewKind,
  size,
} from './IssueArtifacts';

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

  it('only previews supported extension and MIME combinations', () => {
    expect(previewKind({ name: 'report.md', mime: 'text/markdown' })).toBe(
      'markdown'
    );
    expect(previewKind({ name: 'report.md', mime: 'text/html' })).toBe(
      'unsupported'
    );
    expect(previewKind({ name: 'report.html', mime: 'text/html' })).toBe(
      'html'
    );
    expect(previewKind({ name: 'image.svg', mime: 'image/svg+xml' })).toBe(
      'unsupported'
    );
    expect(previewKind({ name: 'movie.mp4', mime: 'video/mp4' })).toBe('video');
    expect(
      previewKind({ name: 'analysis.jsonl', mime: 'application/octet-stream' })
    ).toBe('text');
    expect(
      previewKind({ name: 'vision.swift', mime: 'application/octet-stream' })
    ).toBe('text');
  });

  it('formats minified JSON and JSONL into readable multi-line blocks', () => {
    expect(formatJsonContent('data.json', '{"a":1,"b":[2,3]}')).toBe(
      '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}'
    );
    expect(
      formatJsonContent('analysis.jsonl', '{"id":1}\n{"id":2,"ok":true}\n')
    ).toBe('// #1\n{\n  "id": 1\n}\n\n// #2\n{\n  "id": 2,\n  "ok": true\n}');
  });
});

import { describe, expect, it } from 'vitest';
import { isClickableHref, sanitizeHref } from './ReadOnlyLinkPlugin';

describe('ReadOnlyLinkPlugin href policy', () => {
  it('rewrites local .hivedeck/artifacts file:// URLs to /api/issues/.../artifacts/file', () => {
    const fileUrl =
      'file:///Users/louis/.hivedeck/artifacts/81c2f344-be88-4208-93a2-52b6aca17ade/11f04665-b42a-43f4-ab5f-3ebc8506581d/mockup.html';
    const sanitized = sanitizeHref(fileUrl);
    expect(sanitized).toBe(
      '/api/issues/81c2f344-be88-4208-93a2-52b6aca17ade/artifacts/file?path=11f04665-b42a-43f4-ab5f-3ebc8506581d%2Fmockup.html'
    );
    expect(isClickableHref(sanitized)).toBe(true);
  });

  it('blocks non-artifact file:// URLs and dangerous protocols', () => {
    expect(sanitizeHref('file:///etc/passwd')).toBeUndefined();
    expect(sanitizeHref('javascript:alert(1)')).toBeUndefined();
    expect(sanitizeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined();
  });

  it('allows https and localhost http URLs', () => {
    expect(isClickableHref(sanitizeHref('https://example.com'))).toBe(true);
    expect(isClickableHref(sanitizeHref('http://localhost:3001/foo'))).toBe(true);
  });
});

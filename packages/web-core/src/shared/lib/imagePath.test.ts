import { describe, expect, it } from 'vitest';
import {
  hasParentSegment,
  isImagePath,
  isImageRead,
  workspaceImageUrl,
} from './imagePath';

describe('imagePath', () => {
  it('detects image extensions', () => {
    expect(isImagePath('/tmp/a.PNG')).toBe(true);
    expect(isImagePath('x/y.jpeg')).toBe(true);
    expect(isImagePath('x/y.svg')).toBe(false);
    expect(isImagePath('x/png')).toBe(false);
  });
  it('treats view_image and Read-on-image as image reads', () => {
    expect(isImageRead('view_image', 'file_read', 'noext')).toBe(true);
    expect(isImageRead('Read', 'file_read', '/a/b.png')).toBe(true);
    expect(isImageRead('Read', 'file_read', '/a/b.ts')).toBe(false);
    expect(isImageRead('Read', 'file_edit', '/a/b.png')).toBe(false);
  });
  it('flags parent segments', () => {
    expect(hasParentSegment('a/../b.png')).toBe(true);
    expect(hasParentSegment('/tmp/a..b.png')).toBe(false);
  });
  it('encodes the url', () => {
    expect(workspaceImageUrl('w', 's', '/tmp/a b.png')).toBe(
      '/api/workspaces/w/files?path=%2Ftmp%2Fa%20b.png&session_id=s'
    );
  });
});

import { describe, expect, it } from 'vitest';
import { isImageAttachment } from './is-image-attachment';

describe('isImageAttachment', () => {
  it('classifies plain local image links by path or MIME type', () => {
    expect(isImageAttachment('.vibe-attachments/photo.png')).toBe(true);
    expect(isImageAttachment('/api/attachments/123/file', 'scan.webp')).toBe(
      true
    );
    expect(
      isImageAttachment('.vibe-attachments/unknown', 'upload', 'image/png')
    ).toBe(true);
    expect(
      isImageAttachment(
        '.vibe-attachments/photo.png',
        'photo.png',
        'text/plain'
      )
    ).toBe(false);
    expect(isImageAttachment('.vibe-attachments/report.pdf')).toBe(false);
  });
});

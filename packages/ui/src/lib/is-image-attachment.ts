const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i;

// Display classification only; attachment nodes keep their original Markdown.
export function isImageAttachment(
  src: string,
  fileName?: string | null,
  mimeType?: string | null
): boolean {
  if (mimeType && mimeType !== 'application/octet-stream') {
    return mimeType.startsWith('image/');
  }
  return IMAGE_EXTENSION.test(fileName || '') || IMAGE_EXTENSION.test(src);
}

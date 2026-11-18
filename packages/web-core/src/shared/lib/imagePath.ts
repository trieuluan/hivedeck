const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|tiff?)$/i;

export function isImagePath(path: string): boolean {
  return IMAGE_EXT.test(path);
}

export function isImageRead(toolName: string, action: string, path: string) {
  return (
    action === 'file_read' && (toolName === 'view_image' || isImagePath(path))
  );
}

export function hasParentSegment(path: string): boolean {
  return path.split(/[\\/]/).some((part) => part === '..');
}

export function workspaceImageUrl(
  workspaceId: string,
  sessionId: string,
  path: string
): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/files?path=${encodeURIComponent(path)}&session_id=${encodeURIComponent(sessionId)}`;
}

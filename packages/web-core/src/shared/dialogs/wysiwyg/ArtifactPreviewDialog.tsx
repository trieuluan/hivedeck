import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { create, useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/shared/lib/modals';
import { ArtifactLightbox, type Artifact } from '@/pages/kanban/IssueArtifacts';

export interface ArtifactPreviewDialogProps {
  issueId: string;
  path: string;
}

function inferMimeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  if (lower.endsWith('.md') || lower.endsWith('.markdown'))
    return 'text/markdown';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.json')) return 'application/json';
  return 'text/plain';
}

function fallbackArtifact(path: string): Artifact {
  const parts = path.split('/').filter(Boolean);
  return {
    path,
    name: parts[parts.length - 1] ?? path,
    mime: inferMimeFromPath(path),
    size: 0,
    execution_id: parts[0] ?? '',
    created_at: new Date().toISOString(),
  };
}

const ArtifactPreviewDialogImpl = create<ArtifactPreviewDialogProps>(
  ({ issueId, path }) => {
    const modal = useModal();
    const returnFocus = useRef<HTMLElement>(null);

    const { data: files = [] } = useQuery({
      queryKey: ['artifacts', issueId],
      queryFn: async (): Promise<Artifact[]> => {
        const response = await fetch(`/api/issues/${issueId}/artifacts`);
        if (!response.ok) return [];
        const body = await response.json();
        return body.success ? (body.data as Artifact[]) : [];
      },
      enabled: modal.visible && Boolean(issueId),
    });

    const initial = useMemo(
      () => files.find((f) => f.path === path) ?? fallbackArtifact(path),
      [files, path]
    );
    const [selected, setSelected] = useState<Artifact | null>(initial);

    useEffect(() => {
      if (modal.visible) {
        setSelected(files.find((f) => f.path === path) ?? fallbackArtifact(path));
      }
    }, [modal.visible, files, path]);

    const navigableFiles = useMemo(() => {
      if (!selected) return [];
      const siblings = files.filter(
        (f) => f.execution_id === selected.execution_id
      );
      if (siblings.length > 0) return siblings;
      return files.length > 0 ? files : [selected];
    }, [files, selected]);

    if (!modal.visible) return null;

    return (
      <ArtifactLightbox
        issueId={issueId}
        selected={selected}
        setSelected={(next) => {
          if (next) {
            setSelected(next);
          } else {
            modal.hide();
          }
        }}
        navigableFiles={navigableFiles}
        returnFocus={returnFocus}
      />
    );
  }
);

export const ArtifactPreviewDialog = defineModal<
  ArtifactPreviewDialogProps,
  void
>(ArtifactPreviewDialogImpl);

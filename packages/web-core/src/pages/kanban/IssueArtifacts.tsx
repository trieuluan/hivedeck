import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogTitle } from '@vibe/ui/components/Dialog';

type Artifact = {
  path: string;
  name: string;
  mime: string;
  size: number;
};

const key = ['artifacts'];

export function useArtifacts() {
  return useQuery({
    queryKey: key,
    queryFn: async (): Promise<Record<string, Artifact[]>> => {
      const response = await fetch('/api/artifacts');
      if (!response.ok) throw new Error('Could not load artifacts');
      const body = await response.json();
      if (!body.success)
        throw new Error(body.message || 'Could not load artifacts');
      return body.data;
    },
    refetchInterval: 5000,
  });
}

export function fileUrl(issueId: string, path: string) {
  return `/api/issues/${issueId}/artifacts/file?${new URLSearchParams({ path })}`;
}

export function size(bytes: number) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;
}

export function IssueArtifacts({ issueId }: { issueId: string }) {
  const {
    data: files = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: [...key, issueId],
    queryFn: async (): Promise<Artifact[]> => {
      const response = await fetch(`/api/issues/${issueId}/artifacts`);
      if (!response.ok) throw new Error('Could not load artifacts');
      const body = await response.json();
      if (!body.success)
        throw new Error(body.message || 'Could not load artifacts');
      return body.data;
    },
    refetchInterval: 5000,
  });
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const images = files.filter((file) => file.mime.startsWith('image/'));
  const index = images.findIndex((file) => file.path === selected);
  const current = images[index];

  async function remove(path?: string) {
    if (
      !window.confirm(
        path ? 'Delete this artifact?' : 'Delete all artifacts for this card?'
      )
    )
      return;
    setDeleteError('');
    try {
      const query = path ? `?${new URLSearchParams({ path })}` : '';
      const response = await fetch(`/api/issues/${issueId}/artifacts${query}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Could not delete artifacts');
      setSelected(null);
      await client.invalidateQueries({ queryKey: key });
    } catch {
      setDeleteError('Could not delete artifacts. Please try again.');
    }
  }

  return (
    <section className="p-base space-y-base" aria-label="Artifacts">
      <div className="flex items-center justify-between gap-base">
        <h2 className="text-high font-medium">Generated Artifacts</h2>
        {files.length > 0 && (
          <button
            type="button"
            className="text-error"
            onClick={() => void remove()}
          >
            Delete all
          </button>
        )}
      </div>
      {isLoading && <p className="text-low">Loading artifacts…</p>}
      {error && (
        <p role="alert" className="text-error">
          Could not load artifacts. Try again.
        </p>
      )}
      {deleteError && (
        <p role="alert" className="text-error">
          {deleteError}
        </p>
      )}
      {!isLoading && !error && files.length === 0 && (
        <p className="text-low">No artifacts yet</p>
      )}
      <div className="grid grid-cols-2 gap-base">
        {files.map((file) => {
          const url = fileUrl(issueId, file.path);
          return (
            <article
              key={file.path}
              className={`border rounded-sm overflow-hidden bg-secondary min-w-0 ${file.mime.startsWith('image/') ? '' : 'col-span-2'}`}
            >
              {file.mime.startsWith('image/') && (
                <button
                  type="button"
                  className="block w-full"
                  aria-label={`Open ${file.name}`}
                  onClick={() => setSelected(file.path)}
                >
                  <img
                    src={url}
                    alt={file.name}
                    loading="lazy"
                    className="w-full h-32 object-contain bg-primary"
                  />
                </button>
              )}
              {file.mime.startsWith('video/') && (
                <video
                  src={url}
                  controls
                  preload="metadata"
                  className="w-full max-h-80 bg-primary"
                />
              )}
              <div className="p-half space-y-half">
                <p className="truncate text-high" title={file.name}>
                  {file.name}
                </p>
                <div className="flex items-center justify-between gap-half text-low">
                  <span>{size(file.size)}</span>
                  <div className="flex gap-half">
                    <a
                      href={url}
                      download={file.name}
                      aria-label={`Download ${file.name}`}
                      className="text-normal hover:text-high"
                    >
                      Download
                    </a>
                    <button
                      type="button"
                      aria-label={`Delete ${file.name}`}
                      className="text-error"
                      onClick={() => void remove(file.path)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <Dialog
        open={!!current}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        {current && (
          <DialogContent
            className="max-w-5xl"
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                setSelected(
                  images[
                    (index +
                      (event.key === 'ArrowRight' ? 1 : -1) +
                      images.length) %
                      images.length
                  ].path
                );
              }
              event.stopPropagation();
            }}
          >
            <DialogTitle>{current.name}</DialogTitle>
            <img
              src={fileUrl(issueId, current.path)}
              alt={current.name}
              className="max-h-[70vh] w-full object-contain"
            />
            <div className="flex justify-between p-base">
              <button
                type="button"
                onClick={() =>
                  setSelected(
                    images[(index - 1 + images.length) % images.length].path
                  )
                }
              >
                Previous
              </button>
              <a href={fileUrl(issueId, current.path)} download={current.name}>
                Download
              </a>
              <button
                type="button"
                onClick={() =>
                  setSelected(images[(index + 1) % images.length].path)
                }
              >
                Next
              </button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}

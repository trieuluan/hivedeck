import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowSquareOutIcon,
  CaretLeftIcon,
  CaretRightIcon,
  DownloadSimpleIcon,
  ImageIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  XIcon,
} from '@phosphor-icons/react';
import { cn } from '@/shared/lib/utils';

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

export function outputs(description: string | null, files: { name: string }[]) {
  const line = description?.match(/^\s*Outputs\s*:\s*(.*)$/im)?.[1];
  if (!line) return [];
  return Array.from(line.matchAll(/(\d+)\s*[×x]\s*([a-z0-9]+)/gi), (match) => {
    const extension = match[2].toUpperCase();
    return {
      extension,
      expected: Number(match[1]),
      actual: files.filter((file) =>
        file.name.toUpperCase().endsWith(`.${extension}`)
      ).length,
    };
  });
}

export function IssueArtifacts({
  issueId,
  description,
}: {
  issueId: string;
  description: string | null;
}) {
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
  const [zoomMode, setZoomMode] = useState<'fit' | 'actual'>('fit');
  const [zoomScale, setZoomScale] = useState(1);
  const [dimensions, setDimensions] = useState<{
    w: number;
    h: number;
  } | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const images = files.filter((file) => file.mime.startsWith('image/'));
  const checklist = outputs(description, files);
  const index = images.findIndex((file) => file.path === selected);
  const current = index >= 0 ? images[index] : null;

  useEffect(() => {
    setZoomMode('fit');
    setZoomScale(1);
    setDimensions(null);
  }, [selected]);

  useEffect(() => {
    if (!current) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setSelected(null);
      } else if (
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
        images.length > 1
      ) {
        event.preventDefault();
        event.stopPropagation();
        setSelected(
          images[
            (index + (event.key === 'ArrowRight' ? 1 : -1) + images.length) %
              images.length
          ].path
        );
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setZoomMode('actual');
        setZoomScale((s) => Math.min(3, Number((s + 0.25).toFixed(2))));
      } else if (event.key === '-') {
        event.preventDefault();
        setZoomMode('actual');
        setZoomScale((s) => Math.max(0.25, Number((s - 0.25).toFixed(2))));
      } else if (event.key === '0' || event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setZoomMode((m) => (m === 'fit' ? 'actual' : 'fit'));
        setZoomScale(1);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [current, images, index]);

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
      {!isLoading && !error && checklist.length > 0 && (
        <ul aria-label="Outputs checklist">
          {checklist.map(({ extension, actual, expected }, index) => (
            <li key={`${extension}-${index}`}>
              {extension} {actual}/{expected}{' '}
              {actual >= expected ? '✓' : 'thiếu'}
            </li>
          ))}
        </ul>
      )}
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
      {current &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={current.name}
            className="fixed inset-0 z-50 flex flex-col bg-zinc-950/95 backdrop-blur-md select-none"
            onClick={() => setSelected(null)}
          >
            {/* Top floating bar */}
            <header
              className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-zinc-950/80 px-4 py-2.5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <ImageIcon className="size-4 shrink-0 text-brand" />
                <span className="truncate text-sm font-medium text-white">
                  {current.name}
                </span>
                <span className="hidden shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-zinc-400 tabular-nums sm:inline-flex">
                  {dimensions ? `${dimensions.w} × ${dimensions.h} · ` : ''}
                  {size(current.size)}
                </span>
                {images.length > 1 && (
                  <span className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-zinc-300 tabular-nums">
                    {index + 1} / {images.length}
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <div className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setZoomMode('fit');
                      setZoomScale(1);
                    }}
                    className={cn(
                      'rounded-md px-2 py-1 font-medium transition-colors',
                      zoomMode === 'fit'
                        ? 'bg-brand text-white'
                        : 'text-zinc-300 hover:text-white'
                    )}
                  >
                    Vừa khung
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setZoomMode('actual');
                      setZoomScale(1);
                    }}
                    className={cn(
                      'rounded-md px-2 py-1 font-medium transition-colors',
                      zoomMode === 'actual' && zoomScale === 1
                        ? 'bg-brand text-white'
                        : 'text-zinc-300 hover:text-white'
                    )}
                  >
                    1:1
                  </button>
                </div>

                <div className="hidden items-center gap-0.5 rounded-lg border border-white/10 bg-white/5 p-0.5 sm:inline-flex">
                  <button
                    type="button"
                    onClick={() => {
                      setZoomMode('actual');
                      setZoomScale((s) =>
                        Math.max(0.25, Number((s - 0.25).toFixed(2)))
                      );
                    }}
                    className="rounded-md p-1.5 text-zinc-300 hover:bg-white/10 hover:text-white"
                    aria-label="Thu nhỏ"
                    title="Thu nhỏ (-)"
                  >
                    <MagnifyingGlassMinusIcon className="size-3.5" />
                  </button>
                  <span className="min-w-[44px] text-center text-[11px] text-zinc-300 tabular-nums">
                    {zoomMode === 'fit'
                      ? 'Fit'
                      : `${Math.round(zoomScale * 100)}%`}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setZoomMode('actual');
                      setZoomScale((s) =>
                        Math.min(3, Number((s + 0.25).toFixed(2)))
                      );
                    }}
                    className="rounded-md p-1.5 text-zinc-300 hover:bg-white/10 hover:text-white"
                    aria-label="Phóng to"
                    title="Phóng to (+)"
                  >
                    <MagnifyingGlassPlusIcon className="size-3.5" />
                  </button>
                </div>

                <a
                  href={fileUrl(issueId, current.path)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-white/10 bg-white/5 p-2 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Mở tab mới"
                  title="Mở ảnh gốc ở tab mới"
                >
                  <ArrowSquareOutIcon className="size-4" />
                </a>
                <a
                  href={fileUrl(issueId, current.path)}
                  download={current.name}
                  className="rounded-lg border border-white/10 bg-white/5 p-2 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Tải xuống"
                  title="Tải xuống"
                >
                  <DownloadSimpleIcon className="size-4" />
                </a>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="rounded-lg border border-white/10 bg-white/5 p-2 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Đóng"
                  title="Đóng (Esc)"
                >
                  <XIcon className="size-4" />
                </button>
              </div>
            </header>

            {/* Main image viewport */}
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-4 sm:p-6">
              {images.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(
                      images[(index - 1 + images.length) % images.length].path
                    );
                  }}
                  className="fixed left-4 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white/80 shadow-lg backdrop-blur-sm transition-colors hover:bg-black/85 hover:text-white"
                  aria-label="Ảnh trước"
                  title="Ảnh trước (←)"
                >
                  <CaretLeftIcon className="size-5" weight="bold" />
                </button>
              )}

              <img
                src={fileUrl(issueId, current.path)}
                alt={current.name}
                onClick={(e) => {
                  e.stopPropagation();
                  setZoomMode((m) => (m === 'fit' ? 'actual' : 'fit'));
                  setZoomScale(1);
                }}
                onLoad={(e) =>
                  setDimensions({
                    w: e.currentTarget.naturalWidth,
                    h: e.currentTarget.naturalHeight,
                  })
                }
                style={
                  zoomMode === 'actual' && dimensions
                    ? {
                        width: Math.round(dimensions.w * zoomScale),
                        height: Math.round(dimensions.h * zoomScale),
                      }
                    : undefined
                }
                className={cn(
                  'rounded-lg shadow-2xl transition-transform',
                  zoomMode === 'fit'
                    ? 'max-h-full max-w-full cursor-zoom-in object-contain'
                    : 'max-h-none max-w-none shrink-0 cursor-zoom-out'
                )}
              />

              {images.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(images[(index + 1) % images.length].path);
                  }}
                  className="fixed right-4 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white/80 shadow-lg backdrop-blur-sm transition-colors hover:bg-black/85 hover:text-white"
                  aria-label="Ảnh tiếp theo"
                  title="Ảnh tiếp theo (→)"
                >
                  <CaretRightIcon className="size-5" weight="bold" />
                </button>
              )}
            </div>

            {/* Bottom thumbnail filmstrip dock */}
            {images.length > 1 && (
              <div
                className="mx-auto mb-4 flex max-w-[90vw] shrink-0 items-center gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-zinc-900/90 p-2 shadow-2xl backdrop-blur-md"
                onClick={(e) => e.stopPropagation()}
              >
                {images.map((img) => {
                  const active = img.path === current.path;
                  return (
                    <button
                      key={img.path}
                      type="button"
                      onClick={() => setSelected(img.path)}
                      title={img.name}
                      className={cn(
                        'h-12 w-12 shrink-0 overflow-hidden rounded-lg border-2 transition-all',
                        active
                          ? 'scale-105 border-brand ring-2 ring-brand/30'
                          : 'border-transparent opacity-60 hover:opacity-100'
                      )}
                    >
                      <img
                        src={fileUrl(issueId, img.path)}
                        alt={img.name}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>,
          document.body
        )}
    </section>
  );
}

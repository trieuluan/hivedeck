import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowSquareOutIcon,
  CaretLeftIcon,
  CaretRightIcon,
  DownloadSimpleIcon,
  FileHtmlIcon,
  FileTextIcon,
  ImageIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  VideoCameraIcon,
  XIcon,
} from '@phosphor-icons/react';
import { cn } from '@/shared/lib/utils';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';

type Artifact = {
  path: string;
  name: string;
  mime: string;
  size: number;
  execution_id: string;
  created_at: string;
};

const key = ['artifacts'];
const previewLimit = 2 * 1024 * 1024;

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

export function previewKind(file: Pick<Artifact, 'name' | 'mime'>) {
  if (/^image\/(png|jpeg|gif|webp|avif)$/.test(file.mime)) return 'image';
  if (file.mime.startsWith('video/')) return 'video';
  if (
    /\.md(?:own)?$/i.test(file.name) &&
    ['text/markdown', 'text/plain', 'application/octet-stream'].includes(
      file.mime
    )
  )
    return 'markdown';
  if (/\.html?$/i.test(file.name) && file.mime === 'text/html') return 'html';
  return 'unsupported';
}

export function safeHtml(content: string) {
  const template = document.createElement('template');
  template.innerHTML = content;
  template.content
    .querySelectorAll(
      'script, iframe, frame, object, embed, base, meta, link, form'
    )
    .forEach((element) => element.remove());
  template.content.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (
        /^on/i.test(attribute.name) ||
        /^(href|src|srcset|action|formaction|xlink:href)$/i.test(attribute.name)
      )
        element.removeAttribute(attribute.name);
    }
  });
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'"><meta name="viewport" content="width=device-width, initial-scale=1">${template.innerHTML}`;
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
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = useState<Artifact | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [zoomMode, setZoomMode] = useState<'fit' | 'actual'>('fit');
  const [zoomScale, setZoomScale] = useState(1);
  const [dimensions, setDimensions] = useState<{
    w: number;
    h: number;
  } | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const images = files.filter((file) => previewKind(file) === 'image');
  const current = selected;
  const kind = current ? previewKind(current) : null;
  const index = images.findIndex((file) => file.path === selected?.path);

  useEffect(() => {
    setZoomMode('fit');
    setZoomScale(1);
    setDimensions(null);
    setContent(null);
    setPreviewError('');
    if (
      !selected ||
      (kind !== 'markdown' && kind !== 'html') ||
      selected.size > previewLimit
    )
      return;
    const controller = new AbortController();
    fetch(fileUrl(issueId, selected.path), {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('fetch failed');
        const length = Number(response.headers.get('content-length'));
        if (length > previewLimit) throw new Error('file too large');
        const blob = await response.blob();
        if (blob.size > previewLimit) throw new Error('file too large');
        return blob.text();
      })
      .then(setContent)
      .catch(() => {
        if (!controller.signal.aborted)
          setPreviewError('Không thể tải bản xem trước.');
      });
    return () => controller.abort();
  }, [issueId, selected, kind]);

  const open = current !== null;
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    return () => returnFocus.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!current) return;
    const dialog = dialogRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setSelected(null);
      } else if (event.key === 'Tab' && dialog) {
        const items = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), [tabindex="0"]'
          )
        );
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (!dialog.contains(active) || (event.shiftKey && active === first)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      } else if (kind !== 'image') {
        return;
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
          ]
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
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [current, images, index, kind]);

  async function remove(file: Artifact) {
    const result = await ConfirmDialog.show({
      title: 'Delete artifact?',
      message: `Permanently delete “${file.path}”? This cannot be undone.`,
      confirmText: 'Delete artifact',
      variant: 'destructive',
    });
    if (result !== 'confirmed') return;
    setDeleteError('');
    try {
      const response = await fetch(
        `/api/issues/${issueId}/artifacts?${new URLSearchParams({ path: file.path })}`,
        { method: 'DELETE' }
      );
      if (!response.ok || !(await response.json()).success) throw new Error();
      setSelected(null);
      await client.invalidateQueries({ queryKey: key });
    } catch {
      setDeleteError('Could not delete artifact. Please try again.');
    }
  }

  return (
    <section className="p-base space-y-base" aria-label="Artifacts">
      <div>
        <h2 className="text-high font-medium">Artifacts</h2>
        <p className="text-low text-sm">{files.length} tệp</p>
      </div>
      {!isLoading &&
        !error &&
        outputs(description, files).map(
          ({ extension, actual, expected }, index) => (
            <p key={`${extension}-${index}`} className="text-low text-sm">
              {extension} {actual}/{expected}
            </p>
          )
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
      {files.length > 0 && (
        <div className="flex justify-end border-b border-border pb-base">
          <div
            role="group"
            aria-label="Kiểu xem artifacts"
            className="inline-flex rounded-sm border border-border p-1"
          >
            {(['grid', 'list'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={view === mode}
                onClick={() => setView(mode)}
                className={cn(
                  'px-4 py-2 rounded-sm',
                  view === mode ? 'bg-brand text-white' : 'text-normal'
                )}
              >
                {mode === 'grid' ? 'Grid' : 'List'}
              </button>
            ))}
          </div>
        </div>
      )}
      <div
        className={cn(
          view === 'grid'
            ? 'grid grid-cols-1 sm:grid-cols-2 gap-base'
            : 'divide-y divide-border border-t border-border'
        )}
      >
        {files.map((file) => {
          const url = fileUrl(issueId, file.path);
          const fileKind = previewKind(file);
          return (
            <article
              key={file.path}
              className={cn(
                'min-w-0',
                view === 'list'
                  ? 'flex items-center gap-base py-base'
                  : 'space-y-half'
              )}
            >
              <button
                type="button"
                aria-label={`Open ${file.name}`}
                onClick={(event) => {
                  returnFocus.current = event.currentTarget;
                  setSelected(file);
                }}
                className={cn(
                  'min-w-0 text-left',
                  view === 'list'
                    ? 'flex flex-1 items-center gap-base'
                    : 'block w-full'
                )}
              >
                <span
                  className={cn(
                    'flex shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-secondary text-low',
                    view === 'list' ? 'h-14 w-20' : 'h-40 w-full'
                  )}
                >
                  {fileKind === 'image' ? (
                    <img
                      src={url}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <span className="text-sm uppercase">
                      {fileKind === 'markdown'
                        ? 'Markdown'
                        : fileKind === 'html'
                          ? 'HTML'
                          : fileKind === 'video'
                            ? 'Video'
                            : 'File'}
                    </span>
                  )}
                </span>
                <span
                  className={cn('block min-w-0', view === 'grid' && 'pt-half')}
                >
                  <span className="block break-all font-medium text-high">
                    {file.name}
                  </span>
                  <span className="block text-low text-sm">
                    {fileKind} · {size(file.size)} ·{' '}
                    {file.execution_id?.slice(0, 8)}
                  </span>
                </span>
              </button>
              <div className="flex shrink-0 gap-half text-sm">
                <a
                  href={url}
                  download={file.name}
                  aria-label={`Download ${file.name}`}
                  className="text-normal"
                >
                  Download
                </a>
                <button
                  type="button"
                  aria-label={`Delete ${file.name}`}
                  className="text-error"
                  onClick={() => void remove(file)}
                >
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {current &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dialogRef}
            tabIndex={-1}
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
                {kind === 'image' ? (
                  <ImageIcon className="size-4 shrink-0 text-brand" />
                ) : kind === 'video' ? (
                  <VideoCameraIcon className="size-4 shrink-0 text-brand" />
                ) : kind === 'html' ? (
                  <FileHtmlIcon className="size-4 shrink-0 text-brand" />
                ) : (
                  <FileTextIcon className="size-4 shrink-0 text-brand" />
                )}
                <span className="truncate text-sm font-medium text-white">
                  {current.name}
                </span>
                <span className="hidden shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-zinc-400 tabular-nums sm:inline-flex">
                  {kind === 'image' && dimensions
                    ? `${dimensions.w} × ${dimensions.h} · `
                    : ''}
                  {size(current.size)}
                </span>
                {kind === 'image' && images.length > 1 && (
                  <span className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-zinc-300 tabular-nums">
                    {index + 1} / {images.length}
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {kind === 'image' && (
                  <>
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
                  </>
                )}

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
              {kind === 'image' && images.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(
                      images[(index - 1 + images.length) % images.length]
                    );
                  }}
                  className="fixed left-4 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white/80 shadow-lg backdrop-blur-sm transition-colors hover:bg-black/85 hover:text-white"
                  aria-label="Ảnh trước"
                  title="Ảnh trước (←)"
                >
                  <CaretLeftIcon className="size-5" weight="bold" />
                </button>
              )}

              {kind === 'image' && (
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
                  onError={() =>
                    setPreviewError('Không thể tải bản xem trước.')
                  }
                  className={cn(
                    'rounded-lg shadow-2xl transition-transform',
                    zoomMode === 'fit'
                      ? 'max-h-full max-w-full cursor-zoom-in object-contain'
                      : 'max-h-none max-w-none shrink-0 cursor-zoom-out'
                  )}
                />
              )}
              {kind === 'video' && (
                <video
                  controls
                  preload="metadata"
                  src={fileUrl(issueId, current.path)}
                  onClick={(e) => e.stopPropagation()}
                  onError={() =>
                    setPreviewError('Không thể tải bản xem trước.')
                  }
                  className="max-h-full max-w-full rounded-lg bg-black shadow-2xl"
                />
              )}
              {(kind === 'markdown' || kind === 'html') && (
                <div
                  className="flex h-full w-full max-w-4xl flex-col"
                  onClick={(e) => e.stopPropagation()}
                >
                  {content === null &&
                    !previewError &&
                    current.size <= previewLimit && (
                      <p className="text-sm text-zinc-300">Loading preview…</p>
                    )}
                  {kind === 'markdown' && content !== null && (
                    <article
                      tabIndex={0}
                      className="min-h-0 max-w-none space-y-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-medium [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-black/40 [&_pre]:p-3 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-white/15 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-white/15 [&_td]:px-2 [&_td]:py-1 [&_blockquote]:border-l-2 [&_blockquote]:border-white/20 [&_blockquote]:pl-3 [&_blockquote]:text-zinc-300 flex-1 overflow-auto break-words rounded-lg border border-white/10 bg-zinc-900 p-4 text-zinc-100"
                    >
                      <ReactMarkdown
                        skipHtml
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ children }) => <span>{children}</span>,
                          img: ({ alt }) => <span>{alt}</span>,
                        }}
                      >
                        {content}
                      </ReactMarkdown>
                    </article>
                  )}
                  {kind === 'html' && content !== null && (
                    <iframe
                      title={current.name}
                      sandbox=""
                      referrerPolicy="no-referrer"
                      srcDoc={safeHtml(content)}
                      className="min-h-0 w-full flex-1 rounded-lg bg-white"
                    />
                  )}
                </div>
              )}
              {(kind === 'markdown' || kind === 'html') &&
                current.size > previewLimit && (
                  <p className="text-sm text-zinc-300">
                    Tệp quá lớn để xem trước. Dùng nút Tải xuống.
                  </p>
                )}
              {kind === 'unsupported' && (
                <p className="text-sm text-zinc-300">
                  Không hỗ trợ xem trước loại tệp này. Dùng nút Tải xuống.
                </p>
              )}
              {previewError && (
                <p role="alert" className="text-sm text-red-300">
                  {previewError} Dùng nút Tải xuống.
                </p>
              )}

              {kind === 'image' && images.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(images[(index + 1) % images.length]);
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
            {kind === 'image' && images.length > 1 && (
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
                      onClick={() => setSelected(img)}
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

import { useQuery } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ImagePreviewDialog } from '@/shared/dialogs/wysiwyg/ImagePreviewDialog';
import type { LocalAttachmentMetadata } from '@vibe/ui/components/WorkspaceContext';
import { isImageAttachment } from '@vibe/ui/lib/is-image-attachment';

export interface ExtractedChatImage {
  raw: string;
  alt: string;
  src: string;
}

const IMAGE_MARKDOWN_RE =
  /!\[([^\]]*)\]\((\/api\/attachments\/[^)\s]+|\.vibe-attachments\/[^)\s]+)\)/g;

export function splitChatImageAttachments(markdown: string): {
  images: ExtractedChatImage[];
  text: string;
} {
  const images: ExtractedChatImage[] = [];
  const text = markdown
    .replace(IMAGE_MARKDOWN_RE, (raw, alt: string, src: string) => {
      if (src.startsWith('/api/attachments/') || isImageAttachment(src, alt)) {
        images.push({ raw, alt, src });
        return '';
      }
      return raw;
    })
    .replace(/^\n+|\n+$/g, '')
    .replace(/\n{3,}/g, '\n\n');
  return { images, text };
}

export function combineChatImageAttachments(
  images: ExtractedChatImage[],
  text: string
): string {
  if (images.length === 0) return text;
  const imgBlock = images.map((img) => img.raw).join('\n');
  if (!text.trim()) return imgBlock;
  return `${imgBlock}\n\n${text}`;
}

interface AttachmentMetadata {
  exists: boolean;
  file_name?: string;
  size_bytes?: number;
  format?: string;
  proxy_url?: string;
}

function ChatImageThumb({
  image,
  localAttachments,
  workspaceId,
  sessionId,
  disabled,
  onRemove,
}: {
  image: ExtractedChatImage;
  localAttachments?: LocalAttachmentMetadata[];
  workspaceId?: string;
  sessionId?: string;
  disabled?: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation('common');
  const local = localAttachments?.find((a) => a.path === image.src);
  const isDirect = image.src.startsWith('/api/attachments/');
  const isVibe = image.src.startsWith('.vibe-attachments/');

  const { data: metadata, isLoading } = useQuery<AttachmentMetadata | null>({
    queryKey: ['attachment-metadata', workspaceId, sessionId, image.src],
    queryFn: async () => {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/attachments/metadata?path=${encodeURIComponent(image.src)}&session_id=${sessionId}`
      );
      if (!res.ok) return null;
      const json = await res.json();
      return json.data ?? null;
    },
    enabled: !local && !isDirect && isVibe && !!workspaceId && !!sessionId,
    staleTime: Infinity,
  });

  const imageUrl = isDirect
    ? image.src
    : (local?.proxy_url ?? metadata?.proxy_url);
  const displayName =
    local?.file_name ||
    metadata?.file_name ||
    image.alt ||
    image.src.split('/').pop() ||
    'image';

  return (
    <div className="group/img relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border/80 bg-panel shadow-xs">
      <button
        type="button"
        disabled={!imageUrl}
        title={displayName}
        aria-label={`${t('kanban.previewFile')}: ${displayName}`}
        onClick={() => {
          if (!imageUrl) return;
          ImagePreviewDialog.show({
            imageUrl,
            altText: displayName,
            fileName: displayName,
            format: metadata?.format,
            sizeBytes:
              metadata?.size_bytes != null
                ? BigInt(metadata.size_bytes)
                : undefined,
          });
        }}
        className="flex h-full w-full items-center justify-center overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-default"
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={displayName}
            className="h-full w-full object-cover transition-transform duration-150 group-hover/img:scale-105"
            draggable={false}
          />
        ) : isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : null}
      </button>
      {!disabled && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('kanban.removeImage')}
          title={t('kanban.removeImage')}
          className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/75 text-white opacity-85 shadow-sm transition-all hover:scale-105 hover:bg-error hover:opacity-100 focus-visible:opacity-100"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
}

export function ChatImageStrip({
  images,
  localAttachments,
  workspaceId,
  sessionId,
  disabled,
  onRemove,
}: {
  images: ExtractedChatImage[];
  localAttachments?: LocalAttachmentMetadata[];
  workspaceId?: string;
  sessionId?: string;
  disabled?: boolean;
  onRemove: (index: number) => void;
}) {
  if (images.length === 0) return null;
  return (
    <div className="mb-1.5 flex items-center gap-2 overflow-x-auto border-b border-border/50 pb-2">
      {images.map((img, idx) => (
        <ChatImageThumb
          key={`${img.src}-${idx}`}
          image={img}
          localAttachments={localAttachments}
          workspaceId={workspaceId}
          sessionId={sessionId}
          disabled={disabled}
          onRemove={() => onRemove(idx)}
        />
      ))}
    </div>
  );
}

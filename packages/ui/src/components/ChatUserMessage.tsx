import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PencilSimpleIcon, ArrowUUpLeftIcon } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { ChatMessageBody, ChatTimestamp } from './ChatMessageBody';
import { Tooltip } from './Tooltip';

export interface ChatUserMessageRenderProps {
  content: string;
  workspaceId?: string;
}

interface ChatUserMessageProps {
  content: string;
  expanded?: boolean;
  onToggle?: () => void;
  className?: string;
  workspaceId?: string;
  onEdit?: () => void;
  onReset?: () => void;
  isGreyed?: boolean;
  timestamp?: string | null;
  renderMarkdown: (props: ChatUserMessageRenderProps) => ReactNode;
}

export function ChatUserMessage({
  content,
  className,
  workspaceId,
  onEdit,
  onReset,
  isGreyed,
  timestamp,
  renderMarkdown,
}: ChatUserMessageProps) {
  const { t } = useTranslation('tasks');
  const actionClass =
    'rounded-sm p-1.5 text-low hover:bg-secondary hover:text-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';

  return (
    <div
      className={cn(
        'ship-message ship-message--user group/msg relative ml-auto flex w-fit min-w-0 max-w-[min(85%,40rem)] flex-col items-end',
        isGreyed && 'opacity-50 pointer-events-none',
        className
      )}
    >
      <article
        aria-label={t('conversation.you')}
        className="ship-message-human min-w-0 max-w-full rounded-2xl bg-secondary px-4 py-2.5 text-high"
      >
        <ChatMessageBody>
          {renderMarkdown({ content, workspaceId })}
        </ChatMessageBody>
      </article>
      {!isGreyed && (onReset || onEdit || timestamp) && (
        // Floats beside the bubble on hover, so it takes no room in the
        // transcript.
        <div className="absolute bottom-0 right-full mr-1 flex items-center gap-0.5 whitespace-nowrap opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100 motion-reduce:transition-none">
          <ChatTimestamp timestamp={timestamp} />
          {onReset && (
            <Tooltip content={t('conversation.actions.resetTooltip')}>
              <button
                type="button"
                onClick={onReset}
                className={actionClass}
                aria-label={t('conversation.actions.reset')}
              >
                <ArrowUUpLeftIcon className="size-3.5" aria-hidden="true" />
              </button>
            </Tooltip>
          )}
          {onEdit && (
            <Tooltip content={t('conversation.actions.edit')}>
              <button
                type="button"
                onClick={onEdit}
                className={actionClass}
                aria-label={t('conversation.actions.edit')}
              >
                <PencilSimpleIcon className="size-3.5" aria-hidden="true" />
              </button>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}

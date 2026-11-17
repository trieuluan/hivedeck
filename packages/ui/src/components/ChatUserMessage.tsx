import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PencilSimpleIcon,
  ArrowUUpLeftIcon,
  CompassIcon,
  CaretDownIcon,
} from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { ChatMessageBody } from './ChatMessageBody';
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
  expanded = true,
  onToggle,
  className,
  workspaceId,
  onEdit,
  onReset,
  isGreyed,
  timestamp,
  renderMarkdown,
}: ChatUserMessageProps) {
  const { t } = useTranslation('tasks');
  const bodyId = useId();
  const label = (
    <>
      <CompassIcon className="size-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{t('conversation.you')}</span>
      {onToggle && (
        <CaretDownIcon
          aria-hidden="true"
          className={cn('size-3 shrink-0', !expanded && '-rotate-90')}
        />
      )}
    </>
  );

  return (
    <article
      className={cn(
        'ship-message ship-message--user ship-message-human ml-auto w-fit min-w-0 max-w-[min(92%,44rem)] rounded-lg rounded-tr-sm border border-[#84734e] bg-[#182c40] px-4 py-3 font-ibm-plex-sans text-[#f4efe3] selection:bg-[#c5a66b] selection:text-[#182c40]',
        isGreyed && 'opacity-50 pointer-events-none',
        className
      )}
      aria-label={t('conversation.you')}
    >
      <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2 text-[#ddc38e]">
        {onToggle ? (
          <button
            type="button"
            disabled={isGreyed}
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={bodyId}
            className="flex min-h-8 min-w-0 items-center gap-2 rounded-sm text-[12px] font-medium hover:text-[#f4efe3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
          >
            {label}
          </button>
        ) : (
          <div className="flex min-w-0 items-center gap-2 text-[12px] font-medium">
            {label}
          </div>
        )}
        {!isGreyed && (onReset || onEdit) && (
          <div className="flex items-center gap-1">
            {onReset && (
              <Tooltip content={t('conversation.actions.resetTooltip')}>
                <button
                  type="button"
                  onClick={onReset}
                  className="rounded-sm p-2 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
                  aria-label={t('conversation.actions.reset')}
                >
                  <ArrowUUpLeftIcon className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
            )}
            {onEdit && (
              <Tooltip content={t('conversation.actions.edit')}>
                <button
                  type="button"
                  onClick={onEdit}
                  className="rounded-sm p-2 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
                  aria-label={t('conversation.actions.edit')}
                >
                  <PencilSimpleIcon className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
            )}
          </div>
        )}
      </div>
      <div id={bodyId} hidden={!expanded}>
        {expanded && (
          <ChatMessageBody timestamp={timestamp}>
            {renderMarkdown({ content, workspaceId })}
          </ChatMessageBody>
        )}
      </div>
    </article>
  );
}

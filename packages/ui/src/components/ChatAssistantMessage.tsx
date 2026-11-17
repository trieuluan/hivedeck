import type { ReactNode } from 'react';
import { LighthouseIcon } from '@phosphor-icons/react';
import { ChatMessageBody } from './ChatMessageBody';

export interface ChatAssistantMessageRenderProps {
  content: string;
  workspaceId?: string;
}

interface ChatAssistantMessageProps {
  content: string;
  workspaceId?: string;
  timestamp?: string | null;
  renderMarkdown: (props: ChatAssistantMessageRenderProps) => ReactNode;
}

export function ChatAssistantMessage({
  content,
  workspaceId,
  timestamp,
  renderMarkdown,
}: ChatAssistantMessageProps) {
  return (
    <article className="ship-message ship-message--assistant flex w-fit min-w-0 max-w-[min(92%,44rem)] items-start gap-2 font-ibm-plex-sans">
      <LighthouseIcon
        aria-hidden="true"
        className="mt-2 size-5 shrink-0 text-[#8fccc3]"
      />
      <div className="ship-message-ai min-w-0 flex-1 rounded-lg rounded-tl-sm border px-4 py-3">
        <ChatMessageBody timestamp={timestamp}>
          {renderMarkdown({ content, workspaceId })}
        </ChatMessageBody>
      </div>
    </article>
  );
}

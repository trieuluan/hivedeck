import type { ReactNode } from 'react';
import { ChatMessageBody } from './ChatMessageBody';

export interface ChatAssistantMessageRenderProps {
  content: string;
  workspaceId?: string;
}

interface ChatAssistantMessageProps {
  content: string;
  workspaceId?: string;
  /** Kept for callers; not shown (the transcript stays compact). */
  timestamp?: string | null;
  renderMarkdown: (props: ChatAssistantMessageRenderProps) => ReactNode;
}

/** The agent's answer: plain text in the reading column, no bubble. */
export function ChatAssistantMessage({
  content,
  workspaceId,
  renderMarkdown,
}: ChatAssistantMessageProps) {
  return (
    <article className="ship-message ship-message--assistant group/msg min-w-0 max-w-full text-high">
      <ChatMessageBody>
        {renderMarkdown({ content, workspaceId })}
      </ChatMessageBody>
    </article>
  );
}

import { cn } from '../../lib/cn';
import {
  attentionReason,
  type WorkspaceAttentionItem,
} from '../../lib/workspaceStatus';
import type { CaptainState } from './types';

/** One colour language for live state across the sidebar and the inbox. */
export type LiveState = 'running' | 'waiting' | 'error' | 'done' | 'idle';

const DOT: Record<LiveState, string> = {
  running: 'bg-success motion-safe:animate-pulse',
  waiting: 'bg-warning',
  error: 'bg-error',
  done: 'bg-success',
  idle: 'bg-border',
};

export function workspaceLiveState(ws: WorkspaceAttentionItem): LiveState {
  const reason = attentionReason(ws);
  if (reason === 'approval') return 'waiting';
  if (reason === 'failed') return 'error';
  if (ws.isRunning) return 'running';
  if (reason === 'finished') return 'done';
  return 'idle';
}

export function captainLiveState(state: CaptainState): LiveState {
  switch (state) {
    case 'running':
    case 'waiting':
    case 'error':
      return state;
    case 'watching':
      return 'done';
    case 'stopped':
      return 'idle';
  }
}

export function StatusDot({
  state,
  label,
  className,
}: {
  state: LiveState;
  label?: string;
  className?: string;
}) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
      className={cn('size-2 shrink-0 rounded-full', DOT[state], className)}
    />
  );
}

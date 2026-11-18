import { useEffect, useState } from 'react';
import { WarningIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn';

export const AGENT_STALE_AFTER_MS = 10 * 60 * 1000;

export interface AgentActivity {
  /** Epoch ms the running process started. */
  startedAt: number;
  /** Epoch ms of the newest entry (falls back to startedAt). */
  lastActivityAt: number;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

export function isStale(
  activity: AgentActivity,
  now: number,
  thresholdMs = AGENT_STALE_AFTER_MS
): boolean {
  return now - activity.lastActivityAt >= thresholdMs;
}

/** Elapsed run time + time since last entry; warns when the agent is silent. */
export function AgentActivityIndicator({
  activity,
  className,
}: {
  activity: AgentActivity;
  className?: string;
}) {
  const { t } = useTranslation('tasks');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const elapsed = formatElapsed(now - activity.startedAt);
  const minutesAgo = Math.max(
    0,
    Math.floor((now - activity.lastActivityAt) / 60000)
  );
  const stale = isStale(activity, now);

  return (
    <span
      className={cn(
        'flex min-w-0 items-center gap-1 text-xs',
        stale ? 'text-warning' : 'text-low',
        className
      )}
    >
      <span className="truncate">
        {t('conversation.activity.elapsed', { elapsed })}
        {' · '}
        {minutesAgo < 1
          ? t('conversation.activity.lastActivityNow')
          : t('conversation.activity.lastActivity', { count: minutesAgo })}
      </span>
      {stale && (
        <span role="status" className="flex shrink-0 items-center gap-1">
          <WarningIcon aria-hidden="true" className="size-icon-xs" />
          {t('conversation.activity.unresponsive')}
        </span>
      )}
    </span>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ProcessTime {
  isRunning?: boolean;
  latestProcessStartedAt?: string;
  latestProcessCompletedAt?: string;
  latestProcessStatus?: 'running' | 'completed' | 'failed' | 'killed';
}

export function formatDuration(milliseconds: number): string {
  const minutes = Math.max(0, Math.floor(milliseconds / 60000));
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatWorkspaceTime(
  process: ProcessTime,
  now: number,
  t: (key: string, options: { time: string }) => string
): string {
  const start = process.latestProcessStartedAt
    ? Date.parse(process.latestProcessStartedAt)
    : NaN;
  const end = process.latestProcessCompletedAt
    ? Date.parse(process.latestProcessCompletedAt)
    : NaN;
  if (process.isRunning)
    return Number.isFinite(start)
      ? t('workspaces.processRunning', { time: formatDuration(now - start) })
      : '';
  if (!Number.isFinite(end)) return '';
  const failed =
    process.latestProcessStatus === 'failed' ||
    process.latestProcessStatus === 'killed';
  const relative = t(
    failed ? 'workspaces.processFailed' : 'workspaces.processDone',
    { time: formatDuration(now - end) }
  );
  return Number.isFinite(start)
    ? `${relative} · ${t('workspaces.processRan', { time: formatDuration(end - start) })}`
    : relative;
}

export function useWorkspaceTime(process: ProcessTime): string {
  const { t } = useTranslation('common');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!process.isRunning) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, [process.isRunning]);
  return formatWorkspaceTime(process, process.isRunning ? now : Date.now(), t);
}

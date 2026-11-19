import { describe, expect, it } from 'vitest';
import { formatDuration, formatWorkspaceTime } from './WorkspaceTime';

const translate = (key: string, { time }: { time: string }) => `${key} ${time}`;
const start = '2026-11-19T00:00:00Z';
const end = '2026-11-19T00:12:00Z';
const now = Date.parse('2026-11-19T00:15:00Z');

describe('workspace process time', () => {
  it('formats running, completed and failed processes', () => {
    expect(
      formatWorkspaceTime(
        { isRunning: true, latestProcessStartedAt: start },
        now,
        translate
      )
    ).toBe('workspaces.processRunning 15m');
    expect(
      formatWorkspaceTime(
        { latestProcessStartedAt: start, latestProcessCompletedAt: end },
        now,
        translate
      )
    ).toBe('workspaces.processDone 3m · workspaces.processRan 12m');
    expect(
      formatWorkspaceTime(
        {
          latestProcessStatus: 'killed',
          latestProcessStartedAt: start,
          latestProcessCompletedAt: end,
        },
        now,
        translate
      )
    ).toBe('workspaces.processFailed 3m · workspaces.processRan 12m');
  });
  it('formats sub-minute and hour durations', () => {
    expect(formatDuration(59999)).toBe('<1m');
    expect(formatDuration(3720000)).toBe('1h 2m');
  });
});

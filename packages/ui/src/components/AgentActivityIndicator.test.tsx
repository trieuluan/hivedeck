import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AgentActivityIndicator,
  formatElapsed,
  isStale,
} from './AgentActivityIndicator';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      `${key}${opts ? JSON.stringify(opts) : ''}`,
  }),
}));

afterEach(cleanup);

describe('AgentActivityIndicator', () => {
  it('formats elapsed', () => {
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
  });

  it('detects stale past threshold only', () => {
    const activity = { startedAt: 0, lastActivityAt: 1000 };
    expect(isStale(activity, 1000 + 9 * 60_000)).toBe(false);
    expect(isStale(activity, 1000 + 10 * 60_000)).toBe(true);
  });

  it('shows no warning when fresh', () => {
    const now = Date.now();
    render(
      <AgentActivityIndicator
        activity={{ startedAt: now - 5000, lastActivityAt: now - 1000 }}
      />
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows accessible warning when stale', () => {
    const now = Date.now();
    render(
      <AgentActivityIndicator
        activity={{ startedAt: now - 3_600_000, lastActivityAt: now - 660_000 }}
      />
    );
    expect(screen.getByRole('status').textContent).toContain('unresponsive');
  });
});

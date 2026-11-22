/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ViewNavTabs } from './ViewNavTabs';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ViewNavTabs', () => {
  it('renders the status list passed from the kanban container', () => {
    render(
      <ViewNavTabs
        activeView="list"
        onViewChange={vi.fn()}
        statuses={[
          { id: 'todo', name: 'Todo', color: '200 80% 60%', count: 3 },
          { id: 'review', name: 'In Review', count: 1 },
        ]}
        selectedStatusId={null}
        onStatusSelect={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'All' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Todo/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /In Review/ })).toBeTruthy();
  });

  it('keeps view switching separate from status filtering', () => {
    const onViewChange = vi.fn();
    const onStatusSelect = vi.fn();

    render(
      <ViewNavTabs
        activeView="kanban"
        onViewChange={onViewChange}
        statuses={[{ id: 'done', name: 'Done' }]}
        selectedStatusId={null}
        onStatusSelect={onStatusSelect}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(onViewChange).toHaveBeenCalledWith('list');
    expect(onStatusSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    expect(onStatusSelect).toHaveBeenCalledWith('done');
    expect(onViewChange).toHaveBeenCalledTimes(1);
  });
});

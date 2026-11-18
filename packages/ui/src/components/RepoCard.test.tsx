/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepoCard } from './RepoCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

afterEach(cleanup);

describe('RepoCard', () => {
  it('hides Merge when commitsAhead is 0 and falls back to an available action', () => {
    render(
      <RepoCard
        repoId="repo-1"
        name="hivedeck"
        targetBranch="main"
        commitsAhead={0}
        selectedAction="merge"
      />
    );

    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Open pull request' })
    ).toBeTruthy();
  });

  it('shows Merge when commitsAhead > 0', () => {
    render(
      <RepoCard
        repoId="repo-1"
        name="hivedeck"
        targetBranch="main"
        commitsAhead={2}
        selectedAction="merge"
      />
    );

    expect(screen.getByRole('button', { name: 'Merge' })).toBeTruthy();
  });
});

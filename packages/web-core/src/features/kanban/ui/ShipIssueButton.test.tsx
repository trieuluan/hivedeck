import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MouseEvent, PointerEvent, ReactElement } from 'react';

const { shipMock } = vi.hoisted(() => ({ shipMock: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === 'ship.acceptFindings' ? 'Accept findings' : key,
  }),
}));

vi.mock('@phosphor-icons/react', () => ({
  CheckIcon: () => null,
  GitMergeIcon: () => null,
  SpinnerIcon: () => null,
}));

vi.mock('@vibe/ui/components/ConfirmDialog', () => ({
  ConfirmDialog: { show: vi.fn() },
}));

vi.mock('@/shared/lib/api', () => ({
  workspacesApi: { ship: shipMock },
}));

import { AcceptFindingsButton, resolveInReviewAction } from './ShipIssueButton';

describe('resolveInReviewAction', () => {
  it('returns null while diff summary is loading', () => {
    expect(resolveInReviewAction(undefined)).toBeNull();
  });

  it('returns accept when there are no changed files', () => {
    expect(resolveInReviewAction(0)).toBe('accept');
  });

  it('returns merge when there are changed files', () => {
    expect(resolveInReviewAction(3)).toBe('merge');
  });
});

describe('AcceptFindingsButton', () => {
  beforeEach(() => {
    shipMock.mockReset();
  });

  it('calls onAccept without running git merge and stops card click/drag propagation', () => {
    const onAccept = vi.fn();
    const element = AcceptFindingsButton({ onAccept }) as ReactElement<{
      children: unknown[];
      onClick: (e: MouseEvent<HTMLButtonElement>) => void;
      onPointerDown: (e: PointerEvent<HTMLButtonElement>) => void;
    }>;

    expect(element.props.children).toContain('Accept findings');

    const stopClick = vi.fn();
    element.props.onClick({
      stopPropagation: stopClick,
    } as unknown as MouseEvent<HTMLButtonElement>);
    expect(stopClick).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(shipMock).not.toHaveBeenCalled();

    const stopPointer = vi.fn();
    element.props.onPointerDown({
      stopPropagation: stopPointer,
    } as unknown as PointerEvent<HTMLButtonElement>);
    expect(stopPointer).toHaveBeenCalledTimes(1);
  });
});

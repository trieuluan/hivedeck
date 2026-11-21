import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MouseEvent, PointerEvent, ReactElement } from 'react';

const { shipMock, confirmMock } = vi.hoisted(() => ({
  shipMock: vi.fn(),
  confirmMock: vi.fn(),
}));

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
  ConfirmDialog: { show: confirmMock },
}));

vi.mock('@/shared/lib/api', () => ({
  workspacesApi: { ship: shipMock },
}));

import {
  AcceptFindingsButton,
  ShipIssueButton,
  resolveInReviewAction,
} from './ShipIssueButton';

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

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: <T,>(init: T) => [init, vi.fn()] as const,
  };
});

describe('ShipIssueButton', () => {
  beforeEach(() => {
    shipMock.mockReset();
    confirmMock.mockReset();
  });

  it('always passes cleanup=false when confirmed so cleanup happens via Dọn đã xong', async () => {
    confirmMock.mockResolvedValue('confirmed');
    shipMock.mockResolvedValue({
      success: true,
      data: {
        merged_repos: ['r'],
        unchanged_repos: [],
        pushed: true,
        push_error: null,
      },
    });
    const onShipped = vi.fn();
    const onCleanup = vi.fn();
    const el = ShipIssueButton({
      workspaceId: 'ws-1',
      isPinned: false,
      onShipped,
      onOpenWorkspace: vi.fn(),
      onCleanup,
    }) as ReactElement<{
      onClick: (e: MouseEvent<HTMLButtonElement>) => Promise<void>;
    }>;

    await el.props.onClick({
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent<HTMLButtonElement>);

    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'merge',
        note: 'ship.workspaceKeptHint',
      })
    );
    expect(shipMock).toHaveBeenCalledWith('ws-1', {
      push: true,
      cleanup: false,
    });
    expect(onShipped).toHaveBeenCalledTimes(1);
    expect(onCleanup).not.toHaveBeenCalled();
  });

  it('shows pinned hint when workspace is pinned', async () => {
    confirmMock.mockResolvedValue('confirmed');
    shipMock.mockResolvedValue({
      success: true,
      data: {
        merged_repos: ['r'],
        unchanged_repos: [],
        pushed: true,
        push_error: null,
      },
    });
    const onCleanup = vi.fn();
    const el = ShipIssueButton({
      workspaceId: 'ws-2',
      isPinned: true,
      onShipped: vi.fn(),
      onOpenWorkspace: vi.fn(),
      onCleanup,
    }) as ReactElement<{
      onClick: (e: MouseEvent<HTMLButtonElement>) => Promise<void>;
    }>;

    await el.props.onClick({
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent<HTMLButtonElement>);

    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'merge',
        note: 'ship.pinnedWorkspaceKept',
      })
    );
    expect(shipMock).toHaveBeenCalledWith('ws-2', {
      push: true,
      cleanup: false,
    });
    expect(onCleanup).not.toHaveBeenCalled();
  });

  it('aborts without confirming or merging when onBeforeShip returns false', async () => {
    const onShipped = vi.fn();
    const el = ShipIssueButton({
      workspaceId: 'ws-3',
      onBeforeShip: async () => false,
      onShipped,
      onOpenWorkspace: vi.fn(),
    }) as ReactElement<{
      onClick: (e: MouseEvent<HTMLButtonElement>) => Promise<void>;
    }>;

    await el.props.onClick({
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent<HTMLButtonElement>);

    expect(confirmMock).not.toHaveBeenCalled();
    expect(shipMock).not.toHaveBeenCalled();
    expect(onShipped).not.toHaveBeenCalled();
  });
});

/**
 * @vitest-environment jsdom
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from './ConfirmDialog';
import { KanbanWorkspaceDispatch } from './KanbanWorkspaceDispatch';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'kanban.selectWorkspace': 'Run in workspace...',
        'kanban.dispatchIssue': 'Run issue in selected workspace',
        'kanban.linkThisWorkspace': 'Link this workspace',
        'kanban.linkWorkspaceConfirmTitle': 'Change workspace link',
        'kanban.linkWorkspaceConfirmMessage':
          'This will link the selected workspace to the current card.',
        'kanban.linkWorkspaceConfirm': 'Change link',
        'confirm.defaultCancel': 'Cancel',
      })[key] ?? key,
  }),
}));

vi.mock('./ConfirmDialog', () => ({
  ConfirmDialog: { show: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('KanbanWorkspaceDispatch', () => {
  it('runs a linked workspace', () => {
    const onDispatch = vi.fn();
    render(
      <KanbanWorkspaceDispatch
        workspaces={[{ id: 'linked', name: 'Linked' }]}
        currentWorkspaceIds={new Set(['linked'])}
        onDispatch={onDispatch}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Run issue in selected workspace' })
    );

    expect(onDispatch).toHaveBeenCalledWith('linked');
    expect(ConfirmDialog.show).not.toHaveBeenCalled();
  });

  it('keeps other workspaces selectable without running them', async () => {
    const onDispatch = vi.fn();
    const onLink = vi.fn();
    vi.mocked(ConfirmDialog.show).mockResolvedValue('canceled');
    render(
      <KanbanWorkspaceDispatch
        workspaces={[
          { id: 'unlinked', name: 'Unlinked' },
          { id: 'linked', name: 'Linked' },
        ]}
        currentWorkspaceIds={new Set(['linked'])}
        onDispatch={onDispatch}
        onLink={onLink}
      />
    );

    const select = screen.getByRole('combobox', {
      name: 'Run in workspace...',
    }) as HTMLButtonElement;
    expect(select.disabled).toBe(false);
    fireEvent.click(
      screen.getByRole('button', { name: 'Link this workspace' })
    );

    await waitFor(() => {
      expect(onDispatch).not.toHaveBeenCalled();
      expect(onLink).not.toHaveBeenCalled();
      expect(ConfirmDialog.show).toHaveBeenCalledWith(
        expect.objectContaining({ confirmText: 'Change link' })
      );
    });
  });

  it('links after confirmation and then runs', async () => {
    const onDispatch = vi.fn();
    const onLink = vi.fn();
    vi.mocked(ConfirmDialog.show).mockResolvedValue('confirmed');
    const view = render(
      <KanbanWorkspaceDispatch
        workspaces={[{ id: 'workspace', name: 'Workspace' }]}
        currentWorkspaceIds={new Set()}
        onDispatch={onDispatch}
        onLink={onLink}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Link this workspace' })
    );
    await waitFor(() => expect(onLink).toHaveBeenCalledWith('workspace'));
    expect(onDispatch).not.toHaveBeenCalled();

    view.rerender(
      <KanbanWorkspaceDispatch
        workspaces={[{ id: 'workspace', name: 'Workspace' }]}
        currentWorkspaceIds={new Set(['workspace'])}
        onDispatch={onDispatch}
        onLink={onLink}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Run issue in selected workspace' })
    );

    expect(onDispatch).toHaveBeenCalledWith('workspace');
    expect(onLink).toHaveBeenCalledTimes(1);
    expect(ConfirmDialog.show).toHaveBeenCalledTimes(1);
  });
});

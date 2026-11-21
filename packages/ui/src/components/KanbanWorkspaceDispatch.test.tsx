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
        'kanban.currentWorkspace': 'running here',
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
  it('falls back when the selected workspace disappears', () => {
    const onDispatch = vi.fn();
    const view = render(
      <KanbanWorkspaceDispatch
        workspaces={[
          { id: 'first', name: 'First' },
          { id: 'second', name: 'Second' },
        ]}
        currentWorkspaceIds={new Set(['second'])}
        onDispatch={onDispatch}
      />
    );
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'First' }));
    view.rerender(
      <KanbanWorkspaceDispatch
        workspaces={[{ id: 'second', name: 'Second' }]}
        currentWorkspaceIds={new Set(['second'])}
        onDispatch={onDispatch}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Run issue in selected workspace' })
    );
    expect(onDispatch).toHaveBeenCalledWith('second');
  });

  it('runs a linked workspace', () => {
    const onDispatch = vi.fn();
    const onCardClick = vi.fn();
    render(
      <div onClick={onCardClick}>
        <KanbanWorkspaceDispatch
          workspaces={[{ id: 'linked', name: 'Linked' }]}
          currentWorkspaceIds={new Set(['linked'])}
          onDispatch={onDispatch}
        />
      </div>
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Run issue in selected workspace' })
    );

    expect(onDispatch).toHaveBeenCalledWith('linked');
    expect(onCardClick).not.toHaveBeenCalled();
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

  it('hides the selector when the linked issue is Done', () => {
    const { container } = render(
      <KanbanWorkspaceDispatch
        workspaces={[{ id: 'ws', name: 'Workspace' }]}
        currentWorkspaceIds={new Set(['ws'])}
        issueStatusIsDone
        onDispatch={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
    expect(
      screen.queryByRole('combobox', { name: 'Run in workspace...' })
    ).toBeNull();
  });

  it('shows the selector when the linked issue is not Done', () => {
    render(
      <KanbanWorkspaceDispatch
        workspaces={[{ id: 'ws', name: 'Workspace' }]}
        issueStatusIsDone={false}
        onDispatch={vi.fn()}
      />
    );

    expect(
      screen.getByRole('combobox', { name: 'Run in workspace...' })
    ).toBeDefined();
  });

  it('only lists workspaces from the same project', () => {
    render(
      <KanbanWorkspaceDispatch
        workspaces={[
          { id: 'same', name: 'Same project', projectId: 'project-a' },
          { id: 'other', name: 'Other project', projectId: 'project-b' },
        ]}
        currentProjectId="project-a"
        onDispatch={vi.fn()}
      />
    );

    const select = screen.getByRole('combobox', {
      name: 'Run in workspace...',
    }) as HTMLButtonElement;
    fireEvent.click(select);

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toBe('Same project');
    expect(options.some((o) => o.textContent?.includes('Other project'))).toBe(
      false
    );
  });

  it('falls back to all workspaces when no project is specified', () => {
    render(
      <KanbanWorkspaceDispatch
        workspaces={[
          { id: 'same', name: 'Same project', projectId: 'project-a' },
          { id: 'other', name: 'Other project', projectId: 'project-b' },
        ]}
        onDispatch={vi.fn()}
      />
    );

    const select = screen.getByRole('combobox', {
      name: 'Run in workspace...',
    }) as HTMLButtonElement;
    fireEvent.click(select);

    expect(screen.getAllByRole('option')).toHaveLength(2);
  });
});

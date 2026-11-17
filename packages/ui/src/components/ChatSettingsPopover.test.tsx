import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatSettingsPopover } from './ChatSettingsPopover';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === 'modelSelector.agentModelThinking'
        ? 'Agent, model, and thinking'
        : key,
  }),
}));

afterEach(cleanup);

describe('ChatSettingsPopover', () => {
  it('opens an accessible settings popover and supports Escape', async () => {
    render(
      <ChatSettingsPopover>
        <button type="button">Agent selector</button>
        <button type="button">Model selector</button>
      </ChatSettingsPopover>
    );

    const trigger = screen.getByRole('button', {
      name: 'Agent, model, and thinking',
    });
    expect(trigger.getAttribute('class')).toContain('focus-visible:ring-1');
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog', {
      name: 'Agent, model, and thinking',
    });
    const agentButton = screen.getByRole('button', { name: 'Agent selector' });
    await waitFor(() => expect(document.activeElement).toBe(agentButton));

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('constrains the popover to the viewport and disables while busy', async () => {
    render(
      <ChatSettingsPopover disabled>
        <button type="button">Agent selector</button>
      </ChatSettingsPopover>
    );

    const trigger = screen.getByRole('button', {
      name: 'Agent, model, and thinking',
    });
    expect(trigger.hasAttribute('disabled')).toBe(true);
    expect(trigger.getAttribute('class')).toContain('focus-visible:ring-1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

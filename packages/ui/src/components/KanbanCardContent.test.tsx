/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { KanbanCardContent } from './KanbanCardContent';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

it('keeps the sub-issue toggle accessible without activating the card', () => {
  const toggle = vi.fn();
  const cardClick = vi.fn();
  render(
    <div onClick={cardClick}>
      <KanbanCardContent
        displayId="TEST-1"
        title="Parent"
        priority="high"
        tags={[]}
        statusName="Todo"
        subIssueCount={2}
        isSubIssuesExpanded={false}
        onToggleSubIssues={toggle}
      />
    </div>
  );
  const button = screen.getByRole('button', { name: 'kanban.subIssuesCount' });
  expect(button.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(button);
  expect(toggle).toHaveBeenCalledOnce();
  expect(cardClick).not.toHaveBeenCalled();
});

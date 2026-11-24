import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { IssueCommentsSection } from './IssueCommentsSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./CollapsibleSectionHeader', () => ({
  CollapsibleSectionHeader: ({ children }: { children: React.ReactNode }) =>
    children,
}));

afterEach(cleanup);

it('keeps the draft visible and offers retry after a send error', () => {
  const send = vi.fn();
  render(
    <IssueCommentsSection
      comments={[]}
      commentInput="draft"
      onCommentInputChange={() => {}}
      onSubmitComment={send}
      editingCommentId={null}
      editingValue=""
      onEditingValueChange={() => {}}
      onStartEdit={() => {}}
      onSaveEdit={() => {}}
      onCancelEdit={() => {}}
      onDeleteComment={() => {}}
      sendError
      renderEditor={({ value }) => <div>{value}</div>}
    />
  );
  expect(screen.getByText('draft')).toBeTruthy();
  fireEvent.click(screen.getByText('buttons.retry'));
  expect(send).toHaveBeenCalledOnce();
});

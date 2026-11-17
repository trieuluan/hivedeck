import { describe, expect, it } from 'vitest';
import { isDoneStatus } from './useCollapsedStatuses';

describe('isDoneStatus', () => {
  it('treats terminal or done-named columns as done', () => {
    expect(isDoneStatus({ name: 'Done', is_terminal: false })).toBe(true);
    expect(isDoneStatus({ name: 'Shipped', is_terminal: true })).toBe(true);
    expect(isDoneStatus({ name: ' closed ' })).toBe(true);
    expect(isDoneStatus({ name: 'In Review', is_terminal: false })).toBe(false);
  });
});

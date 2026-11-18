import { describe, expect, it } from 'vitest';
import { isCancelledStatusName, isDoneStatus } from './useCollapsedStatuses';

describe('isDoneStatus', () => {
  it('treats terminal or done-named columns as done', () => {
    expect(isDoneStatus({ name: 'Done', is_terminal: false })).toBe(true);
    expect(isDoneStatus({ name: 'Shipped', is_terminal: true })).toBe(true);
    expect(isDoneStatus({ name: ' closed ' })).toBe(true);
    expect(isDoneStatus({ name: 'In Review', is_terminal: false })).toBe(false);
  });
});

describe('isCancelledStatusName', () => {
  it('recognises dropped-work columns only', () => {
    for (const name of [
      'Cancelled',
      'canceled',
      'Rejected',
      "Won't do",
      'Đã huỷ',
    ]) {
      expect(isCancelledStatusName(name)).toBe(true);
    }
    for (const name of ['Done', 'In Review', 'Todo']) {
      expect(isCancelledStatusName(name)).toBe(false);
    }
  });
});

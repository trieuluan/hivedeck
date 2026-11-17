import { describe, expect, it } from 'vitest';
import { AUTO_TICK_MARKER, autoTickBody, isAutoTickMessage } from './autoTick';

describe('isAutoTickMessage', () => {
  it('recognises marked and legacy ticks', () => {
    expect(isAutoTickMessage(`${AUTO_TICK_MARKER}\nRun one tick.`)).toBe(true);
    expect(isAutoTickMessage('You are the captain of project "x" ...')).toBe(
      true
    );
    expect(
      isAutoTickMessage('Run one tick as the HiveDeck captain, following')
    ).toBe(true);
  });

  it("leaves the owner's own messages alone", () => {
    expect(isAutoTickMessage('please add a card for the login page')).toBe(
      false
    );
    expect(isAutoTickMessage('Why is the captain idle?')).toBe(false);
  });

  it('strips the marker for display', () => {
    expect(autoTickBody(`${AUTO_TICK_MARKER}\nRun one tick.`)).toBe(
      'Run one tick.'
    );
  });
});

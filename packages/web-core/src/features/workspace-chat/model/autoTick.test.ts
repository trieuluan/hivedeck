import { describe, expect, it } from 'vitest';
import {
  AUTO_TICK_MARKER,
  STARTUP_MARKER,
  autoTickBody,
  isAutoTickMessage,
  isStartupTick,
} from './autoTick';

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

describe('isStartupTick', () => {
  it('tells the startup tick from regular ticks', () => {
    const startup = `${AUTO_TICK_MARKER}\n${STARTUP_MARKER}\nRead the board.`;
    expect(isStartupTick(startup)).toBe(true);
    expect(isStartupTick(`${AUTO_TICK_MARKER}\nRun one tick.`)).toBe(false);
    expect(autoTickBody(startup)).toBe('Read the board.');
  });
});

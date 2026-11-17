import { describe, expect, it } from 'vitest';
import { flipDelta } from './useFlipCards';

describe('flipDelta', () => {
  it('returns the offset from the old position to the new one', () => {
    expect(flipDelta({ x: 300, y: 40 }, { x: 0, y: 120 })).toEqual({
      x: 300,
      y: -80,
    });
  });

  it('skips new cards, sub-pixel moves and huge jumps', () => {
    expect(flipDelta(undefined, { x: 0, y: 0 })).toBeNull();
    expect(flipDelta({ x: 10, y: 10 }, { x: 10.4, y: 10 })).toBeNull();
    expect(flipDelta({ x: 0, y: 0 }, { x: 9000, y: 0 })).toBeNull();
  });
});

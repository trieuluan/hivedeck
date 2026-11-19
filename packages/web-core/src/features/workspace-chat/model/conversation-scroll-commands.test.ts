import { describe, expect, it } from 'vitest';
import type { AddEntryType } from '@/shared/hooks/useConversationHistory/types';
import {
  resolveScrollIntent,
  shouldReleaseBottomLock,
} from './conversation-scroll-commands';

describe('conversation scroll intents', () => {
  it('always jumps to the bottom on initial load', () => {
    for (const isAtBottom of [true, false]) {
      expect(resolveScrollIntent('initial', true, isAtBottom)).toEqual({
        type: 'initial-bottom',
        purgeEstimatedSizes: true,
      });
    }
  });

  it('keeps the bottom for every new update while at the bottom', () => {
    const addTypes: AddEntryType[] = ['running', 'plan', 'historic'];

    for (const addType of addTypes) {
      expect(resolveScrollIntent(addType, false, true)).toEqual({
        type: 'follow-bottom',
        behavior: 'auto',
      });
    }
  });

  it('preserves the anchor when the user reads history', () => {
    const addTypes: AddEntryType[] = ['running', 'plan', 'historic'];

    for (const addType of addTypes) {
      expect(resolveScrollIntent(addType, false, false)).toEqual({
        type: 'preserve-anchor',
      });
    }
  });

  it('releases bottom lock only for an unguarded upward user scroll', () => {
    expect(shouldReleaseBottomLock(100, 80, true, false)).toBe(true);
    expect(shouldReleaseBottomLock(100, 80, false, false)).toBe(false);
    expect(shouldReleaseBottomLock(100, 80, true, true)).toBe(false);
    expect(shouldReleaseBottomLock(100, 96, true, false)).toBe(false);
    expect(shouldReleaseBottomLock(100, 120, true, false)).toBe(false);
  });
});

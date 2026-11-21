import { describe, expect, it } from 'vitest';

import { pipelineProgressPercent } from './IssueWorkspaceCard';

describe('pipelineProgressPercent', () => {
  it('returns null without a reported stage or total', () => {
    expect(pipelineProgressPercent(null, 3)).toBeNull();
    expect(pipelineProgressPercent(2, 0)).toBeNull();
    expect(pipelineProgressPercent(2, undefined)).toBeNull();
  });

  it('clamps stage progress to 0-100', () => {
    expect(pipelineProgressPercent(2, 5)).toBe(40);
    expect(pipelineProgressPercent(0, 5)).toBe(0);
    expect(pipelineProgressPercent(6, 5)).toBe(100);
  });
});

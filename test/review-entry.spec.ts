import { describe, expect, it } from 'vitest';
import { isGenerationReview } from '../src/lib/review-entry';

describe('review entry', () => {
  it('enables the timeout only for the generation source marker', () => {
    expect(isGenerationReview('generation')).toBe(true);
    expect(isGenerationReview(null)).toBe(false);
    expect(isGenerationReview('qr')).toBe(false);
    expect(isGenerationReview('GENERATION')).toBe(false);
  });
});

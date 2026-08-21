import { describe, expect, it } from 'vitest';
import { generationPhases, phaseForGenerationStatus, progressForPhase } from '../src/lib/generation-progress';

describe('generation progress', () => {
  it('defines the four real create phases in order', () => {
    expect(generationPhases.map(({ id }) => id)).toEqual(['uploading', 'moderating', 'generating', 'compositing']);
  });

  it.each([
    ['pending', 'uploading'],
    ['uploading', 'uploading'],
    ['moderating', 'moderating'],
    ['generating', 'generating'],
    ['compositing', 'compositing'],
  ] as const)('maps %s status to the %s phase', (status, phase) => {
    expect(phaseForGenerationStatus(status)).toBe(phase);
  });

  it.each(['completed', 'errored'] as const)('does not map terminal status %s to an active phase', (status) => {
    expect(phaseForGenerationStatus(status)).toBeNull();
  });

  it.each([
    ['uploading', 0, 0],
    ['uploading', 3000, 25],
    ['moderating', 0, 25],
    ['moderating', 3000, 35],
    ['generating', 0, 35],
    ['generating', 3000, 72],
    ['compositing', 0, 72],
    ['compositing', 3000, 92],
  ] as const)('calculates %s progress after %sms', (phase, elapsedMs, expected) => {
    expect(progressForPhase(phase, elapsedMs)).toBe(expected);
  });

  it('clamps progress before and after the crawl duration', () => {
    expect(progressForPhase('generating', -100)).toBe(35);
    expect(progressForPhase('generating', 5000)).toBe(72);
  });
});

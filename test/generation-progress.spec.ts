import { describe, expect, it } from 'vitest';
import { generationPhases, phaseForGenerationStatus, progressForPhase } from '../src/lib/generation-progress';

describe('generation progress', () => {
  it('defines the three real create phases in order', () => {
    expect(generationPhases.map(({ id }) => id)).toEqual(['uploading', 'generating', 'compositing']);
  });

  it.each([
    ['pending', 'uploading'],
    ['uploading', 'uploading'],
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
    ['generating', 0, 33],
    ['generating', 3000, 55],
    ['compositing', 0, 66],
    ['compositing', 3000, 88],
  ] as const)('calculates %s progress after %sms', (phase, elapsedMs, expected) => {
    expect(progressForPhase(phase, elapsedMs)).toBe(expected);
  });

  it('clamps progress before and after the crawl duration', () => {
    expect(progressForPhase('generating', -100)).toBe(33);
    expect(progressForPhase('generating', 5000)).toBe(55);
  });
});

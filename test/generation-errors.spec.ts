import { describe, expect, it } from 'vitest';
import {
  GENERATION_FAILURE_CODES,
  generationFailureContent,
  isGenerationFailureCode,
  toGenerationFailureCode,
} from '../src/lib/generation-errors';

const knownLegacyFailures = [
  ["We couldn't use this photo after the safety check. Try a different photo.", 'photo_rejected'],
  ["We couldn't check your photo. Please try again.", 'moderation_unavailable'],
  ["We couldn't create your caricature. Please try again.", 'generation_failed'],
  ["We couldn't finish your postcard. Please try again.", 'composition_failed'],
] as const;

describe('generation failure contract', () => {
  it('accepts exactly the closed set of persisted failure codes', () => {
    expect(GENERATION_FAILURE_CODES).toEqual([
      'photo_rejected',
      'moderation_unavailable',
      'generation_failed',
      'composition_failed',
      'unknown_failure',
    ]);

    for (const code of GENERATION_FAILURE_CODES) {
      expect(isGenerationFailureCode(code)).toBe(true);
      expect(toGenerationFailureCode(code, knownLegacyFailures[0][0])).toBe(code);
    }

    expect(isGenerationFailureCode('other_failure')).toBe(false);
    expect(isGenerationFailureCode(null)).toBe(false);
    expect(isGenerationFailureCode(1)).toBe(false);
  });

  it.each(knownLegacyFailures)('maps legacy attendee copy %s to %s', (legacyMessage, expected) => {
    expect(toGenerationFailureCode(null, legacyMessage)).toBe(expected);
    expect(toGenerationFailureCode('invalid', legacyMessage)).toBe(expected);
  });

  it.each([null, '', 'database connection exposed internal details', 'toString', 'constructor'])('fails closed for unknown legacy values', (legacyMessage) => {
    expect(toGenerationFailureCode(null, legacyMessage)).toBe('unknown_failure');
  });

  it('defines fixed attendee copy and retry semantics for every code', () => {
    expect(generationFailureContent).toEqual({
      photo_rejected: {
        message: "We couldn't use this photo after the safety check. Try a different photo.",
        retryable: true,
      },
      moderation_unavailable: {
        message: "We couldn't check your photo. Please try again.",
        retryable: true,
      },
      generation_failed: {
        message: "We couldn't create your caricature. Please try again.",
        retryable: true,
      },
      composition_failed: {
        message: "We couldn't finish your postcard. Please try again.",
        retryable: true,
      },
      unknown_failure: {
        message: "We couldn't create your postcard. Please try again.",
        retryable: true,
      },
    });
  });

  it('uses fixed retryable attendee copy without reflecting input text', () => {
    const untrustedText = 'private provider response and database details';
    const code = toGenerationFailureCode('invalid', untrustedText);
    const content = generationFailureContent[code];

    expect(content.retryable).toBe(true);
    expect(content.message).toBe("We couldn't create your postcard. Please try again.");
    expect(JSON.stringify(content)).not.toContain(untrustedText);
  });
});

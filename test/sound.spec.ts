import { describe, expect, it } from 'vitest';
import { soundEnabledFromStoredValue } from '../src/lib/sound';

describe('sound preference', () => {
  it('defaults to enabled when no preference is stored', () => {
    expect(soundEnabledFromStoredValue(null)).toBe(true);
  });

  it('restores an explicit muted preference', () => {
    expect(soundEnabledFromStoredValue('false')).toBe(false);
  });

  it('restores an explicit enabled preference', () => {
    expect(soundEnabledFromStoredValue('true')).toBe(true);
  });
});

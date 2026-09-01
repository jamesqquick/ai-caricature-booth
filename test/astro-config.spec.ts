import { describe, expect, it } from 'vitest';
import config from '../astro.config.mjs';

describe('Astro request limits', () => {
  it('allows the validated 6 MiB selfie plus action encoding overhead', () => {
    expect(config.security?.actionBodySizeLimit).toBe(7 * 1024 * 1024);
  });
});

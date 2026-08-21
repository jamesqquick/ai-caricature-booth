import { describe, expect, it, vi } from 'vitest';
import { moderateImage } from '../src/lib/moderation';

const image = new Uint8Array([1, 2, 3]);

describe('moderateImage', () => {
  it('accepts an object verdict', async () => {
    const ai = { run: vi.fn().mockResolvedValue({ safe: true }) } as unknown as Ai;
    const verdict = await moderateImage(ai, image);
    expect(verdict.safe).toBe(true);
    expect(verdict.raw).toContain('safe');
  });

  it('parses JSON embedded in a string response', async () => {
    const ai = { run: vi.fn().mockResolvedValue({ response: 'Here is the result: {"safe":true}' }) } as unknown as Ai;
    await expect(moderateImage(ai, image)).resolves.toMatchObject({ safe: true });
  });

  it('fails closed for malformed output', async () => {
    const ai = { run: vi.fn().mockResolvedValue({ response: 'not json' }) } as unknown as Ai;
    await expect(moderateImage(ai, image)).resolves.toMatchObject({ safe: false });
  });

  it('uses literal safe=true only', async () => {
    const ai = { run: vi.fn().mockResolvedValue({ response: { safe: 'true' } }) } as unknown as Ai;
    await expect(moderateImage(ai, image)).resolves.toMatchObject({ safe: false });
  });

  it('keeps an explicit safe=false verdict unsafe', async () => {
    const ai = { run: vi.fn().mockResolvedValue({ response: { safe: false } }) } as unknown as Ai;
    await expect(moderateImage(ai, image)).resolves.toMatchObject({ safe: false, reasons: ['model returned safe=false with no reasons'] });
  });

  it('accepts the license and retries once', async () => {
    const ai = {
      run: vi.fn()
        .mockRejectedValueOnce(new Error('5016 please agree'))
        .mockRejectedValueOnce(new Error('Thank you for agreeing'))
        .mockResolvedValueOnce({ response: { safe: true } }),
    } as unknown as Ai;
    await expect(moderateImage(ai, image)).resolves.toMatchObject({ safe: true });
    expect(ai.run).toHaveBeenCalledTimes(3);
    expect(ai.run).toHaveBeenNthCalledWith(2, '@cf/meta/llama-3.2-11b-vision-instruct', { prompt: 'agree' });
  });

  it('does not retry non-license errors', async () => {
    const ai = { run: vi.fn().mockRejectedValue(new Error('service unavailable')) } as unknown as Ai;
    await expect(moderateImage(ai, image)).rejects.toThrow('service unavailable');
    expect(ai.run).toHaveBeenCalledTimes(1);
  });
});

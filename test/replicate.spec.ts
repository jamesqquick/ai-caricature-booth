import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateCaricature } from '../src/lib/replicate';

describe('generateCaricature', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses Nano Banana 2 with the supported image-generation inputs', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'prediction-1', status: 'succeeded', output: 'https://example.com/output.jpg' })))
      .mockResolvedValueOnce(new Response(new Uint8Array([4, 5, 6])));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateCaricature('test-token', new Uint8Array([1, 2, 3]), 'Draw this as a caricature.'))
      .resolves.toEqual(new Uint8Array([4, 5, 6]));

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.replicate.com/v1/models/google/nano-banana-2/predictions',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json', Prefer: 'wait' },
        body: JSON.stringify({
          input: {
            prompt: 'Draw this as a caricature.',
            image_input: ['data:image/jpeg;base64,AQID'],
            aspect_ratio: '3:2',
            output_format: 'jpg',
          },
        }),
      }),
    );
  });
});

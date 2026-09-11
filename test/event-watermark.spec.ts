import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_WATERMARK_BYTES,
  MAX_WATERMARK_DIMENSION,
  MAX_WATERMARK_WIDTH,
  MIN_WATERMARK_WIDTH,
  WatermarkValidationError,
  assertPng,
  createEventWatermarkKey,
  deleteEventWatermark,
  isEventOwnedWatermark,
  ownedWatermarkPrefix,
  putEventWatermark,
  readBoundedPng,
  validateWatermarkWidth,
} from '../src/lib/event-watermark';

function png(width = 800, height = 300) {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

describe('event watermark helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a valid PNG signature, IHDR header, and dimensions', async () => {
    const bytes = png();
    const request = new Request('https://booth.test/watermark', {
      method: 'PUT',
      body: bytes.slice().buffer as ArrayBuffer,
      headers: {
        'Content-Length': String(bytes.byteLength),
        'Content-Type': 'image/png',
      },
    });

    expect(() => assertPng(bytes)).not.toThrow();
    await expect(readBoundedPng(request)).resolves.toEqual(bytes);
  });

  it.each([
    ['signature', new Uint8Array(33), 'Watermark must be a valid PNG image.'],
    ['zero width', png(0, 100), `Watermark dimensions must be between 1 and ${MAX_WATERMARK_DIMENSION} pixels.`],
    ['zero height', png(100, 0), `Watermark dimensions must be between 1 and ${MAX_WATERMARK_DIMENSION} pixels.`],
    ['wide image', png(MAX_WATERMARK_DIMENSION + 1, 100), `Watermark dimensions must be between 1 and ${MAX_WATERMARK_DIMENSION} pixels.`],
    ['tall image', png(100, MAX_WATERMARK_DIMENSION + 1), `Watermark dimensions must be between 1 and ${MAX_WATERMARK_DIMENSION} pixels.`],
  ])('rejects an invalid PNG %s', (_label, bytes, message) => {
    expect(() => assertPng(bytes)).toThrow(new WatermarkValidationError(message));
  });

  it('retains HTTP-compatible upload validation statuses', async () => {
    const missingLength = new Request('https://booth.test/watermark', {
      method: 'PUT',
      body: png().slice().buffer as ArrayBuffer,
      headers: { 'Content-Type': 'image/png' },
    });
    const oversized = new Request('https://booth.test/watermark', {
      method: 'PUT',
      body: png().slice().buffer as ArrayBuffer,
      headers: {
        'Content-Length': String(MAX_WATERMARK_BYTES + 1),
        'Content-Type': 'image/png',
      },
    });

    await expect(readBoundedPng(missingLength)).rejects.toMatchObject({ status: 411 });
    await expect(readBoundedPng(oversized)).rejects.toMatchObject({ status: 413 });
  });

  it.each([
    [MIN_WATERMARK_WIDTH, MIN_WATERMARK_WIDTH],
    [String(MAX_WATERMARK_WIDTH), MAX_WATERMARK_WIDTH],
  ])('validates watermark width %s', (value, expected) => {
    expect(validateWatermarkWidth(value)).toBe(expected);
  });

  it.each([null, '', MIN_WATERMARK_WIDTH - 1, MAX_WATERMARK_WIDTH + 1, 540.5, 'wide'])('rejects invalid watermark width %s', (value) => {
    expect(() => validateWatermarkWidth(value)).toThrow(
      new WatermarkValidationError(`Width must be a whole number from ${MIN_WATERMARK_WIDTH} to ${MAX_WATERMARK_WIDTH}.`),
    );
  });

  it('recognizes only keys under the event watermark prefix', () => {
    expect(ownedWatermarkPrefix(7)).toBe('events/7/watermarks/');
    expect(isEventOwnedWatermark(7, 'events/7/watermarks/mark.png')).toBe(true);
    expect(isEventOwnedWatermark(7, 'events/8/watermarks/mark.png')).toBe(false);
    expect(isEventOwnedWatermark(7, 'sessions/session-1/postcard.jpg')).toBe(false);
  });

  it('creates an event-owned PNG key', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000');

    expect(createEventWatermarkKey(7)).toBe('events/7/watermarks/00000000-0000-4000-8000-000000000000.png');
  });

  it('generates and stores an event-owned PNG key with event metadata', async () => {
    const randomUUID = vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000');
    const put = vi.fn().mockResolvedValue(undefined);
    const bucket = { put } as unknown as R2Bucket;
    const bytes = png();

    const key = await putEventWatermark(bucket, 7, bytes);

    expect(randomUUID).toHaveBeenCalledOnce();
    expect(key).toBe('events/7/watermarks/00000000-0000-4000-8000-000000000000.png');
    expect(put).toHaveBeenCalledWith(key, bytes, {
      httpMetadata: { contentType: 'image/png' },
      customMetadata: { eventId: '7' },
    });
  });

  it('retries deletion up to three times and returns after success', async () => {
    const deleteObject = vi.fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockResolvedValueOnce(undefined);
    const bucket = { delete: deleteObject } as unknown as R2Bucket;

    await expect(deleteEventWatermark(bucket, 'events/7/watermarks/mark.png')).resolves.toBeUndefined();
    expect(deleteObject).toHaveBeenCalledTimes(3);
  });

  it('throws the final deletion error after three failed attempts', async () => {
    const finalError = new Error('third');
    const deleteObject = vi.fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockRejectedValueOnce(finalError);
    const bucket = { delete: deleteObject } as unknown as R2Bucket;

    await expect(deleteEventWatermark(bucket, 'events/7/watermarks/mark.png')).rejects.toBe(finalError);
    expect(deleteObject).toHaveBeenCalledTimes(3);
  });
});

import { describe, expect, it } from 'vitest';
import { assertJpeg, isJpeg } from '../src/lib/image-validation';

const validJpeg = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  0xff, 0xda, 0x00, 0x02,
  0xff, 0xd9,
]);

describe('image validation', () => {
  it('accepts a structurally valid JPEG with dimensions', () => {
    expect(isJpeg(validJpeg)).toBe(true);
    expect(() => assertJpeg(validJpeg)).not.toThrow();
  });

  it('rejects marker-only or malformed data', () => {
    expect(() => assertJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toThrow();
    expect(() => assertJpeg(new Uint8Array([0xff, 0xd8, 0x00, 0xd9]))).toThrow();
  });
});

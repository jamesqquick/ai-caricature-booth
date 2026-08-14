export const MAX_SELFIE_BYTES = 6 * 1024 * 1024;

export function isJpeg(bytes: Uint8Array) {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
}

export function assertJpeg(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_SELFIE_BYTES) throw new Error('Photo is too large. Please choose a smaller JPEG.');
  if (!isJpeg(bytes)) throw new Error('Only valid JPEG photos are supported.');

  let offset = 2;
  let hasDimensions = false;
  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) throw new Error('Only valid JPEG photos are supported.');
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) throw new Error('Only valid JPEG photos are supported.');
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) throw new Error('Only valid JPEG photos are supported.');
    if (marker >= 0xc0 && marker <= 0xc3) {
      if (length < 7) throw new Error('Only valid JPEG photos are supported.');
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      if (width === 0 || height === 0 || width * height > 20_000_000) throw new Error('Photo dimensions are not supported.');
      hasDimensions = true;
    }
    offset += length;
  }
  if (!hasDimensions) throw new Error('Only valid JPEG photos are supported.');
}

export const MAX_WATERMARK_BYTES = 2 * 1024 * 1024;
export const MAX_WATERMARK_DIMENSION = 4096;
export const MIN_WATERMARK_WIDTH = 120;
export const MAX_WATERMARK_WIDTH = 900;

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export class WatermarkValidationError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'WatermarkValidationError';
  }
}

export function validateWatermarkWidth(value: unknown) {
  const width = Number(value);
  if (value === null || value === '' || !Number.isInteger(width) || width < MIN_WATERMARK_WIDTH || width > MAX_WATERMARK_WIDTH) {
    throw new WatermarkValidationError(`Width must be a whole number from ${MIN_WATERMARK_WIDTH} to ${MAX_WATERMARK_WIDTH}.`);
  }
  return width;
}

export function assertPng(bytes: Uint8Array) {
  if (bytes.byteLength < 24 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    throw new WatermarkValidationError('Watermark must be a valid PNG image.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ihdrLength = view.getUint32(8);
  const ihdrType = String.fromCharCode(...bytes.subarray(12, 16));
  if (ihdrLength !== 13 || ihdrType !== 'IHDR') {
    throw new WatermarkValidationError('Watermark PNG is missing a valid IHDR header.');
  }
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0 || width > MAX_WATERMARK_DIMENSION || height > MAX_WATERMARK_DIMENSION) {
    throw new WatermarkValidationError(`Watermark dimensions must be between 1 and ${MAX_WATERMARK_DIMENSION} pixels.`);
  }
}

export async function readBoundedPng(request: Request) {
  if (request.headers.get('content-type') !== 'image/png') {
    throw new WatermarkValidationError('Watermark must use the image/png content type.');
  }

  const declaredSize = Number(request.headers.get('x-watermark-bytes') ?? request.headers.get('content-length'));
  if (!Number.isInteger(declaredSize) || declaredSize <= 0) {
    throw new WatermarkValidationError('A positive Content-Length header is required.', 411);
  }
  if (declaredSize > MAX_WATERMARK_BYTES) {
    throw new WatermarkValidationError('Watermark must be 2 MB or smaller.', 413);
  }
  if (!request.body) throw new WatermarkValidationError('Watermark image is required.');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_WATERMARK_BYTES) {
      await reader.cancel();
      throw new WatermarkValidationError('Watermark must be 2 MB or smaller.', 413);
    }
    chunks.push(value);
  }
  if (size !== declaredSize) throw new WatermarkValidationError('Content-Length does not match the uploaded image.');

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  assertPng(bytes);
  return bytes;
}

export function ownedWatermarkPrefix(eventId: number) {
  return `events/${eventId}/watermarks/`;
}

export function isEventOwnedWatermark(eventId: number, key: string) {
  return key.startsWith(ownedWatermarkPrefix(eventId));
}

export function createEventWatermarkKey(eventId: number) {
  return `${ownedWatermarkPrefix(eventId)}${crypto.randomUUID()}.png`;
}

export async function putEventWatermark(bucket: R2Bucket, eventId: number, bytes: Uint8Array) {
  const key = createEventWatermarkKey(eventId);
  await bucket.put(key, bytes, {
    httpMetadata: { contentType: 'image/png' },
    customMetadata: { eventId: String(eventId) },
  });
  return key;
}

export async function deleteEventWatermark(bucket: R2Bucket, key: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await bucket.delete(key);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Watermark object could not be deleted.');
}

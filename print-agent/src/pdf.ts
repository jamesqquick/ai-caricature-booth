import { PDFDocument } from "pdf-lib";

const PAGE_WIDTH_POINTS = 6 * 72;
const PAGE_HEIGHT_POINTS = 4 * 72;
export const MAX_JPEG_PIXELS = 40_000_000;

export class PdfGenerationError extends Error {
  readonly name = "PdfGenerationError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export class JpegValidationError extends Error {
  readonly name = "JpegValidationError";
}

export async function buildPrintPdf(jpegBytes: Uint8Array): Promise<Uint8Array> {
  validateJpegDimensions(jpegBytes);
  try {
    const document = await PDFDocument.create();
    const image = await document.embedJpg(jpegBytes);
    const page = document.addPage([PAGE_WIDTH_POINTS, PAGE_HEIGHT_POINTS]);
    page.drawImage(image, { x: 0, y: 0, width: PAGE_WIDTH_POINTS, height: PAGE_HEIGHT_POINTS });
    return await document.save();
  } catch (cause) {
    throw new PdfGenerationError("Could not build the 6x4 print PDF from the postcard JPEG.", { cause });
  }
}

export function validateJpegDimensions(jpegBytes: Uint8Array): { width: number; height: number } {
  if (jpegBytes.length < 4 || jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) {
    throw new JpegValidationError("Postcard is not a valid JPEG.");
  }

  let offset = 2;
  while (offset < jpegBytes.length) {
    while (jpegBytes[offset] === 0xff) offset += 1;
    const marker = jpegBytes[offset++];
    if (marker === undefined || marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > jpegBytes.length) break;

    const segmentLength = readUint16(jpegBytes, offset);
    if (segmentLength < 2 || offset + segmentLength > jpegBytes.length) break;
    if (isStartOfFrame(marker)) {
      if (segmentLength < 7) break;
      const height = readUint16(jpegBytes, offset + 3);
      const width = readUint16(jpegBytes, offset + 5);
      if (width <= 0 || height <= 0) {
        throw new JpegValidationError("Postcard JPEG dimensions must be positive.");
      }
      if (width <= height) {
        throw new JpegValidationError(`Postcard JPEG must be landscape, but is ${width}x${height}.`);
      }
      if (width * height > MAX_JPEG_PIXELS) {
        throw new JpegValidationError(`Postcard JPEG exceeds the ${MAX_JPEG_PIXELS}-pixel limit.`);
      }
      return { width, height };
    }
    offset += segmentLength;
  }
  throw new JpegValidationError("Postcard JPEG does not contain readable dimensions.");
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 256 + bytes[offset + 1]!;
}

function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

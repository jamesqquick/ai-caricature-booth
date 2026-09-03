import { describe, expect, it } from "vitest";
import { decodePDFRawStream, PDFArray, PDFContentStream, PDFDocument, PDFRawStream } from "pdf-lib";
import { buildPrintPdf, JpegValidationError, MAX_JPEG_PIXELS, validateJpegDimensions } from "../src/pdf.js";

const jpeg = Uint8Array.from(Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==", "base64"));
const sofOffset = jpeg.findIndex((byte, index) => byte === 0xff && jpeg[index + 1] === 0xc0);
jpeg[sofOffset + 8] = 2;

describe("buildPrintPdf", () => {
  it("creates one edge-to-edge landscape 6x4 inch page", async () => {
    const pdf = await PDFDocument.load(await buildPrintPdf(jpeg));
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 432, height: 288 });
    const contents = pdf.getPage(0).node.normalizedEntries().Contents as PDFArray;
    const operators = contents.asArray()
      .map((reference) => {
        const stream = pdf.context.lookup(reference);
        if (stream instanceof PDFRawStream) {
          return new TextDecoder().decode(decodePDFRawStream(stream).decode());
        }
        return (stream as PDFContentStream).getContentsString();
      })
      .join("\n");
    expect(operators).toContain("432 0 0 288 0 0 cm");
  });

  it("rejects non-landscape, zero-sized, and excessive JPEG dimensions before pdf-lib", async () => {
    const portrait = jpeg.slice();
    portrait[sofOffset + 5] = 2;
    portrait[sofOffset + 7] = 0;
    portrait[sofOffset + 8] = 1;
    expect(() => validateJpegDimensions(portrait)).toThrow(JpegValidationError);

    const zeroWidth = jpeg.slice();
    zeroWidth[sofOffset + 7] = 0;
    zeroWidth[sofOffset + 8] = 0;
    expect(() => validateJpegDimensions(zeroWidth)).toThrow(JpegValidationError);

    const oversized = jpeg.slice();
    setDimensions(oversized, 10_000, Math.floor(MAX_JPEG_PIXELS / 10_000) + 1);
    await expect(buildPrintPdf(oversized)).rejects.toBeInstanceOf(JpegValidationError);
  });
});

function setDimensions(bytes: Uint8Array, width: number, height: number): void {
  bytes[sofOffset + 5] = height >> 8;
  bytes[sofOffset + 6] = height & 0xff;
  bytes[sofOffset + 7] = width >> 8;
  bytes[sofOffset + 8] = width & 0xff;
}

import { describe, expect, it } from "vitest";
import { decodePDFRawStream, PDFArray, PDFContentStream, PDFDocument, PDFRawStream } from "pdf-lib";
import { buildPrintPdf } from "../src/pdf.js";

const jpeg = Uint8Array.from(Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==", "base64"));

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
});

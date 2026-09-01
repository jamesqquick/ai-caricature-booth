import { PDFDocument } from "pdf-lib";

const PAGE_WIDTH_POINTS = 6 * 72;
const PAGE_HEIGHT_POINTS = 4 * 72;

export class PdfGenerationError extends Error {
  readonly name = "PdfGenerationError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export async function buildPrintPdf(jpegBytes: Uint8Array): Promise<Uint8Array> {
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

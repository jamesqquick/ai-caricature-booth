import type { WatermarkSide } from './admin-watermark-placement';

export type { WatermarkSide } from './admin-watermark-placement';

export const WATERMARK_FILE_SELECTED_EVENT = 'watermark-file-selected';
export const WATERMARK_UPLOAD_STATE_EVENT = 'watermark-upload-state';

export type WatermarkFileSelectedDetail = {
  side: WatermarkSide;
  file: File;
};

export type WatermarkUploadStateDetail = {
  side: WatermarkSide;
  pending: boolean;
  hasWatermark?: boolean;
};

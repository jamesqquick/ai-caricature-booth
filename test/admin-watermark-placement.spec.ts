import { describe, expect, it } from 'vitest';
import {
  createLatestOperationToken,
  createWatermarkPlacementState,
  createWatermarkSectionState,
  DEFAULT_WATERMARK_PLACEMENT,
  normalizeWatermarkPlacement,
  previewableWatermarkPlacement,
  watermarkUploadUrl,
} from '../src/lib/admin-watermark-placement';

describe('admin watermark placement interactions', () => {
  it('enables shared save only for dirty sections without pending operations', () => {
    const section = createWatermarkSectionState({ left: false, right: true });

    expect(section.canSave).toBe(false);
    section.markChanged();
    expect(section.canSave).toBe(true);
    section.beginOperation();
    expect(section.canSave).toBe(false);
    section.endOperation();
    expect(section.canSave).toBe(true);
    section.saved();
    expect(section.canSave).toBe(false);
  });

  it('tracks successful upload and removal state independently by side', () => {
    const section = createWatermarkSectionState({ left: false, right: true });

    section.markChanged('left', true);
    section.markChanged('right', false);

    expect(section.hasWatermark('left')).toBe(true);
    expect(section.hasWatermark('right')).toBe(false);
    expect(section.canSave).toBe(true);
  });

  it('identifies only the latest file operation as current', () => {
    const operations = createLatestOperationToken();
    const first = operations.begin();
    const second = operations.begin();

    expect(operations.isCurrent(first)).toBe(false);
    expect(operations.isCurrent(second)).toBe(true);
  });

  it('makes an upload stale when removal invalidates the operation', () => {
    const operations = createLatestOperationToken();
    const upload = operations.begin();

    operations.invalidate();

    expect(operations.isCurrent(upload)).toBe(false);
  });

  it('keeps left and right persisted placement independent through replacement and removal', () => {
    const left = createWatermarkPlacementState({ width: 480, x: 72, y: 64 });
    const right = createWatermarkPlacementState({ width: 540, x: 50, y: 50 });

    left.persist({ width: 620, x: 80, y: 96 });

    expect(left.persisted).toEqual({ width: 620, x: 80, y: 96 });
    expect(right.persisted).toEqual({ width: 540, x: 50, y: 50 });
    expect(left.reset()).toEqual(DEFAULT_WATERMARK_PLACEMENT);
    expect(right.persisted).toEqual({ width: 540, x: 50, y: 50 });
  });

  it('retains the last valid preview while inputs are temporarily invalid', () => {
    const valid = { width: 620, x: 80, y: 96 };
    let preview = previewableWatermarkPlacement(valid, 0.5);

    preview = previewableWatermarkPlacement({ ...valid, x: 1500 }, 0.5) ?? preview;

    expect(preview).toEqual(valid);
  });

  it('rejects blank and non-numeric preview values represented by NaN', () => {
    expect(previewableWatermarkPlacement({ width: Number.NaN, x: 80, y: 96 }, 0.5)).toBeNull();
    expect(previewableWatermarkPlacement({ width: 620, x: Number.NaN, y: 96 }, 0.5)).toBeNull();
    expect(previewableWatermarkPlacement({ width: 620, x: 80, y: Number.NaN }, 0.5)).toBeNull();
  });

  it('rejects fractional preview values', () => {
    expect(previewableWatermarkPlacement({ width: 620.5, x: 80, y: 96 }, 0.5)).toBeNull();
    expect(previewableWatermarkPlacement({ width: 620, x: 80.5, y: 96 }, 0.5)).toBeNull();
    expect(previewableWatermarkPlacement({ width: 620, x: 80, y: 96.5 }, 0.5)).toBeNull();
  });

  it('normalizes placement after a replacement changes the image aspect ratio', () => {
    const normalized = normalizeWatermarkPlacement({ width: 620.4, x: 1400, y: 1100 }, 1.5);

    expect(normalized).toEqual({
      width: 620,
      x: 1180,
      y: 270,
    });
    expect(watermarkUploadUrl('/api/admin/events/demo/watermark?side=left', normalized, 'https://booth.test')).toBe(
      '/api/admin/events/demo/watermark?side=left&width=620&x=1180&y=270',
    );
  });

  it('normalizes invalid values on blur or save', () => {
    expect(normalizeWatermarkPlacement({ width: Number.NaN, x: -4.2, y: 1300 }, 0.5)).toEqual({
      width: 120,
      x: 0,
      y: 1140,
    });
  });
});

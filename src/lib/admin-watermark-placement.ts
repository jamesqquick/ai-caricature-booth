export type WatermarkPlacement = { width: number; x: number; y: number };

export const DEFAULT_WATERMARK_PLACEMENT: WatermarkPlacement = { width: 540, x: 50, y: 50 };

const POSTCARD_WIDTH = 1800;
const POSTCARD_HEIGHT = 1200;
const MIN_WATERMARK_WIDTH = 120;
const MAX_WATERMARK_WIDTH = 900;

function clamp(value: number, minimum: number, maximum: number) {
  const rounded = Number.isFinite(value) ? Math.round(value) : minimum;
  return Math.min(Math.max(minimum, Math.floor(maximum)), Math.max(minimum, rounded));
}

export function normalizeWatermarkPlacement(placement: WatermarkPlacement, aspectRatio: number): WatermarkPlacement {
  const width = clamp(placement.width, MIN_WATERMARK_WIDTH, MAX_WATERMARK_WIDTH);
  const renderedHeight = aspectRatio > 0 ? Math.ceil(width * aspectRatio) : 0;
  return {
    width,
    x: clamp(placement.x, 0, POSTCARD_WIDTH - width),
    y: clamp(placement.y, 0, POSTCARD_HEIGHT - renderedHeight),
  };
}

export function previewableWatermarkPlacement(placement: WatermarkPlacement, aspectRatio: number) {
  const renderedHeight = aspectRatio > 0 ? Math.ceil(placement.width * aspectRatio) : 0;
  if (
    !Number.isInteger(placement.width) || placement.width < MIN_WATERMARK_WIDTH || placement.width > MAX_WATERMARK_WIDTH
    || !Number.isInteger(placement.x) || placement.x < 0 || placement.x + placement.width > POSTCARD_WIDTH
    || !Number.isInteger(placement.y) || placement.y < 0 || placement.y + renderedHeight > POSTCARD_HEIGHT
  ) return null;
  return placement;
}

export function watermarkUploadUrl(endpoint: string, placement: WatermarkPlacement, origin: string) {
  const url = new URL(endpoint, origin);
  url.searchParams.set('width', String(placement.width));
  url.searchParams.set('x', String(placement.x));
  url.searchParams.set('y', String(placement.y));
  return `${url.pathname}${url.search}`;
}

export function createWatermarkPlacementState(initial: WatermarkPlacement) {
  let persisted = { ...initial };
  return {
    get persisted() {
      return { ...persisted };
    },
    persist(placement: WatermarkPlacement) {
      persisted = { ...placement };
    },
    reset() {
      persisted = { ...DEFAULT_WATERMARK_PLACEMENT };
      return { ...persisted };
    },
  };
}

export function createLatestOperationToken() {
  let current = 0;
  return {
    begin() {
      current += 1;
      return current;
    },
    invalidate() {
      current += 1;
    },
    isCurrent(operation: number) {
      return operation === current;
    },
  };
}

export type WatermarkSide = 'left' | 'right';

export function createWatermarkSectionState(initial: Record<WatermarkSide, boolean>) {
  let dirty = false;
  let pending = 0;
  const hasWatermark = { ...initial };
  return {
    get canSave() {
      return dirty && pending === 0;
    },
    hasWatermark(side: WatermarkSide) {
      return hasWatermark[side];
    },
    markChanged(side?: WatermarkSide, exists?: boolean) {
      if (side && exists !== undefined) hasWatermark[side] = exists;
      dirty = true;
    },
    beginOperation() {
      pending += 1;
    },
    endOperation() {
      pending = Math.max(0, pending - 1);
    },
    saved() {
      dirty = false;
    },
  };
}

export const POSTCARD_WIDTH = 1800;
export const POSTCARD_HEIGHT = 1200;
export const DEFAULT_WATERMARK_WIDTH = 540;
export const DEFAULT_WATERMARK_X = 50;
export const DEFAULT_WATERMARK_Y = 50;

export async function buildPostcard(
  env: Env,
  caricature: R2ObjectBody,
  watermarkKey: string | null,
  watermarkWidth: number | null,
  watermarkX: number | null,
  watermarkY: number | null,
  watermarkLeftKey: string | null = null,
  watermarkLeftWidth: number | null = null,
  watermarkLeftX: number | null = null,
  watermarkLeftY: number | null = null,
) {
  let pipeline = env.IMAGES.input(caricature.body).transform({ width: POSTCARD_WIDTH, height: POSTCARD_HEIGHT, fit: 'cover' });
  const [watermark, watermarkLeft] = await Promise.all([
    watermarkKey ? env.SELFIES.get(watermarkKey) : Promise.resolve(null),
    watermarkLeftKey ? env.SELFIES.get(watermarkLeftKey) : Promise.resolve(null),
  ]);
  if (watermark) {
    pipeline = pipeline.draw(env.IMAGES.input(watermark.body).transform({ width: watermarkWidth ?? DEFAULT_WATERMARK_WIDTH }), {
      bottom: watermarkY ?? DEFAULT_WATERMARK_Y,
      right: watermarkX ?? DEFAULT_WATERMARK_X,
      opacity: 0.95,
    });
  }
  if (watermarkLeft) {
    pipeline = pipeline.draw(env.IMAGES.input(watermarkLeft.body).transform({ width: watermarkLeftWidth ?? DEFAULT_WATERMARK_WIDTH }), {
      bottom: watermarkLeftY ?? DEFAULT_WATERMARK_Y,
      left: watermarkLeftX ?? DEFAULT_WATERMARK_X,
      opacity: 0.95,
    });
  }
  const result = await pipeline.output({ format: 'image/jpeg' });
  return result.response();
}

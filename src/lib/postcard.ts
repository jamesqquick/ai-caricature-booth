export const POSTCARD_WIDTH = 1800;
export const POSTCARD_HEIGHT = 1200;
export const DEFAULT_WATERMARK_WIDTH = 540;

export async function buildPostcard(
  env: Env,
  caricature: R2ObjectBody,
  watermarkKey: string | null,
  watermarkWidth: number | null,
) {
  let pipeline = env.IMAGES.input(caricature.body).transform({ width: POSTCARD_WIDTH, height: POSTCARD_HEIGHT, fit: 'cover' });
  if (watermarkKey) {
    const watermark = await env.SELFIES.get(watermarkKey);
    if (watermark) {
      pipeline = pipeline.draw(env.IMAGES.input(watermark.body).transform({ width: watermarkWidth ?? DEFAULT_WATERMARK_WIDTH }), { bottom: 56, right: 56, opacity: 0.95 });
    }
  }
  const result = await pipeline.output({ format: 'image/jpeg' });
  return result.response();
}

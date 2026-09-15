UPDATE events
SET watermark_x = 50, watermark_y = 50
WHERE watermark_image_key IS NULL
  AND watermark_x = 56
  AND watermark_y = 56;

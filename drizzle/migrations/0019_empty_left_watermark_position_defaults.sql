UPDATE events
SET watermark_left_x = 50, watermark_left_y = 50
WHERE watermark_image_key_left IS NULL
  AND watermark_left_x = 56
  AND watermark_left_y = 56;

UPDATE events
SET tagline = 'Take a selfie, choose a scene, and download your caricature postcard.'
WHERE id = 1
  AND tagline = 'Take a selfie, pick an iconic NYC scene, and walk away with a printed postcard.';

UPDATE events
SET tagline = 'Turn your conference selfie into a downloadable caricature postcard.'
WHERE id = 2
  AND tagline = 'Turn your conference selfie into a one-of-a-kind caricature postcard.';

UPDATE event_scenes
SET description = CASE id
  WHEN 'hot-dog-stand' THEN 'A New York hot dog cart with a yellow umbrella and condiment bottles.'
  WHEN 'subway' THEN 'A tiled subway platform with a passing express train.'
  WHEN 'central-park' THEN 'Bow Bridge with trees and the Manhattan skyline.'
  WHEN 'broadway' THEN 'A Broadway theater entrance under a lit marquee.'
  WHEN 'times-square' THEN 'Times Square at night with billboards, crowds, and traffic.'
  ELSE description
END
WHERE description IN (
  'A curbside classic with mustard-yellow swagger.',
  'Tiled walls, express trains, main-character energy.',
  'Bow Bridge, leafy shadows, and skyline peeks.',
  'Opening-night lights under a glowing marquee.',
  'Big screens, bright color, and midnight motion.'
)
AND event_id IN (1, 2);

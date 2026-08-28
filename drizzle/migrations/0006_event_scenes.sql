CREATE TABLE IF NOT EXISTS event_scenes (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  emoji TEXT NOT NULL,
  accent TEXT NOT NULL,
  backdrop TEXT NOT NULL,
  prompt TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  PRIMARY KEY (event_id, id)
);

CREATE INDEX IF NOT EXISTS event_scenes_active_order_idx
  ON event_scenes(event_id, active, sort_order, id);

WITH seeds(id, name, description, emoji, accent, backdrop, prompt, sort_order) AS (
  VALUES
    (
      'hot-dog-stand',
      'Hot Dog Stand',
      'A curbside classic with mustard-yellow swagger.',
      '🌭',
      'oklch(78% 0.16 82)',
      'oklch(28% 0.07 72)',
      'Create a bold editorial ink caricature in the Hot Dog Stand setting. A curbside classic with mustard-yellow swagger.',
      1
    ),
    (
      'subway',
      'Subway Platform',
      'Tiled walls, express trains, main-character energy.',
    '🚇',
    'oklch(74% 0.13 220)',
    'oklch(24% 0.045 230)',
    'Create a bold editorial ink caricature in the Subway Platform setting. Tiled walls, express trains, main-character energy.',
      2
    ),
    (
      'central-park',
      'Central Park',
      'Bow Bridge, leafy shadows, and skyline peeks.',
    '🌳',
    'oklch(72% 0.14 145)',
    'oklch(25% 0.05 145)',
    'Create a bold editorial ink caricature in the Central Park setting. Bow Bridge, leafy shadows, and skyline peeks.',
      3
    ),
    (
      'broadway',
      'Broadway',
      'Opening-night lights under a glowing marquee.',
    '🎭',
    'oklch(73% 0.18 25)',
    'oklch(25% 0.07 18)',
    'Create a bold editorial ink caricature in the Broadway setting. Opening-night lights under a glowing marquee.',
      4
    ),
    (
      'times-square',
      'Times Square',
      'Big screens, bright color, and midnight motion.',
    '🌆',
    'oklch(72% 0.19 325)',
    'oklch(24% 0.075 315)',
    'Create a bold editorial ink caricature in the Times Square setting. Big screens, bright color, and midnight motion.',
      5
    ),
    (
      'brooklyn-bridge',
      'Brooklyn Bridge',
      'Stone arches, cable lines, and Manhattan behind you.',
    '🌉',
    'oklch(76% 0.13 48)',
    'oklch(26% 0.045 46)',
    'Create a bold editorial ink caricature in the Brooklyn Bridge setting. Stone arches, cable lines, and Manhattan behind you.',
      6
    )
)
INSERT OR IGNORE INTO event_scenes (
  event_id, id, name, description, emoji, accent, backdrop, prompt, sort_order, active
)
SELECT
  events.id,
  seeds.id,
  seeds.name,
  seeds.description,
  seeds.emoji,
  seeds.accent,
  seeds.backdrop,
  seeds.prompt,
  seeds.sort_order,
  1
FROM events
CROSS JOIN seeds;

CREATE TABLE event_scenes_next (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  prompt TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (event_id, id)
);

INSERT INTO event_scenes_next (event_id, id, name, description, prompt, sort_order)
SELECT
  event_id,
  id,
  name,
  description,
  CASE
    WHEN prompt = 'Create a bold editorial ink caricature in the Hot Dog Stand setting. A curbside classic with mustard-yellow swagger.' THEN 'Create a bold editorial ink caricature in the Hot Dog Stand setting.'
    WHEN prompt = 'Create a bold editorial ink caricature in the Subway Platform setting. Tiled walls, express trains, main-character energy.' THEN 'Create a bold editorial ink caricature in the Subway Platform setting.'
    WHEN prompt = 'Create a bold editorial ink caricature in the Central Park setting. Bow Bridge, leafy shadows, and skyline peeks.' THEN 'Create a bold editorial ink caricature in the Central Park setting.'
    WHEN prompt = 'Create a bold editorial ink caricature in the Broadway setting. Opening-night lights under a glowing marquee.' THEN 'Create a bold editorial ink caricature in the Broadway setting.'
    WHEN prompt = 'Create a bold editorial ink caricature in the Times Square setting. Big screens, bright color, and midnight motion.' THEN 'Create a bold editorial ink caricature in the Times Square setting.'
    WHEN prompt = 'Create a bold editorial ink caricature in the Brooklyn Bridge setting. Stone arches, cable lines, and Manhattan behind you.' THEN 'Create a bold editorial ink caricature in the Brooklyn Bridge setting.'
    ELSE prompt
  END,
  sort_order
FROM event_scenes;

DROP TABLE event_scenes;
ALTER TABLE event_scenes_next RENAME TO event_scenes;

CREATE INDEX event_scenes_order_idx
  ON event_scenes(event_id, sort_order, id);

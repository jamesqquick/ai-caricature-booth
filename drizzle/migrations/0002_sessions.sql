CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  status TEXT NOT NULL DEFAULT 'pending',
  scene_id TEXT NOT NULL,
  scene_name TEXT,
  selfie_key TEXT NOT NULL,
  caricature_key TEXT,
  postcard_key TEXT,
  workflow_instance_id TEXT,
  error_msg TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(workflow_instance_id)
);

CREATE INDEX IF NOT EXISTS sessions_event_created_idx
  ON sessions(event_id, created_at DESC);

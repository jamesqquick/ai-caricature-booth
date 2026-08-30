CREATE TABLE IF NOT EXISTS print_jobs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  postcard_key TEXT NOT NULL,
  postcard_url TEXT NOT NULL,
  scene_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  printed_at INTEGER,
  error_msg TEXT
);

CREATE INDEX IF NOT EXISTS print_jobs_status_idx
  ON print_jobs(status, created_at);

CREATE INDEX IF NOT EXISTS print_jobs_event_idx
  ON print_jobs(event_id, status, created_at);
